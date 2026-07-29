use crate::bond_products::{find_bond_products, FindBondProductsArgs};
use crate::cli_result::CliError;
use crate::{
    bonds::get_bonds_for_config,
    settlements::get_settlements_for_config,
    stake_accounts::{collect_stake_accounts, get_clock},
    withdraw_requests::get_withdraw_requests,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::{collections::HashMap, sync::Arc};
use validator_bonds::state::bond_product::{
    CommissionProductConfig, ProductType, ProductTypeConfig,
};
use validator_bonds::state::withdraw_request::WithdrawRequest;
use validator_bonds::state::{bond::Bond, config::find_bonds_withdrawer_authority};

#[derive(Default, Clone, Debug)]
pub struct Funds {
    pub funded_amount: u64,
    pub effective_amount: u64,
    pub remaining_witdraw_request_amount: u64,
    pub remainining_settlement_claim_amount: u64,
}

// Only u64::MAX is reinterpreted: it is the CLI's "withdraw everything" encoding, not an amount.
// Every other request is reported verbatim, as it was before the bonds/settlements refactor.
fn outstanding_withdraw_amount(requested: u64, withdrawn: u64, available: u64) -> u64 {
    if requested == u64::MAX {
        return available;
    }
    requested.saturating_sub(withdrawn)
}

fn aggregate_funds(
    delegated_stake: &[(Pubkey, u64)],
    withdraw_requests: &[(Pubkey, u64, u64)],
    settlement_claims: &[(Pubkey, u64)],
) -> HashMap<Pubkey, Funds> {
    let mut validator_funds: HashMap<Pubkey, Funds> = HashMap::new();

    for (vote_account, lamports) in delegated_stake {
        let funds = validator_funds.entry(*vote_account).or_default();
        funds.funded_amount += *lamports;
        funds.effective_amount += *lamports;
    }

    // Before the withdraw loop: settlement-funded stake is not withdrawable, so a "withdraw
    // everything" request must not report it as available.
    for (vote_account, claim) in settlement_claims {
        let funds = validator_funds.entry(*vote_account).or_default();
        funds.remainining_settlement_claim_amount += *claim;
        funds.effective_amount = funds.effective_amount.saturating_sub(*claim);
    }

    for (vote_account, requested, withdrawn) in withdraw_requests {
        let funds = validator_funds.entry(*vote_account).or_default();
        let outstanding =
            outstanding_withdraw_amount(*requested, *withdrawn, funds.effective_amount);
        funds.remaining_witdraw_request_amount += outstanding;
        funds.effective_amount = funds.effective_amount.saturating_sub(outstanding);
    }

    validator_funds
}

pub async fn collect_validator_bonds_with_funds(
    rpc_client: Arc<RpcClient>,
    config_address: Pubkey,
) -> Result<Vec<(Pubkey, Bond, Funds, CommissionProductConfig)>, CliError> {
    let (withdraw_authority, _) = find_bonds_withdrawer_authority(&config_address);
    log::info!("Config withdraw authority: {withdraw_authority:?}");

    let bonds: HashMap<_, _> = get_bonds_for_config(rpc_client.clone(), &config_address)
        .await
        .map_err(CliError::retry_able)?
        .into_iter()
        .collect();
    let stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&withdraw_authority), None)
            .await
            .map_err(CliError::retry_able)?;
    let settlements = get_settlements_for_config(rpc_client.clone(), &config_address).await?;
    let withdraw_requests: Vec<(Pubkey, WithdrawRequest)> =
        get_withdraw_requests(rpc_client.clone())
            .await
            .map_err(CliError::retry_able)?
            .into_iter()
            .filter(|(_, wr)| bonds.contains_key(&wr.bond))
            .collect();
    let mut bond_products = HashMap::new();
    for (pubkey, pb) in find_bond_products(
        rpc_client.clone(),
        FindBondProductsArgs {
            config: Some(&config_address),
            product_type: Some(&ProductType::Commission),
            ..Default::default()
        },
    )
    .await
    .map_err(CliError::retry_able)?
    {
        if let Some((existing_pubkey, _)) = bond_products.insert(pb.bond, (pubkey, pb)) {
            return Err(CliError::critical(anyhow::anyhow!(
                "Multiple BondProducts ({existing_pubkey},{pubkey}) found for one bond"
            )));
        }
    }

    log::info!("Found bonds: {}", bonds.len());
    log::info!("Found stake accounts: {}", stake_accounts.len());
    log::info!("Found withdraw requests: {}", withdraw_requests.len());
    log::info!("Found settlements: {}", settlements.len());
    log::info!("Found bond commission products: {}", bond_products.len());

    let clock = get_clock(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;
    let mut delegated_stake: Vec<(Pubkey, u64)> = vec![];
    for (pubkey, lamports_available, stake_account) in stake_accounts {
        if let Some(lockup) = stake_account.lockup() {
            if lockup.is_in_force(&clock, None) {
                log::warn!("Lockup is in force {pubkey}");
            }
        }
        if let Some(delegation) = stake_account.delegation() {
            delegated_stake.push((delegation.voter_pubkey, lamports_available));
        }
    }

    let withdraw_request_amounts: Vec<(Pubkey, u64, u64)> = withdraw_requests
        .into_iter()
        .map(|(_, wr)| (wr.vote_account, wr.requested_amount, wr.withdrawn_amount))
        .collect();

    let mut settlement_claims: Vec<(Pubkey, u64)> = vec![];
    for (settlement_pubkey, settlement) in settlements {
        let bond = match bonds.get(&settlement.bond) {
            Some(bond) => bond,
            None => {
                log::error!("Bond not found for the settlement {settlement_pubkey}");
                continue;
            }
        };
        settlement_claims.push((
            bond.vote_account,
            settlement
                .lamports_funded
                .saturating_sub(settlement.lamports_claimed),
        ));
    }

    let validator_funds = aggregate_funds(
        &delegated_stake,
        &withdraw_request_amounts,
        &settlement_claims,
    );

    Ok(bonds
        .into_iter()
        .map(|(pubkey, bond)| {
            let funds = validator_funds
                .get(&bond.vote_account)
                .cloned()
                .unwrap_or_default();
            let commission_config = bond_products
                .get(&pubkey)
                .and_then(|(_, bp)| match &bp.config_data {
                    ProductTypeConfig::Commission(data) => Some(data.clone()),
                    _ => None,
                })
                .unwrap_or_default();
            (pubkey, bond, funds, commission_config)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{aggregate_funds, outstanding_withdraw_amount};
    use solana_sdk::pubkey::Pubkey;

    // Stake funded to a settlement keeps the bonds withdrawer authority, so it is counted into
    // `funded_amount`, but `claim_withdraw_request` refuses to withdraw it
    // (ErrorCode::StakeAccountIsFundedToSettlement). It must not be reported as withdrawable.
    #[test]
    fn settlement_reserved_stake_is_not_reported_as_withdrawable() {
        let vote_account = Pubkey::new_unique();
        let funds = aggregate_funds(
            &[(vote_account, 100)],
            &[(vote_account, u64::MAX, 0)],
            &[(vote_account, 60)],
        );
        let funds = funds.get(&vote_account).unwrap();

        assert_eq!(funds.funded_amount, 100);
        assert_eq!(funds.remainining_settlement_claim_amount, 60);
        assert_eq!(
            funds.remaining_witdraw_request_amount, 40,
            "only the stake not reserved for settlements can be withdrawn",
        );
        assert_eq!(funds.effective_amount, 0);
    }

    // Only for the sentinel: a verbatim over-request is an intent, not a balance, so it does not
    // reconcile — see `request_above_available_is_still_reported_verbatim`.
    #[test]
    fn sentinel_request_reconciles_against_the_funded_amount() {
        let vote_account = Pubkey::new_unique();
        let funds = aggregate_funds(
            &[(vote_account, 100)],
            &[(vote_account, u64::MAX, 0)],
            &[(vote_account, 60)],
        );
        let funds = funds.get(&vote_account).unwrap();

        assert_eq!(
            funds.remaining_witdraw_request_amount
                + funds.remainining_settlement_claim_amount
                + funds.effective_amount,
            funds.funded_amount,
            "withdrawable + settlement-reserved + effective must account for the funded stake",
        );
    }

    #[test]
    fn request_is_reported_verbatim() {
        assert_eq!(outstanding_withdraw_amount(50, 10, 100), 40);
    }

    // Deliberately NOT capped: `init_withdraw_request` never validates the amount against the
    // funded balance, so a request larger than the bond holds is a real state whose figure carried
    // information before the refactor. Reporting it verbatim keeps that behaviour.
    #[test]
    fn request_above_available_is_still_reported_verbatim() {
        assert_eq!(outstanding_withdraw_amount(150, 0, 100), 150);
    }

    #[test]
    fn withdraw_everything_reports_what_the_bond_still_holds() {
        assert_eq!(outstanding_withdraw_amount(u64::MAX, 40, 100), 100);
        assert_eq!(outstanding_withdraw_amount(u64::MAX, 0, 0), 0);
    }

    #[test]
    fn fulfilled_or_overdrawn_request_reports_zero() {
        assert_eq!(outstanding_withdraw_amount(50, 50, 100), 0);
        assert_eq!(outstanding_withdraw_amount(50, 80, 100), 0);
    }

    // The pre-refactor value for every non-sentinel request, so only u64::MAX ones change.
    #[test]
    fn only_the_sentinel_differs_from_the_pre_refactor_value() {
        for (requested, withdrawn, available) in [
            (50, 10, 100),
            (150, 0, 100),
            (50, 50, 100),
            (50, 80, 100),
            (0, 0, 100),
        ] {
            assert_eq!(
                outstanding_withdraw_amount(requested, withdrawn, available),
                requested.saturating_sub(withdrawn),
                "({requested}, {withdrawn}, {available}) must match the pre-refactor value",
            );
        }
    }
}
