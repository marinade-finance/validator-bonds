use anchor_client::anchor_lang::solana_program::stake_history::StakeHistoryEntry;
use anyhow::anyhow;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::stake::state::StakeStateV2;
use solana_sdk::stake_history::StakeHistory;
use validator_bonds_common::stake_accounts::{is_locked, CollectedStakeAccounts};

// prioritize collected stake accounts by:
// - 1. initialized, non-delegated
// - 2. deactivating
// - 3. any non-locked
// - error if all are locked or no stake accounts
pub fn prioritize_for_claiming(
    stake_accounts: &CollectedStakeAccounts,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> anyhow::Result<Pubkey> {
    let mut non_locked_stake_accounts = stake_accounts
        .iter()
        .filter(|(_pubkey, _, stake)| !is_locked(stake, clock))
        .collect::<Vec<_>>();
    non_locked_stake_accounts.sort_by(|(_, _, stake_account1), (_, _, stake_account2)| {
        priority_rating_non_locked(stake_account1, clock, stake_history).cmp(
            &priority_rating_non_locked(stake_account2, clock, stake_history),
        )
    });
    return if let Some((pubkey, _, _)) = non_locked_stake_accounts.first() {
        Ok(*pubkey)
    } else if !stake_accounts.is_empty() {
        // there is no non-locked stake accounts but there are some available, i.e., all locked
        Err(anyhow!(
            "All stake accounts are locked ({})",
            stake_accounts.len()
        ))
    } else {
        Err(anyhow!("No stake accounts"))
    };
}

fn priority_rating_non_locked(
    stake_account: &StakeStateV2,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> u8 {
    if let StakeStateV2::Initialized(_) = stake_account {
        // stake account is initialized and not delegated, it can be delegated just now
        0
    } else if let Some(delegation) = stake_account.delegation() {
        // stake account was delegated, verification of the delegation state
        let StakeHistoryEntry {
            effective,
            deactivating,
            activating,
        } = delegation.stake_activating_and_deactivating(clock.epoch, Some(stake_history), None);
        if effective == 0 && activating == 0 {
            // all available for immediate delegation
            1
        } else if deactivating > 0 {
            // stake is deactivating, possible to delegate in the next epoch
            2
        } else {
            // delegated thus not possible to delegate soon (first need to un-delegate and then delegate)
            3
        }
    } else {
        255
    }
}
