use crate::cli_result::CliError;
use anyhow::anyhow;
use log::{debug, info};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
use validator_bonds::state::settlement::{find_settlement_staker_authority, Settlement};

use crate::CONTRACT_V2_DEPLOYMENT_EPOCH;
use validator_bonds_common::settlement_claims::SettlementClaimsBitmap;
use validator_bonds_common::settlements::{
    get_bonds_for_settlements, get_settlement_claims_for_settlement_pubkeys, get_settlements,
};
use validator_bonds_common::stake_accounts::{
    collect_stake_accounts, get_clock, obtain_claimable_stake_accounts_for_settlement,
    CollectedStakeAccounts,
};

#[derive(Debug)]
pub struct ClaimableSettlementsReturn {
    pub settlement_address: Pubkey,
    pub settlement: Settlement,
    pub settlement_claims_address: Pubkey,
    pub settlement_claims: SettlementClaimsBitmap,
    pub stake_accounts_lamports: u64,
    pub stake_accounts: CollectedStakeAccounts,
}

pub async fn list_claimable_settlements(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
    config: &Config,
) -> Result<Vec<ClaimableSettlementsReturn>, CliError> {
    let clock = get_clock(rpc_client.clone())
        .await
        .map_err(CliError::RetryAble)?;
    let current_epoch = clock.epoch;
    let current_slot = clock.slot;

    let (withdraw_authority, _) = find_bonds_withdrawer_authority(config_address);

    let all_settlements = get_settlements(rpc_client.clone())
        .await
        .map_err(CliError::RetryAble)?;

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
        collect_stake_accounts(rpc_client.clone(), Some(&withdraw_authority), None)
            .await
            .map_err(CliError::RetryAble)?;
    info!(
        "For config {} existing {} stake accounts",
        config_address,
        stake_accounts.len()
    );

    // settlement addr, settlement claims addr, bitmap
    let claimable_settlement_claims = get_settlement_claims_for_settlement_pubkeys(
        rpc_client.clone(),
        &claimable_settlements
            .iter()
            .map(|(a, _)| *a)
            .collect::<Vec<_>>(),
    )
    .await
    .map_err(CliError::RetryAble)?
        .into_iter().zip(claimable_settlements.into_iter())
        .filter_map(|((settlement_pubkey, claims_pubkey, claims), (s_addr, settlement))|
        {
            assert_eq!(settlement_pubkey, s_addr);
            if let Some(claims) = claims {
                Some(Ok((settlement_pubkey, settlement, claims_pubkey, claims)))
            } else {
                let error_msg = format!("[list_claimable]: No SettlementClaims account {} for an existing Settlement {}/epoch {}",
                                        claims_pubkey,
                                        settlement_pubkey,
                                        settlement.epoch_created_for
                );
                if settlement.epoch_created_for < CONTRACT_V2_DEPLOYMENT_EPOCH {
                    info!("{}", error_msg);
                    None
                } else {
                    Some(Err(CliError::Critical(anyhow!("CRITICAL {}", error_msg))))
                }
            }
        })
        .collect::<Result<Vec<(Pubkey, Settlement, Pubkey, SettlementClaimsBitmap)>, CliError>>()?;

    let claimable_stakes = obtain_claimable_stake_accounts_for_settlement(
        stake_accounts,
        config_address,
        claimable_settlement_claims
            .iter()
            .map(|(settlement_pubkey, _, _, _)| *settlement_pubkey)
            .collect(),
        rpc_client.clone(),
    )
    .await
    .map_err(CliError::RetryAble)?;

    let results = claimable_settlement_claims
        .into_iter()
        .filter_map(
            |(settlement_address, settlement, settlement_claims_address, settlement_claims)| {
                if let Some((stake_accounts_lamports, stake_accounts)) =
                    claimable_stakes.get(&settlement_address)
                {
                    if stake_accounts.is_empty() {
                        debug!(
                            "No stake accounts for settlement {} (epoch: {}), not claimable",
                            settlement_address,
                            settlement.epoch_created_for
                        );
                        None
                    } else {
                        Some(ClaimableSettlementsReturn {
                            settlement_address,
                            settlement,
                            settlement_claims_address,
                            settlement_claims,
                            stake_accounts_lamports: *stake_accounts_lamports,
                            stake_accounts: stake_accounts.clone(),
                        })
                    }
                } else {
                    // no settlement found in the map then not claimable
                    debug!(
                        "Settlement {} (epoch: {}) not claimable stake accounts in map (probably stakes are not deactivated yet)",
                        settlement_address,
                        settlement.epoch_created_for
                    );
                    None
                }
            },
        )
        .collect();

    Ok(results)
}

pub async fn load_expired_settlements(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
    config: &Config,
) -> anyhow::Result<Vec<(Pubkey, Settlement)>> {
    let clock = get_clock(rpc_client.clone()).await?;
    let current_epoch = clock.epoch;

    let all_settlements = get_settlements(rpc_client.clone()).await?;

    let bonds_for_settlements =
        get_bonds_for_settlements(rpc_client.clone(), &all_settlements).await?;

    assert_eq!(all_settlements.len(), bonds_for_settlements.len());
    debug!(
        "Current epoch: {}, all settlements: {}",
        current_epoch,
        all_settlements.len()
    );

    let filtered_settlements: (Vec<_>, Vec<_>) = all_settlements.into_iter().zip(bonds_for_settlements.into_iter())
        .filter(|((settlement_address, settlement), (_, bond))| {
            let is_for_config = bond.as_ref().map_or(false, |b| b.config == *config_address);
            let is_expired = current_epoch > settlement.epoch_created_for + config.epochs_to_claim_settlement;

        debug!(
            "Settlement {} epoch_created_for: {}, current_epoch: {}, epochs_to_claim_settlement: {}, is_for_config: {}, is_expired: {}",
            settlement_address,
            settlement.epoch_created_for,
            current_epoch,
            config.epochs_to_claim_settlement,
            is_for_config,
            is_expired,
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
            let split_rent_refund_account = if let Some(first_account) = split_rent_refund_accounts
                .iter()
                .find(|collected_stake| collected_stake.2.delegation().is_some())
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
