use crate::bond_products::{find_bond_products, FindBondProductsArgs};
use crate::{
    bonds::get_bonds_for_config,
    get_validator_bonds_program,
    settlements::get_settlements_for_config,
    stake_accounts::{collect_stake_accounts, get_clock},
    withdraw_requests::get_withdraw_requests,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::{collections::HashMap, sync::Arc};
use validator_bonds::state::bond_product::{
    BondProduct, CommissionProductConfig, ProductType, ProductTypeConfig,
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

pub async fn collect_validator_bonds_with_funds(
    rpc_client: Arc<RpcClient>,
    config_address: Pubkey,
) -> anyhow::Result<Vec<(Pubkey, Bond, Funds, CommissionProductConfig)>> {
    let (withdraw_authority, _) = find_bonds_withdrawer_authority(&config_address);
    log::info!("Config withdraw authority: {withdraw_authority:?}");

    let mut validator_funds: HashMap<Pubkey, Funds> = HashMap::new();

    let bonds: HashMap<_, _> = get_bonds_for_config(rpc_client.clone(), &config_address)
        .await?
        .into_iter()
        .collect();
    let stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&withdraw_authority), None).await?;
    let settlements = get_settlements_for_config(rpc_client.clone(), &config_address).await?;
    let withdraw_requests: Vec<(Pubkey, WithdrawRequest)> =
        get_withdraw_requests(rpc_client.clone())
            .await?
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
    .await?
    {
        if let Some((existing_pubkey, _)) = bond_products.insert(pb.bond, (pubkey, pb)) {
            anyhow::bail!(
                "Multiple BondProducts ({},{}) found for one bond",
                existing_pubkey,
                pubkey,
            );
        }
    }

    log::info!("Found bonds: {}", bonds.len());
    log::info!("Found stake accounts: {}", stake_accounts.len());
    log::info!("Found withdraw requests: {}", withdraw_requests.len());
    log::info!("Found settlements: {}", settlements.len());
    log::info!("Found bond commission products: {}", bond_products.len());

    let clock = get_clock(rpc_client.clone()).await?;
    for (pubkey, lamports_available, stake_account) in stake_accounts {
        if let Some(lockup) = stake_account.lockup() {
            if lockup.is_in_force(&clock, None) {
                log::warn!("Lockup is in force {pubkey}");
            }
        }
        if let Some(delegation) = stake_account.delegation() {
            let funded_bond = validator_funds.entry(delegation.voter_pubkey).or_default();
            funded_bond.funded_amount += lamports_available;
            funded_bond.effective_amount += lamports_available;
        }
    }

    for (_, withdraw_request) in withdraw_requests {
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
