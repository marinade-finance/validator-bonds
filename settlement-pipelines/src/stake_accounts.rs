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
use std::cmp::Ordering;
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

pub const MARINADE_LIQUID_STAKER_AUTHORITY: &str = "4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk";
pub const MARINADE_INSTITUTIONAL_STAKER_AUTHORITY: &str =
    "STNi1NHDUi6Hvibvonawgze8fM83PFLeJhuGMEXyGps";

// Stake accounts that were not closed by pipeline for some prevalent reasons
pub const IGNORE_DANGLING_NOT_CLOSABLE_STAKE_ACCOUNTS_LIST: [&str; 2] = [
    // [GEN-5105]: stake accounts belonging to validator accounts that were closed before stake account could be reset (the Settlement was closed)
    // these are for vote account: 84gebYpPpEafPeGJUVA8QzfaTQC3GeyVufCTHpqsQqE2, bond account: Agw2pSmo64BSduy7Q9Ua7ABYzLXGz4zxsqM9u1YMxWS3
    "5u7Dk8JqVJ5CFmxtXEfZJ53wELX4tibwVur9k5k2KGPJ",
    "HZa2FDjWXepz58NwnuDxNp3T7FXCDNKt7YzpPBBpPdtj",
];

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
    non_locked_stake_accounts.sort_by_cached_key(|(_, lamports, stake_account)| {
        get_claiming_priority_key(stake_account, *lamports, clock, stake_history)
    });
    if let Some((pubkey, _, _)) = non_locked_stake_accounts.first() {
        Ok(*pubkey)
    } else if !stake_accounts.is_empty() {
        // NO non-locked stake accounts but(!) some exists, i.e., all available locked
        Err(anyhow!(
            "All stake accounts are locked for claiming ({})",
            stake_accounts.len()
        ))
    } else {
        Err(anyhow!("No stake accounts for claiming"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
        } = delegation.stake_activating_and_deactivating(clock.epoch, stake_history, None);
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
        } = delegation.stake_activating_and_deactivating(clock.epoch, stake_history, None);
        effective + deactivating + activating
    } else {
        0
    }
}

/// Ordering key for define priority of stake accounts for claiming
#[derive(Debug, Clone, Copy)]
struct ClaimingPriorityKey {
    priority: u8,
    second_priority: u64,
}

impl ClaimingPriorityKey {
    fn simple(priority: u8) -> Self {
        Self {
            priority,
            second_priority: 0,
        }
    }

    fn full(priority: u8, second_priority: u64) -> Self {
        Self {
            priority,
            second_priority,
        }
    }
}

impl PartialEq for ClaimingPriorityKey {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.second_priority == other.second_priority
    }
}
impl Eq for ClaimingPriorityKey {}

impl PartialOrd for ClaimingPriorityKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ClaimingPriorityKey {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.priority.cmp(&other.priority) {
            Ordering::Equal => self.second_priority.cmp(&other.second_priority),
            ordering => ordering,
        }
    }
}

fn get_claiming_priority_key(
    stake_account: &StakeStateV2,
    lamports: u64,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> ClaimingPriorityKey {
    let staker = if let Some(authorized) = stake_account.authorized() {
        authorized.staker
    } else {
        Pubkey::default()
    };
    // Marinade liquid and institutional stake accounts need a different priority to other types
    if staker == Pubkey::from_str(MARINADE_LIQUID_STAKER_AUTHORITY).unwrap() {
        match get_stake_state_type(stake_account, clock, stake_history) {
            StakeAccountStateType::DelegatedAndActive => ClaimingPriorityKey::simple(0),
            StakeAccountStateType::DelegatedAndActivating => ClaimingPriorityKey::simple(1),
            StakeAccountStateType::DelegatedAndDeactivating => ClaimingPriorityKey::simple(2),
            StakeAccountStateType::Initialized => ClaimingPriorityKey::simple(3),
            StakeAccountStateType::DelegatedAndDeactivated => ClaimingPriorityKey::simple(4),
            StakeAccountStateType::NonAuthorized => ClaimingPriorityKey::simple(255),
        }
    } else if staker == Pubkey::from_str(MARINADE_INSTITUTIONAL_STAKER_AUTHORITY).unwrap() {
        match get_stake_state_type(stake_account, clock, stake_history) {
            StakeAccountStateType::DelegatedAndDeactivated => {
                ClaimingPriorityKey::full(0, lamports)
            }
            StakeAccountStateType::Initialized => ClaimingPriorityKey::full(1, lamports),
            StakeAccountStateType::DelegatedAndDeactivating => {
                ClaimingPriorityKey::full(2, lamports)
            }
            StakeAccountStateType::DelegatedAndActive => ClaimingPriorityKey::full(3, lamports),
            StakeAccountStateType::DelegatedAndActivating => ClaimingPriorityKey::full(4, lamports),
            StakeAccountStateType::NonAuthorized => ClaimingPriorityKey::full(255, lamports),
        }
    } else {
        match get_stake_state_type(stake_account, clock, stake_history) {
            StakeAccountStateType::Initialized => ClaimingPriorityKey::simple(0),
            StakeAccountStateType::DelegatedAndDeactivated => ClaimingPriorityKey::simple(1),
            StakeAccountStateType::DelegatedAndDeactivating => ClaimingPriorityKey::simple(2),
            StakeAccountStateType::DelegatedAndActive => ClaimingPriorityKey::simple(3),
            StakeAccountStateType::DelegatedAndActivating => ClaimingPriorityKey::simple(4),
            StakeAccountStateType::NonAuthorized => ClaimingPriorityKey::simple(255),
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

/// Sum of lamports held by the stake accounts funding a Settlement — those whose staker authority
/// is `settlement_staker_authority` — with each account's retained `minimal_stake_lamports` buffer
/// excluded so the result reflects the claim-covering amount. It is a balance check only and does
/// not consider delegation or lockup state.
///
/// Used because Marinade-funded settlements are funded by creating such a stake account directly
/// instead of via the `fund_settlement` instruction, so their `Settlement.lamports_funded` stays
/// `0` and the stake accounts are the only on-chain record of how much was funded.
pub fn settlement_funded_claimable_lamports(
    settlement_staker_authority: &Pubkey,
    stake_accounts: &CollectedStakeAccounts,
    minimal_stake_lamports: u64,
) -> u64 {
    stake_accounts
        .iter()
        .filter(|(_, _, state)| {
            matches!(state.authorized(), Some(authorized) if authorized.staker == *settlement_staker_authority)
        })
        .map(|(_, lamports, _)| lamports.saturating_sub(minimal_stake_lamports))
        .sum()
}

/// Preparing instructions to merge stake accounts from stake_accounts_to_merge into destination_stake
/// Returning list of stake accounts addresses that cannot be merged.
/// Prepared transactions are passed from the function through mutable reference of `transaction_builder`.
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
                format!("MergeStake: {stake_account_address} -> {destination_stake}"),
            )?;
        }
    }
    Ok(non_mergeable_stake_accounts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::stake::state::{Authorized, Lockup, Meta};

    const SOL: u64 = 1_000_000_000;
    // minimum delegation (1 SOL) + rent exemption, matching `minimal_stake_lamports` used by the
    // funding pipeline.
    const MIN: u64 = SOL + STAKE_ACCOUNT_RENT_EXEMPTION;

    fn initialized_stake(staker: Pubkey, withdrawer: Pubkey) -> StakeStateV2 {
        StakeStateV2::Initialized(Meta {
            rent_exempt_reserve: STAKE_ACCOUNT_RENT_EXEMPTION,
            authorized: Authorized { staker, withdrawer },
            lockup: Lockup::default(),
        })
    }

    #[test]
    fn funded_claimable_sums_only_accounts_for_the_staker_authority() {
        let staker = Pubkey::new_unique();
        let other_staker = Pubkey::new_unique();
        let withdrawer = Pubkey::new_unique();
        let accounts: CollectedStakeAccounts = vec![
            // two accounts funded to `staker`: claimable is balance minus the min buffer each
            (
                Pubkey::new_unique(),
                5 * SOL + MIN,
                initialized_stake(staker, withdrawer),
            ),
            (
                Pubkey::new_unique(),
                3 * SOL + MIN,
                initialized_stake(staker, withdrawer),
            ),
            // belongs to a different settlement -> must be ignored
            (
                Pubkey::new_unique(),
                9 * SOL + MIN,
                initialized_stake(other_staker, withdrawer),
            ),
        ];
        assert_eq!(
            settlement_funded_claimable_lamports(&staker, &accounts, MIN),
            8 * SOL
        );
    }

    #[test]
    fn funded_claimable_is_zero_when_no_matching_stake_accounts() {
        let staker = Pubkey::new_unique();
        let withdrawer = Pubkey::new_unique();
        let accounts: CollectedStakeAccounts = vec![(
            Pubkey::new_unique(),
            10 * SOL,
            initialized_stake(Pubkey::new_unique(), withdrawer),
        )];
        assert_eq!(
            settlement_funded_claimable_lamports(&staker, &accounts, MIN),
            0
        );
        assert_eq!(
            settlement_funded_claimable_lamports(&staker, &vec![], MIN),
            0
        );
    }

    #[test]
    fn funded_claimable_saturates_for_dust_below_the_min_buffer() {
        // an account holding less than the min buffer contributes 0 (saturating_sub), never panics
        let staker = Pubkey::new_unique();
        let withdrawer = Pubkey::new_unique();
        let accounts: CollectedStakeAccounts = vec![(
            Pubkey::new_unique(),
            MIN / 2,
            initialized_stake(staker, withdrawer),
        )];
        assert_eq!(
            settlement_funded_claimable_lamports(&staker, &accounts, MIN),
            0
        );
    }
}
