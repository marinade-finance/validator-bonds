use log::debug;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
use validator_bonds::state::settlement::Settlement;
use validator_bonds_common::settlements::get_settlements;
use validator_bonds_common::stake_accounts::{
    collect_stake_accounts, obtain_claimable_stake_accounts_for_settlement, CollectedStakeAccounts,
};
use validator_bonds_common::utils::get_sysvar_clock;

pub struct ClaimableSettlementsReturn {
    pub settlement_address: Pubkey,
    pub settlement: Settlement,
    pub stake_accounts_lamports: u64,
    pub stake_accounts: CollectedStakeAccounts,
}

pub async fn list_claimable_settlements(
    config_address: &Pubkey,
    config: &Config,
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<ClaimableSettlementsReturn>> {
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let current_epoch = clock.epoch;
    let current_slot = clock.slot;

    let (withdraw_authority, _) = find_bonds_withdrawer_authority(config_address);

    let all_settlements = get_settlements(rpc_client.clone()).await?;

    let claimable_settlements = all_settlements
        .into_iter()
        .filter(|(_, settlement)| {
            let is_epoch_in_range = current_epoch <= settlement.epoch_created_for + config.epochs_to_claim_settlement;
            let is_slot_past_threshold = current_slot >= settlement.slot_created_at + config.slots_to_start_settlement_claiming;

            debug!(
                "Settlement epoch_created_for: {}, current_epoch: {}, epochs_to_claim_settlement: {}, slot_created_at: {}, slots_to_start_settlement_claiming: {}",
                settlement.epoch_created_for,
                current_epoch,
                config.epochs_to_claim_settlement,
                settlement.slot_created_at,
                config.slots_to_start_settlement_claiming
            );

            is_epoch_in_range && is_slot_past_threshold
        }).collect::<Vec<(Pubkey, Settlement)>>();

    let stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(withdraw_authority), None).await?;

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
