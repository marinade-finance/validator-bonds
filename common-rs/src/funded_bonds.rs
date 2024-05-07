use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::{collections::HashMap, sync::Arc};
use validator_bonds::state::{bond::Bond, config::find_bonds_withdrawer_authority};

use crate::{
    bonds::get_bonds,
    settlements::get_settlements,
    stake_accounts::{collect_stake_accounts, get_clock},
    withdraw_requests::get_withdraw_requests,
};

#[derive(Default, Clone, Debug)]
pub struct Funds {
    pub funded_amount: u64,
    pub effective_amount: u64,
    pub remaining_witdraw_request_amount: u64,
    pub remainining_settlement_claim_amount: u64,
}

pub async fn collect_validator_bonds_with_funds(
    rpc_client: Arc<RpcClient>,
    config_address: Pubkey,
) -> anyhow::Result<Vec<(Pubkey, Bond, Funds)>> {
    let (withdraw_authority, _) = find_bonds_withdrawer_authority(&config_address);
    log::info!("{withdraw_authority:?}");

    let mut validator_funds: HashMap<Pubkey, Funds> = HashMap::new();

    let bonds: HashMap<_, _> = get_bonds(rpc_client.clone()).await?.into_iter().collect();
    let stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&withdraw_authority), None).await?;
    let witdraw_requests = get_withdraw_requests(rpc_client.clone()).await?;
    let settlements = get_settlements(rpc_client.clone()).await?;
    let clock = get_clock(rpc_client.clone()).await?;

    log::info!("Found bonds: {}", bonds.len());
    log::info!("Found stake accounts: {}", stake_accounts.len());
    log::info!("Found witdraw requests: {}", witdraw_requests.len());
    log::info!("Found settlements: {}", settlements.len());

    for (pubkey, _, stake_account) in stake_accounts {
        if let Some(lockup) = stake_account.lockup() {
            if lockup.is_in_force(&clock, None) {
                log::warn!("Lockup is in force {pubkey}");
            }
        }
        if let Some(delegation) = stake_account.delegation() {
            let funded_bond = validator_funds.entry(delegation.voter_pubkey).or_default();
            funded_bond.funded_amount += delegation.stake;
            funded_bond.effective_amount += delegation.stake;
        }
    }

    for (_, withdraw_request) in witdraw_requests {
        let funded_bond = validator_funds
            .entry(withdraw_request.vote_account)
            .or_default();
        let remainining_withdraw_request_amount = withdraw_request
            .requested_amount
            .saturating_sub(withdraw_request.withdrawn_amount);
        funded_bond.remaining_witdraw_request_amount += remainining_withdraw_request_amount;
        funded_bond.effective_amount = funded_bond
            .effective_amount
            .saturating_sub(remainining_withdraw_request_amount);
    }

    for (settlement_pubkey, settlement) in settlements {
        let bond = match bonds.get(&settlement.bond) {
            Some(bond) => bond,
            None => {
                log::error!("Bond not found for the settlement {settlement_pubkey}");
                continue;
            }
        };

        let funded_bond = validator_funds.entry(bond.vote_account).or_default();
        let remainining_settlement_claim_amount = settlement
            .lamports_funded
            .saturating_sub(settlement.lamports_claimed);
        funded_bond.remainining_settlement_claim_amount += remainining_settlement_claim_amount;
        funded_bond.effective_amount = funded_bond
            .effective_amount
            .saturating_sub(remainining_settlement_claim_amount);
    }

    Ok(bonds
        .into_iter()
        .map(|(pubkey, bond)| {
            let funds = validator_funds
                .get(&bond.vote_account)
                .cloned()
                .unwrap_or_default();
            (pubkey, bond, funds)
        })
        .collect())
}
