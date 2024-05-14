use anyhow::anyhow;
use log::{debug, info};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;

use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
use validator_bonds::state::settlement::{find_settlement_staker_authority, Settlement};
use validator_bonds::state::settlement_claim::SettlementClaim;
use validator_bonds_common::settlements::{get_bonds_for_settlements, get_settlements};
use validator_bonds_common::stake_accounts::{
    collect_stake_accounts, obtain_claimable_stake_accounts_for_settlement, CollectedStakeAccounts,
};
use validator_bonds_common::utils::get_sysvar_clock;

pub const SETTLEMENT_CLAIM_ACCOUNT_SIZE: usize = 8 + std::mem::size_of::<SettlementClaim>();

pub struct ClaimableSettlementsReturn {
    pub settlement_address: Pubkey,
    pub settlement: Settlement,
    pub stake_accounts_lamports: u64,
    pub stake_accounts: CollectedStakeAccounts,
}

pub async fn list_claimable_settlements(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
    config: &Config,
) -> anyhow::Result<Vec<ClaimableSettlementsReturn>> {
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let current_epoch = clock.epoch;
    let current_slot = clock.slot;

    let (withdraw_authority, _) = find_bonds_withdrawer_authority(config_address);

    let all_settlements = get_settlements(rpc_client.clone()).await?;

    let claimable_settlements = all_settlements
        .into_iter()
        .filter(|(settlement_address, settlement)| {
            let is_epoch_in_range = current_epoch <= settlement.epoch_created_for + config.epochs_to_claim_settlement;
            let is_slot_past_threshold = current_slot >= settlement.slot_created_at + config.slots_to_start_settlement_claiming;

            info!(
                "Settlement {} epoch_created_for: {}, current_epoch: {}, epochs_to_claim_settlement: {}, slot_created_at: {}, slots_to_start_settlement_claiming: {}, is_epoch_in_range: {}, is_slot_past_threshold: {}",
                settlement_address,
                settlement.epoch_created_for,
                current_epoch,
                config.epochs_to_claim_settlement,
                settlement.slot_created_at,
                config.slots_to_start_settlement_claiming,
                is_epoch_in_range,
                is_slot_past_threshold
            );

            is_epoch_in_range && is_slot_past_threshold
        }).collect::<Vec<(Pubkey, Settlement)>>();

    let stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&withdraw_authority), None).await?;
    info!(
        "For config {} there are {} stake accounts",
        config_address,
        stake_accounts.len()
    );

    let claimable_stakes = obtain_claimable_stake_accounts_for_settlement(
        stake_accounts,
        config_address,
        claimable_settlements
            .iter()
            .map(|(pubkey, _)| *pubkey)
            .collect(),
        rpc_client.clone(),
    )
    .await?;

    let results = claimable_settlements
        .into_iter()
        .filter_map(|(pubkey, settlement)| {
            if let Some((stake_accounts_lamports, stake_accounts)) = claimable_stakes.get(&pubkey) {
                if stake_accounts.is_empty() {
                    None
                } else {
                    Some(ClaimableSettlementsReturn {
                        settlement_address: pubkey,
                        settlement,
                        stake_accounts_lamports: *stake_accounts_lamports,
                        stake_accounts: stake_accounts.clone(),
                    })
                }
            } else {
                None
            }
        })
        .collect();

    Ok(results)
}

pub async fn list_expired_settlements(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
    config: &Config,
) -> anyhow::Result<Vec<(Pubkey, Settlement)>> {
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let current_epoch = clock.epoch;

    let all_settlements = get_settlements(rpc_client.clone()).await?;

    let bonds_for_settlements =
        get_bonds_for_settlements(rpc_client.clone(), &all_settlements).await?;

    assert_eq!(all_settlements.len(), bonds_for_settlements.len());

    let filtered_settlements: (Vec<_>, Vec<_>) = all_settlements.into_iter().zip(bonds_for_settlements.into_iter())
        .filter(|((settlement_address, settlement), (_, bond))| {
            let is_for_config = bond.is_none() || bond.as_ref().unwrap().config == *config_address;
            let is_expired = current_epoch > settlement.epoch_created_for + config.epochs_to_claim_settlement;

        debug!(
            "Settlement {} epoch_created_for: {}, current_epoch: {}, epochs_to_claim_settlement: {}, is_for_config: {}, is_expired: {}",
            settlement_address,
            settlement.epoch_created_for,
            current_epoch,
            config.epochs_to_claim_settlement,
            is_for_config,
            is_expired
        );

        is_for_config && is_expired
    })
        .unzip();

    Ok(filtered_settlements.0)
}

pub struct SettlementRefundPubkeys {
    pub split_rent_collector: Pubkey,
    pub split_rent_refund_account: Pubkey,
}

/// Checking settlement account for refund pubkeys
/// and returns data usable for closing the Settlement
pub async fn obtain_settlement_closing_refunds(
    rpc_client: Arc<RpcClient>,
    settlement_address: &Pubkey,
    settlement: &Settlement,
    bonds_withdrawer_authority: &Pubkey,
) -> anyhow::Result<SettlementRefundPubkeys> {
    let (settlement_staker_authority, _) = find_settlement_staker_authority(settlement_address);
    let (split_rent_collector, split_rent_refund_account) = {
        if let Some(split_rent_collector) = settlement.split_rent_collector {
            let split_rent_refund_accounts = collect_stake_accounts(
                rpc_client.clone(),
                Some(bonds_withdrawer_authority),
                Some(&settlement_staker_authority),
            )
            .await;
            let split_rent_refund_accounts = if let Err(e) = split_rent_refund_accounts {
                return Err(anyhow!(
                    "For closing settlement {} is required return rent (collector field: {}), cannot find stake account to use to return rent to: {:?}",
                    settlement_address, split_rent_collector, e
                ));
            } else {
                split_rent_refund_accounts?
            };
            let split_rent_refund_account = if let Some(first_account) =
                split_rent_refund_accounts.first()
            {
                first_account.0
            } else {
                return Err(anyhow!(
                    "For closing settlement {} is required return rent (collector field: {}), no settlement funded stake account found to use for returning rent",
                    settlement_address, split_rent_collector
                ));
            };
            (split_rent_collector, split_rent_refund_account)
        } else {
            // whatever existing account, NOTE: anchor does not like Pubkey::default as a mutable account
            (*settlement_address, *settlement_address)
        }
    };
    Ok(SettlementRefundPubkeys {
        split_rent_collector,
        split_rent_refund_account,
    })
}
