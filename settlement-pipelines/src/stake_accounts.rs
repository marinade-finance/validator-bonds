use crate::anchor::add_instruction_to_builder;
use anchor_client::anchor_lang::solana_program::stake_history::StakeHistoryEntry;
use anchor_client::{DynSigner, Program};
use anyhow::anyhow;
use log::warn;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::stake::program::ID as stake_program_id;
use solana_sdk::stake::state::StakeStateV2;
use solana_sdk::stake_history::StakeHistory;
use solana_sdk::sysvar::{
    clock::ID as clock_sysvar_id, stake_history::ID as stake_history_sysvar_id,
};
use solana_transaction_builder::TransactionBuilder;
use std::str::FromStr;
use std::sync::Arc;
use validator_bonds::instructions::MergeStakeArgs;
use validator_bonds::ID as validator_bonds_id;
use validator_bonds_common::constants::find_event_authority;
use validator_bonds_common::stake_accounts::{
    is_locked, CollectedStakeAccount, CollectedStakeAccounts,
};

// TODO: better to be loaded from chain
pub const STAKE_ACCOUNT_RENT_EXEMPTION: u64 = 2282880;

// 4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk
pub const MARINADE_LIQUID_STAKER_AUTHORITY: &str = "4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk";

// Prioritize collected stake accounts where to claim to.
// - error if all are locked or no stake accounts
pub fn prioritize_for_claiming(
    stake_accounts: &CollectedStakeAccounts,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> anyhow::Result<Pubkey> {
    let mut non_locked_stake_accounts = stake_accounts
        .iter()
        .filter(|(_, _, stake)| !is_locked(stake, clock))
        .collect::<Vec<_>>();
    non_locked_stake_accounts.sort_by_cached_key(|(_, _, stake_account)| {
        get_claiming_priority_key(stake_account, clock, stake_history)
    });
    return if let Some((pubkey, _, _)) = non_locked_stake_accounts.first() {
        Ok(*pubkey)
    } else if !stake_accounts.is_empty() {
        // NO non-locked stake accounts but(!) some exists, i.e., all available locked
        Err(anyhow!(
            "All stake accounts are locked for claiming ({})",
            stake_accounts.len()
        ))
    } else {
        Err(anyhow!("No stake accounts for claiming"))
    };
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StakeAccountStateType {
    DelegatedAndDeactivating,
    DelegatedAndActivating,
    DelegatedAndDeactivated,
    DelegatedAndActive,
    Initialized,
    NonAuthorized,
}

pub fn get_stake_state_type(
    stake_account_state: &StakeStateV2,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> StakeAccountStateType {
    if let StakeStateV2::Initialized(_) = stake_account_state {
        // stake account is initialized and not delegated, it can be delegated just now
        StakeAccountStateType::Initialized
    } else if let Some(delegation) = stake_account_state.delegation() {
        // stake account was delegated, verification of the delegation state
        let StakeHistoryEntry {
            effective,
            deactivating,
            activating,
        } = delegation.stake_activating_and_deactivating(clock.epoch, Some(stake_history), None);
        if effective == 0 && activating == 0 {
            // all available for immediate delegation
            StakeAccountStateType::DelegatedAndDeactivated
        } else if deactivating > 0 {
            // stake is deactivating, possible to delegate in the next epoch
            StakeAccountStateType::DelegatedAndDeactivating
        } else if activating > 0 {
            // activating thus not possible to delegate soon (first need to un-delegate and then delegate)
            StakeAccountStateType::DelegatedAndActivating
        } else {
            // delegated and active, we need to deactivate and wait for next epoch to delegate
            StakeAccountStateType::DelegatedAndActive
        }
    } else {
        StakeAccountStateType::NonAuthorized
    }
}

pub fn get_delegated_amount(
    stake_account_state: &StakeStateV2,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> u64 {
    if let Some(delegation) = stake_account_state.delegation() {
        let StakeHistoryEntry {
            effective,
            deactivating,
            activating,
        } = delegation.stake_activating_and_deactivating(clock.epoch, Some(stake_history), None);
        effective + deactivating + activating
    } else {
        0
    }
}

fn get_claiming_priority_key(
    stake_account: &StakeStateV2,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> u8 {
    // HOTFIX: Marinade liquid staking stake accounts need a different priority to other types
    let staker = if let Some(authorized) = stake_account.authorized() {
        authorized.staker
    } else {
        Pubkey::default()
    };
    if staker == Pubkey::from_str(MARINADE_LIQUID_STAKER_AUTHORITY).unwrap() {
        match get_stake_state_type(stake_account, clock, stake_history) {
            StakeAccountStateType::DelegatedAndActive => 0,
            StakeAccountStateType::DelegatedAndActivating => 1,
            StakeAccountStateType::DelegatedAndDeactivating => 2,
            StakeAccountStateType::Initialized => 3,
            StakeAccountStateType::DelegatedAndDeactivated => 4,
            StakeAccountStateType::NonAuthorized => 255,
        }
    } else {
        match get_stake_state_type(stake_account, clock, stake_history) {
            StakeAccountStateType::Initialized => 0,
            StakeAccountStateType::DelegatedAndDeactivated => 1,
            StakeAccountStateType::DelegatedAndDeactivating => 2,
            StakeAccountStateType::DelegatedAndActive => 3,
            StakeAccountStateType::DelegatedAndActivating => 4,
            StakeAccountStateType::NonAuthorized => 255,
        }
    }
}

pub fn filter_settlement_funded(
    stake_accounts: CollectedStakeAccounts,
    clock: &Clock,
) -> CollectedStakeAccounts {
    stake_accounts
        .into_iter()
        .filter(|(_, _, state)| {
            let is_settlement_funded = if let Some(authorized) = state.authorized() {
                authorized.staker != authorized.withdrawer
            } else {
                false
            };
            is_settlement_funded && !is_locked(state, clock)
        })
        .collect()
}

/// Preparing instructions to merge stake accounts from stake_accounts_to_merge into destination_stake
/// Returning list of stake accounts addresses that cannot be merged.
/// Prepared transactions are passed from the function through mutable referecne of `transaction_builder`.
#[allow(clippy::too_many_arguments)]
pub async fn prepare_merge_instructions(
    stake_accounts_to_merge: Vec<&CollectedStakeAccount>,
    destination_stake: Pubkey,
    destination_stake_state_type: StakeAccountStateType,
    settlement_address: &Pubkey,
    vote_account_address: Option<&Pubkey>,
    program: &Program<Arc<DynSigner>>,
    config_address: &Pubkey,
    staker_authority: &Pubkey,
    transaction_builder: &mut TransactionBuilder,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> anyhow::Result<Vec<Pubkey>> {
    let mut non_mergeable_stake_accounts: Vec<Pubkey> = vec![];
    // can we merge stake accounts? (stake accounts can be merged only when both in the same state)
    for (stake_account_address, _, stake_account_state) in stake_accounts_to_merge {
        let stake_account_to_merge_state_type =
            get_stake_state_type(stake_account_state, clock, stake_history);
        if stake_account_to_merge_state_type != destination_stake_state_type {
            // will be funded each separately
            warn!(
                "Cannot merge stake accounts {} and {} for funding settlement {} (vote account {}) as they are in different states",
                stake_account_address,
                destination_stake,
                settlement_address,
                vote_account_address.map_or_else(|| "not-known".to_string(), |v| v.to_string())
            );
            non_mergeable_stake_accounts.push(*stake_account_address);
        } else {
            // will be funded as one merged account
            let req = program
                .request()
                .accounts(validator_bonds::accounts::MergeStake {
                    config: *config_address,
                    stake_history: stake_history_sysvar_id,
                    clock: clock_sysvar_id,
                    source_stake: *stake_account_address,
                    destination_stake,
                    staker_authority: *staker_authority,
                    stake_program: stake_program_id,
                    program: validator_bonds_id,
                    event_authority: find_event_authority().0,
                })
                .args(validator_bonds::instruction::MergeStake {
                    merge_args: MergeStakeArgs {
                        settlement: *settlement_address,
                    },
                });
            add_instruction_to_builder(
                transaction_builder,
                &req,
                format!(
                    "MergeStake: {} -> {}",
                    stake_account_address, destination_stake
                ),
            )?;
        }
    }
    Ok(non_mergeable_stake_accounts)
}
