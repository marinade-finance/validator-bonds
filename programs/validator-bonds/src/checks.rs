#![allow(deprecated)]
// allowing deprecation as anchor 0.29.0 works with old version of StakeState struct

use crate::error::ErrorCode;
use crate::state::bond::Bond;
use anchor_lang::prelude::*;
use anchor_lang::prelude::{msg, Pubkey};
use anchor_lang::require_keys_eq;
use anchor_lang::solana_program::clock::Epoch;
use anchor_lang::solana_program::stake::program::ID as stake_program_id;
use anchor_lang::solana_program::stake::state::{Delegation, Meta, Stake, StakeState};
use anchor_lang::solana_program::stake_history::StakeHistoryEntry;
use anchor_lang::solana_program::system_program::ID as system_program_id;
use anchor_lang::solana_program::vote::program::id as vote_program_id;
use anchor_spl::stake::StakeAccount;
use std::ops::Deref;

/// Verification the account is owned by vote program + matching validator identity
pub fn check_vote_account_validator_identity(
    vote_account: &UncheckedAccount,
    expected_validator_identity: &Pubkey,
) -> Result<()> {
    // https://github.com/solana-labs/solana/blob/v1.17.10/sdk/program/src/vote/state/mod.rs#L287
    let node_pubkey = get_validator_vote_account_validator_identity(vote_account)?;
    require_keys_eq!(
        *expected_validator_identity,
        node_pubkey,
        ErrorCode::VoteAccountValidatorIdentityMismatch
    );
    Ok(())
}

pub fn get_validator_vote_account_validator_identity(
    vote_account: &UncheckedAccount,
) -> Result<Pubkey> {
    get_from_validator_vote_account(vote_account, 4, "validator identity")
}

pub fn get_validator_vote_account_authorized_withdrawer(
    vote_account: &UncheckedAccount,
) -> Result<Pubkey> {
    get_from_validator_vote_account(vote_account, 36, "authorized withdrawer")
}

fn get_from_validator_vote_account(
    vote_account: &UncheckedAccount,
    byte_position: usize,
    pubkey_name: &str,
) -> Result<Pubkey> {
    require_keys_eq!(
        *vote_account.owner,
        vote_program_id(),
        ErrorCode::InvalidVoteAccountProgramId
    );
    let validator_vote_data = &vote_account.data.borrow()[..];

    // verification if the vote account data type is known one
    // from the slice of the first 4 bytes getting the uint number that can be checked
    let type_slice: [u8; 4] = validator_vote_data[0..4].try_into().map_err(|err| {
        msg!(
            "Cannot get vote account type of address {} data: {:?}",
            vote_account.key,
            err
        );
        error!(ErrorCode::FailedToDeserializeVoteAccount)
            .with_values(("vote_account", vote_account.key()))
    })?;
    // https://github.com/solana-labs/solana/blob/v1.17.10/sdk/program/src/vote/state/vote_state_versions.rs#L4
    // as of 1.17.10 the known state versions are: 0, 1, 2
    let vote_state_type = u32::from_le_bytes(type_slice);
    if vote_state_type > 2 {
        msg!(
            "Invalid vote account {} data type: {}",
            vote_account.key,
            vote_state_type,
        );
        return Err(error!(ErrorCode::InvalidVoteAccountType)
            .with_values(("vote_account", vote_account.key())));
    }

    // let's find position of the pubkey within the vote state account data
    // https://github.com/solana-labs/solana/pull/30515
    // https://github.com/solana-labs/solana/blob/v1.17.10/sdk/program/src/vote/state/mod.rs#L290
    if byte_position < 4 || validator_vote_data.len() < byte_position + 32 {
        msg!(
            "Cannot get {} from vote account {} data",
            pubkey_name,
            vote_account.key,
        );
        return Err(ErrorCode::FailedToDeserializeVoteAccount.into());
    }
    let pubkey_slice: [u8; 32] = validator_vote_data[byte_position..byte_position + 32]
        .try_into()
        .map_err(|err| {
            msg!(
                "Cannot get {} from vote account {} data: {:?}",
                pubkey_name,
                vote_account.key,
                err
            );
            error!(ErrorCode::FailedToDeserializeVoteAccount)
                .with_values(("vote_account", vote_account.key()))
        })?;
    Ok(Pubkey::from(pubkey_slice))
}

/// Bond account change is permitted to bond authority or validator vote account owner
pub fn check_bond_authority(
    authority: &Pubkey,
    bond_account: &Bond,
    vote_account: &UncheckedAccount,
) -> bool {
    if authority == &bond_account.authority.key() {
        true
    } else {
        check_vote_account_validator_identity(vote_account, authority).map_or(false, |_| true)
    }
}

/// Check if the stake account is delegated to the right validator
pub fn check_stake_valid_delegation(
    stake_account: &StakeAccount,
    vote_account: &Pubkey,
) -> Result<Delegation> {
    if let Some(delegation) = get_delegation(stake_account)? {
        require_keys_eq!(
            delegation.voter_pubkey,
            *vote_account,
            ErrorCode::BondStakeWrongDelegation
        );
        Ok(delegation)
    } else {
        msg!(
            "Stake account is not delegated: {:?}",
            stake_account.deref()
        );
        err!(ErrorCode::StakeNotDelegated)
    }
}

/// the StakeAccount::delegation could be used, but we want to verify
/// the state of the stake account that is generally expected for the protocol
pub fn get_delegation(stake_account: &StakeAccount) -> Result<Option<Delegation>> {
    let stake_state = stake_account.deref();
    match stake_state {
        StakeState::Initialized(_meta) => Ok(None),
        StakeState::Stake(_, stake) => Ok(Some(stake.delegation)),
        _ => Err(error!(ErrorCode::WrongStakeAccountState)
            .with_values(("stake_account", format!("{:?}", stake_state)))),
    }
}

pub fn check_stake_is_initialized_with_withdrawer_authority(
    stake_account: &StakeAccount,
    authority: &Pubkey,
    stake_account_attribute_name: &str,
) -> Result<Meta> {
    let stake_meta = stake_account.meta().ok_or(
        error!(ErrorCode::UninitializedStake).with_account_name(stake_account_attribute_name),
    )?;
    if stake_meta.authorized.withdrawer != *authority {
        return Err(error!(ErrorCode::WrongStakeAccountWithdrawer)
            .with_account_name(stake_account_attribute_name)
            .with_pubkeys((stake_meta.authorized.withdrawer, *authority)));
    }
    Ok(stake_meta)
}

pub fn check_stake_is_not_locked(
    stake_account: &StakeAccount,
    clock: &Clock,
    stake_account_attribute_name: &str,
) -> Result<()> {
    if let Some(stake_lockup) = stake_account.lockup() {
        if stake_lockup.is_in_force(clock, None) {
            msg!("Stake account is locked: {:?}", stake_account.deref());
            return Err(
                error!(ErrorCode::StakeLockedUp).with_account_name(stake_account_attribute_name)
            );
        }
    }
    Ok(())
}

/// Verification of the stake account state that's
///   - stake account is delegated
///   - stake state is either activating or activated
// See https://github.com/marinade-finance/native-staking/blob/a8c7d5f/bot/src/utils/stakes.rs#L66-L87
pub fn check_stake_exist_and_activating_or_activated(
    stake_account: &StakeAccount,
    epoch: Epoch,
    stake_history: &StakeHistory,
) -> Result<Stake> {
    if let Some(stake) = stake_account.stake() {
        let StakeHistoryEntry {
            effective,
            activating,
            deactivating,
        } = stake
            .delegation
            .stake_activating_and_deactivating(epoch, Some(stake_history), None);
        if (effective == 0 && activating == 0) || deactivating > 0 {
            msg!(
                "Stake account is neither activating nor activated: {:?}",
                stake_account.deref()
            );
            return Err(
                error!(ErrorCode::NoStakeOrNotActivatingOrActivated).with_values((
                    "effective/activating/deactivating",
                    format!("{}/{}/{}", effective, activating, deactivating),
                )),
            );
        }
        Ok(stake)
    } else {
        msg!(
            "Stake account is not delegated: {:?}",
            stake_account.deref()
        );
        err!(ErrorCode::StakeNotDelegated)
    }
}

pub fn deserialize_stake_account(account: &UncheckedAccount) -> Result<StakeAccount> {
    require_keys_eq!(
        *account.owner,
        stake_program_id,
        ErrorCode::InvalidStakeAccountProgramId
    );
    if account.try_lamports()? == 0 {
        return Err(ErrorCode::InvalidStakeAccountState.into());
    }
    let stake_state = account.try_borrow_data()?;
    StakeAccount::try_deserialize(&mut stake_state.as_ref())
}

pub fn is_closed(account: &UncheckedAccount) -> bool {
    account.try_lamports().unwrap_or(0) == 0 && account.owner == &system_program_id
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::{AccountInfo, Clock, Pubkey, UncheckedAccount};
    use anchor_lang::solana_program::stake::stake_flags::StakeFlags;
    use anchor_lang::solana_program::stake::state::{Authorized, Lockup, Stake, StakeStateV2};
    use anchor_lang::solana_program::vote::state::{VoteInit, VoteState, VoteStateVersions};
    use std::ops::DerefMut;

    fn test_bond_with_authority(authority: Pubkey) -> Bond {
        Bond {
            config: Pubkey::default(),
            vote_account: Pubkey::default(),
            authority,
            cpmpe: 0,
            bump: 0,
            max_stake_wanted: 0,
            reserved: [0; 134],
        }
    }

    #[test]
    pub fn validator_vote_account_owner_check() {
        let (vote_init, mut serialized_data) = get_vote_account_data();
        let mut lamports = 10000_u64;
        let account_key = Pubkey::new_unique();
        let wrong_owner = Pubkey::new_unique();
        let account = AccountInfo::new(
            &account_key,
            false,
            true,
            &mut lamports,
            serialized_data.deref_mut(),
            &wrong_owner,
            false,
            3,
        );
        let wrong_owner_account = UncheckedAccount::try_from(&account);
        assert_eq!(
            check_vote_account_validator_identity(
                &wrong_owner_account,
                &vote_init.authorized_voter,
            ),
            Err(ErrorCode::InvalidVoteAccountProgramId.into())
        );

        let owner = vote_program_id();
        let account = AccountInfo::new(
            &account_key,
            false,
            true,
            &mut lamports,
            serialized_data.deref_mut(),
            &owner,
            false,
            3,
        );
        let unchecked_account = UncheckedAccount::try_from(&account);

        check_vote_account_validator_identity(&unchecked_account, &vote_init.node_pubkey).unwrap();
        assert_eq!(
            check_vote_account_validator_identity(&unchecked_account, &Pubkey::default(),),
            Err(ErrorCode::VoteAccountValidatorIdentityMismatch.into())
        );
        assert_eq!(
            check_vote_account_validator_identity(&unchecked_account, &Pubkey::default(),),
            Err(ErrorCode::VoteAccountValidatorIdentityMismatch.into())
        );
    }

    #[test]
    pub fn bond_change_permitted_check() {
        let (vote_init, mut serialized_data) = get_vote_account_data();
        let mut lamports = 10000_u64;
        let account_key = Pubkey::new_unique();
        let owner = vote_program_id();
        let account = AccountInfo::new(
            &account_key,
            false,
            true,
            &mut lamports,
            serialized_data.deref_mut(),
            &owner,
            false,
            3,
        );
        let unchecked_account = UncheckedAccount::try_from(&account);

        let bond_authority = Pubkey::new_unique();
        assert!(check_bond_authority(
            &bond_authority,
            &test_bond_with_authority(bond_authority),
            &unchecked_account,
        ));
        assert!(check_bond_authority(
            &vote_init.node_pubkey,
            &test_bond_with_authority(bond_authority),
            &unchecked_account,
        ));
        assert!(!check_bond_authority(
            &Pubkey::new_unique(),
            &test_bond_with_authority(bond_authority),
            &unchecked_account,
        ));
    }

    #[test]
    pub fn stake_valid_delegation_check() {
        let uninitialized_stake_account = get_stake_account(StakeStateV2::Uninitialized);
        assert_eq!(
            check_stake_valid_delegation(&uninitialized_stake_account, &Pubkey::default()),
            Err(ErrorCode::WrongStakeAccountState.into())
        );

        let initialized_stake_account =
            get_stake_account(StakeStateV2::Initialized(Meta::default()));
        assert_eq!(
            check_stake_valid_delegation(&initialized_stake_account, &Pubkey::default()),
            Err(ErrorCode::StakeNotDelegated.into())
        );

        let rewards_pool_stake_account = get_stake_account(StakeStateV2::RewardsPool);
        assert_eq!(
            check_stake_valid_delegation(&rewards_pool_stake_account, &Pubkey::default()),
            Err(ErrorCode::WrongStakeAccountState.into())
        );

        let default_delegated_stake_account = get_stake_account(StakeStateV2::Stake(
            Meta::default(),
            Stake::default(),
            StakeFlags::empty(),
        ));
        assert_eq!(
            check_stake_valid_delegation(&default_delegated_stake_account, &Pubkey::default()),
            Ok(Delegation::default())
        );

        // correct delegation
        let vote_account = Pubkey::new_unique();
        let delegated_stake_account = get_delegated_stake_account(Some(vote_account), None, None);
        assert_eq!(
            check_stake_valid_delegation(&delegated_stake_account, &vote_account),
            Ok(Delegation {
                voter_pubkey: vote_account,
                ..Delegation::default()
            })
        );

        // wrong delegation
        let delegated_stake_account = get_delegated_stake_account(None, None, None);
        assert_eq!(
            check_stake_valid_delegation(&delegated_stake_account, &vote_account),
            Err(ErrorCode::BondStakeWrongDelegation.into())
        );
    }

    #[test]
    pub fn stake_initialized_with_authority_check() {
        let uninitialized_stake_account = get_stake_account(StakeStateV2::Uninitialized);
        assert_eq!(
            check_stake_is_initialized_with_withdrawer_authority(
                &uninitialized_stake_account,
                &Pubkey::default(),
                ""
            ),
            Err(ErrorCode::UninitializedStake.into())
        );
        let rewards_pool_stake_account = get_stake_account(StakeStateV2::RewardsPool);
        assert_eq!(
            check_stake_is_initialized_with_withdrawer_authority(
                &rewards_pool_stake_account,
                &Pubkey::default(),
                ""
            ),
            Err(ErrorCode::UninitializedStake.into())
        );

        let initialized_stake_account =
            get_stake_account(StakeStateV2::Initialized(Meta::default()));
        assert_eq!(
            check_stake_is_initialized_with_withdrawer_authority(
                &initialized_stake_account,
                &Pubkey::default(),
                ""
            ),
            Ok(Meta::default())
        );
        let default_delegated_stake_account = get_stake_account(StakeStateV2::Stake(
            Meta::default(),
            Stake::default(),
            StakeFlags::empty(),
        ));
        assert_eq!(
            check_stake_is_initialized_with_withdrawer_authority(
                &default_delegated_stake_account,
                &Pubkey::default(),
                ""
            ),
            Ok(Meta::default())
        );

        // correct owner
        let withdrawer = Pubkey::new_unique();
        let staker = Pubkey::new_unique();
        let delegated_stake_account =
            get_delegated_stake_account(None, Some(withdrawer), Some(staker));
        assert_eq!(
            check_stake_is_initialized_with_withdrawer_authority(
                &delegated_stake_account,
                &withdrawer,
                ""
            ),
            Ok(Meta {
                authorized: Authorized { withdrawer, staker },
                ..Meta::default()
            })
        );

        // wrong owner
        let wrong_withdrawer = Pubkey::new_unique();
        let delegated_stake_account =
            get_delegated_stake_account(None, Some(withdrawer), Some(staker));
        assert_eq!(
            check_stake_is_initialized_with_withdrawer_authority(
                &delegated_stake_account,
                &wrong_withdrawer,
                ""
            ),
            Err(ErrorCode::WrongStakeAccountWithdrawer.into())
        );
    }

    #[test]
    pub fn stake_is_not_locked_check() {
        let clock = get_clock();

        // no lock on default stake account
        let unlocked_stake_account = get_stake_account(StakeStateV2::Uninitialized);
        assert_eq!(
            check_stake_is_not_locked(&unlocked_stake_account, &clock, ""),
            Ok(())
        );
        let rewards_pool_stake_account = get_stake_account(StakeStateV2::RewardsPool);
        assert_eq!(
            check_stake_is_not_locked(&rewards_pool_stake_account, &clock, ""),
            Ok(())
        );

        let initialized_stake_account =
            get_stake_account(StakeStateV2::Initialized(Meta::default()));
        assert_eq!(
            check_stake_is_not_locked(&initialized_stake_account, &clock, ""),
            Ok(())
        );
        let default_delegated_stake_account = get_stake_account(StakeStateV2::Stake(
            Meta::default(),
            Stake::default(),
            StakeFlags::empty(),
        ));
        assert_eq!(
            check_stake_is_not_locked(&default_delegated_stake_account, &clock, ""),
            Ok(())
        );

        let custodian = Pubkey::new_unique();
        let epoch_lockup = Lockup {
            epoch: clock.epoch + 1, // lock-up to the next epoch
            unix_timestamp: 0,
            custodian,
        };
        let epoch_locked_stake_account = get_stake_account(StakeStateV2::Stake(
            Meta {
                lockup: epoch_lockup,
                ..Meta::default()
            },
            Stake::default(),
            StakeFlags::empty(),
        ));

        assert!(clock.epoch > 0 && clock.unix_timestamp > 0);

        // locked
        assert_eq!(
            check_stake_is_not_locked(&epoch_locked_stake_account, &clock, ""),
            Err(ErrorCode::StakeLockedUp.into())
        );
        assert_eq!(
            check_stake_is_not_locked(&epoch_locked_stake_account, &clock, ""),
            Err(ErrorCode::StakeLockedUp.into())
        );

        let unix_timestamp_lockup = Lockup {
            epoch: 0,
            unix_timestamp: clock.unix_timestamp + 1, // lock-up to the future timestamp
            custodian,
        };
        let unix_locked_stake_account = get_stake_account(StakeStateV2::Stake(
            Meta {
                lockup: unix_timestamp_lockup,
                ..Meta::default()
            },
            Stake::default(),
            StakeFlags::empty(),
        ));
        assert_eq!(
            check_stake_is_not_locked(&unix_locked_stake_account, &clock, ""),
            Err(ErrorCode::StakeLockedUp.into())
        );
    }

    #[test]
    pub fn stake_is_activated_or_activating_check() {
        let clock = get_clock();
        let stake_history = StakeHistory::default();

        // no stake delegation
        let no_stake_stake_account = get_stake_account(StakeStateV2::Uninitialized);
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &no_stake_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::StakeNotDelegated.into())
        );
        let rewards_pool_stake_account = get_stake_account(StakeStateV2::RewardsPool);
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &rewards_pool_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::StakeNotDelegated.into())
        );
        let initialized_stake_account =
            get_stake_account(StakeStateV2::Initialized(Meta::default()));
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &initialized_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::StakeNotDelegated.into())
        );

        // delegated but no stake
        let delegated_stake_state =
            StakeStateV2::Stake(Meta::default(), Stake::default(), StakeFlags::empty());
        let delegated_stake_account = get_stake_account(delegated_stake_state);
        assert_eq!(
            get_delegation_state(&delegated_stake_account, clock.epoch, &stake_history),
            DelegationState::Deactivated
        );
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &delegated_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::NoStakeOrNotActivatingOrActivated.into())
        );

        // requirements for the mocked clock instance
        assert!(clock.epoch > 0);

        let stake_state_deactivated = StakeStateV2::Stake(
            Meta::default(),
            Stake {
                delegation: Delegation {
                    stake: 100,
                    activation_epoch: u64::MAX,
                    deactivation_epoch: clock.epoch - 1,
                    ..Delegation::default()
                },
                ..Stake::default()
            },
            StakeFlags::empty(),
        );
        let stake_account_deactivated = get_stake_account(stake_state_deactivated);
        assert_eq!(
            get_delegation_state(&stake_account_deactivated, clock.epoch, &stake_history),
            DelegationState::Deactivated
        );
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &stake_account_deactivated,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::NoStakeOrNotActivatingOrActivated.into())
        );

        let stake_state_deactivated_2 = StakeStateV2::Stake(
            Meta::default(),
            Stake {
                delegation: Delegation {
                    stake: 100,
                    activation_epoch: clock.epoch,
                    deactivation_epoch: clock.epoch,
                    ..Delegation::default()
                },
                ..Stake::default()
            },
            StakeFlags::empty(),
        );
        let stake_account_deactivated_2 = get_stake_account(stake_state_deactivated_2);
        assert_eq!(
            get_delegation_state(&stake_account_deactivated_2, clock.epoch, &stake_history),
            DelegationState::Deactivated
        );
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &stake_account_deactivated_2,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::NoStakeOrNotActivatingOrActivated.into())
        );

        let stake_state_deactivating = StakeStateV2::Stake(
            Meta::default(),
            Stake {
                delegation: Delegation {
                    stake: 100,
                    activation_epoch: u64::MAX,
                    deactivation_epoch: clock.epoch,
                    ..Delegation::default()
                },
                ..Stake::default()
            },
            StakeFlags::empty(),
        );
        let stake_account_deactivating = get_stake_account(stake_state_deactivating);
        assert_eq!(
            get_delegation_state(&stake_account_deactivating, clock.epoch, &stake_history),
            DelegationState::Deactivating
        );
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &stake_account_deactivating,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::NoStakeOrNotActivatingOrActivated.into())
        );

        let stake_activating = Stake {
            delegation: Delegation {
                stake: 100,
                activation_epoch: clock.epoch,
                ..Delegation::default()
            },
            ..Stake::default()
        };
        let stake_state_activating =
            StakeStateV2::Stake(Meta::default(), stake_activating, StakeFlags::empty());
        let stake_account_activating = get_stake_account(stake_state_activating);
        assert_eq!(
            get_delegation_state(&stake_account_activating, clock.epoch, &stake_history),
            DelegationState::Activating
        );
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &stake_account_activating,
                clock.epoch,
                &stake_history
            ),
            Ok(stake_activating)
        );

        let stake_activated = Stake {
            delegation: Delegation {
                stake: 100,
                activation_epoch: clock.epoch - 1,
                ..Delegation::default()
            },
            ..Stake::default()
        };
        let stake_state_activated =
            StakeStateV2::Stake(Meta::default(), stake_activated, StakeFlags::empty());
        let stake_account_activated = get_stake_account(stake_state_activated);
        assert_eq!(
            get_delegation_state(&stake_account_activated, clock.epoch, &stake_history),
            DelegationState::Activated
        );
        assert_eq!(
            check_stake_exist_and_activating_or_activated(
                &stake_account_activated,
                clock.epoch,
                &stake_history
            ),
            Ok(stake_activated)
        );
    }

    #[derive(PartialEq, Debug)]
    enum DelegationState {
        Activating,
        Deactivating,
        Activated,
        Deactivated,
        Fresh,
    }

    fn get_delegation_state(
        stake_account: &StakeAccount,
        epoch: Epoch,
        stake_history: &StakeHistory,
    ) -> DelegationState {
        match stake_account.stake() {
            None => DelegationState::Fresh,
            Some(stake) => {
                let StakeHistoryEntry {
                    effective,
                    activating,
                    deactivating,
                } = stake.delegation.stake_activating_and_deactivating(
                    epoch,
                    Some(stake_history),
                    None,
                );

                println!(
                    "get_delegation_state: [effective:{}/activating:{}/deactivating:{}]",
                    effective, activating, deactivating
                );
                if activating > 0 {
                    DelegationState::Activating
                } else if deactivating > 0 {
                    DelegationState::Deactivating
                } else if effective > 0 {
                    DelegationState::Activated
                } else {
                    DelegationState::Deactivated
                }
            }
        }
    }

    pub fn get_stake_account(stake_state: StakeStateV2) -> StakeAccount {
        let stake_state_vec = stake_state.try_to_vec().unwrap();
        let mut stake_state_data = stake_state_vec.as_slice();
        StakeAccount::try_deserialize(&mut stake_state_data).unwrap()
    }

    pub fn get_delegated_stake_account(
        voter_pubkey: Option<Pubkey>,
        withdrawer: Option<Pubkey>,
        staker: Option<Pubkey>,
    ) -> StakeAccount {
        let delegation = Delegation {
            voter_pubkey: voter_pubkey.unwrap_or(Pubkey::new_unique()),
            ..Delegation::default()
        };
        let stake = Stake {
            delegation,
            ..Stake::default()
        };
        let meta = Meta {
            authorized: Authorized {
                withdrawer: withdrawer.unwrap_or(Pubkey::new_unique()),
                staker: staker.unwrap_or(Pubkey::new_unique()),
            },
            ..Meta::default()
        };
        get_stake_account(StakeStateV2::Stake(meta, stake, StakeFlags::empty()))
    }

    pub fn get_clock() -> Clock {
        Clock {
            slot: 1,
            epoch_start_timestamp: 2,
            epoch: 3,
            leader_schedule_epoch: 4,
            unix_timestamp: 5,
        }
    }

    pub fn get_vote_account_data() -> (VoteInit, Vec<u8>) {
        let clock = get_clock();
        let vote_init = VoteInit {
            node_pubkey: Pubkey::new_unique(),
            authorized_voter: Pubkey::new_unique(),
            authorized_withdrawer: Pubkey::new_unique(),
            commission: 0,
        };
        let vote_state = VoteState::new(&vote_init, &clock);
        let vote_state_versions = VoteStateVersions::Current(Box::new(vote_state));
        let serialized_data = bincode::serialize(&vote_state_versions).unwrap();
        (vote_init, serialized_data)
    }
}
