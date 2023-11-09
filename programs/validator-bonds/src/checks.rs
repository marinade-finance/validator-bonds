use crate::error::ErrorCode;
use crate::state::bond::Bond;
use anchor_lang::prelude::*;
use anchor_lang::prelude::{msg, Pubkey};
use anchor_lang::require_keys_eq;
use anchor_lang::solana_program::stake::state::{Delegation, Meta, Stake};
use anchor_lang::solana_program::stake_history::{Epoch, StakeHistoryEntry};
use anchor_lang::solana_program::vote::program::id as vote_program_id;
use anchor_lang::solana_program::vote::state::VoteState;
use anchor_spl::stake::StakeAccount;
use std::ops::Deref;

/// Verification the account is a vote account + matching owner (withdrawer authority)
pub fn check_validator_vote_account_owner(
    validator_vote_account: &UncheckedAccount,
    expected_owner: &Pubkey,
) -> Result<VoteState> {
    require!(
        validator_vote_account.owner == &vote_program_id(),
        ErrorCode::InvalidVoteAccountProgramId
    );
    let validator_vote_data = &validator_vote_account.data.borrow()[..];
    let vote_account = VoteState::deserialize(validator_vote_data).map_err(|err| {
        msg!("Cannot deserialize vote account: {:?}", err);
        error!(ErrorCode::FailedToDeserializeVoteAccount)
            .with_values(("validator_vote_account", validator_vote_account.key()))
    })?;
    require_keys_eq!(
        *expected_owner,
        vote_account.authorized_withdrawer,
        ErrorCode::ValidatorVoteAccountOwnerMismatch
    );
    Ok(vote_account)
}

/// Bond account change is permitted to bond authority or validator vote account owner
pub fn check_bond_change_permitted(
    authority: &Pubkey,
    bond_account: &Bond,
    validator_vote_account: &UncheckedAccount,
) -> bool {
    if authority == &bond_account.authority.key() {
        true
    } else {
        check_validator_vote_account_owner(validator_vote_account, authority)
            .map_or(false, |_| true)
    }
}

/// Check if the stake account is delegated to the right validator
pub fn check_stake_valid_delegation(
    stake_account: &StakeAccount,
    validator_vote_account: &Pubkey,
) -> Result<Delegation> {
    if let Some(delegation) = stake_account.delegation() {
        require_keys_eq!(
            delegation.voter_pubkey,
            *validator_vote_account,
            ErrorCode::BondStakeWrongDelegation
        );
        Ok(delegation)
    } else {
        Err(error!(ErrorCode::StakeNotDelegated)
            .with_values((
                "stake_account_state",
                format!("{:?}", stake_account.deref()),
            ))
            .with_values(("validator_vote_account", validator_vote_account)))
    }
}

pub fn check_stake_is_initialized_with_authority(
    stake_account: &StakeAccount,
    authority: &Pubkey,
    stake_account_attribute_name: &str,
) -> Result<Meta> {
    let stake_meta = stake_account.meta().ok_or(
        error!(ErrorCode::UninitializedStake)
            .with_account_name(stake_account_attribute_name)
            .with_values((
                "stake_account_state",
                format!("{:?}", stake_account.deref()),
            )),
    )?;
    if stake_meta.authorized.withdrawer != *authority {
        return Err(error!(ErrorCode::InvalidStakeOwner)
            .with_account_name(stake_account_attribute_name)
            .with_values((
                "stake_account_state",
                format!("{:?}", stake_account.deref()),
            ))
            .with_values(("authority", authority))
            .with_values(("authorized_withdrawer", stake_meta.authorized.withdrawer)));
    }
    Ok(stake_meta)
}

pub fn check_stake_is_not_locked(
    stake_account: &StakeAccount,
    clock: &Clock,
    custodian: Option<&Pubkey>,
    stake_account_attribute_name: &str,
) -> Result<()> {
    if let Some(stake_lockup) = stake_account.lockup() {
        if stake_lockup.is_in_force(clock, custodian) {
            return Err(error!(ErrorCode::StakeLockedUp)
                .with_account_name(stake_account_attribute_name)
                .with_values((
                    "stake_account_state",
                    format!("{:?}", stake_account.deref()),
                )));
        }
    }
    Ok(())
}

/// Verification of the stake account state that's
///   - stake account is delegated
///   - stake account has got some delegated amount (effective is greater than 0)
///   - stake state is not changing
// implementation from https://github.com/marinade-finance/native-staking/blob/master/bot/src/utils/stakes.rs#L48
pub fn check_stake_exist_and_fully_activated(
    stake_account: &StakeAccount,
    epoch: Epoch,
    stake_history: &StakeHistory,
) -> Result<Stake> {
    if let Some(stake) = stake_account.stake() {
        let StakeHistoryEntry {
            effective,
            activating,
            deactivating,
        } = stake.delegation.stake_activating_and_deactivating(
            epoch,
            Some(stake_history),
            // TODO: what is for the new rate activation epoch?
            None,
        );
        if activating + deactivating > 0 || effective == 0 {
            return Err(error!(ErrorCode::NoStakeOrNotFullyActivated)
                .with_values((
                    "stake_account_state",
                    format!("{:?}", stake_account.deref()),
                ))
                .with_values(("effective", effective))
                .with_values(("activating", activating))
                .with_values(("deactivating", deactivating)));
        }
        Ok(stake)
    } else {
        Err(error!(ErrorCode::StakeNotDelegated).with_values((
            "stake_account_state",
            format!("{:?}", stake_account.deref()),
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::{AccountInfo, Clock, Pubkey, UncheckedAccount};
    use anchor_lang::solana_program::stake::state::{Authorized, Lockup, StakeState};
    use anchor_lang::solana_program::vote::state::{VoteInit, VoteState, VoteStateVersions};
    use std::ops::DerefMut;

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
            check_validator_vote_account_owner(&wrong_owner_account, &vote_init.authorized_voter,),
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

        check_validator_vote_account_owner(&unchecked_account, &vote_init.authorized_withdrawer)
            .unwrap();
        assert_eq!(
            check_validator_vote_account_owner(&unchecked_account, &vote_init.authorized_voter,),
            Err(ErrorCode::ValidatorVoteAccountOwnerMismatch.into())
        );
        assert_eq!(
            check_validator_vote_account_owner(&unchecked_account, &Pubkey::default(),),
            Err(ErrorCode::ValidatorVoteAccountOwnerMismatch.into())
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
        assert!(check_bond_change_permitted(
            &bond_authority,
            &Bond {
                authority: bond_authority,
                ..Bond::default()
            },
            &unchecked_account,
        ));
        assert!(check_bond_change_permitted(
            &vote_init.authorized_withdrawer,
            &Bond {
                authority: Pubkey::new_unique(),
                ..Bond::default()
            },
            &unchecked_account,
        ));
        assert!(!check_bond_change_permitted(
            &Pubkey::new_unique(),
            &Bond {
                authority: Pubkey::new_unique(),
                ..Bond::default()
            },
            &unchecked_account,
        ));
    }

    #[test]
    pub fn stake_valid_delegation_check() {
        let uninitialized_stake_account = get_stake_account(StakeState::Uninitialized);
        assert_eq!(
            check_stake_valid_delegation(&uninitialized_stake_account, &Pubkey::default()),
            Err(ErrorCode::StakeNotDelegated.into())
        );

        let initialized_stake_account = get_stake_account(StakeState::Initialized(Meta::default()));
        assert_eq!(
            check_stake_valid_delegation(&initialized_stake_account, &Pubkey::default()),
            Err(ErrorCode::StakeNotDelegated.into())
        );

        let rewards_pool_stake_account = get_stake_account(StakeState::RewardsPool);
        assert_eq!(
            check_stake_valid_delegation(&rewards_pool_stake_account, &Pubkey::default()),
            Err(ErrorCode::StakeNotDelegated.into())
        );

        let default_delegated_stake_account =
            get_stake_account(StakeState::Stake(Meta::default(), Stake::default()));
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
        let uninitialized_stake_account = get_stake_account(StakeState::Uninitialized);
        assert_eq!(
            check_stake_is_initialized_with_authority(
                &uninitialized_stake_account,
                &Pubkey::default(),
                ""
            ),
            Err(ErrorCode::UninitializedStake.into())
        );
        let rewards_pool_stake_account = get_stake_account(StakeState::RewardsPool);
        assert_eq!(
            check_stake_is_initialized_with_authority(
                &rewards_pool_stake_account,
                &Pubkey::default(),
                ""
            ),
            Err(ErrorCode::UninitializedStake.into())
        );

        let initialized_stake_account = get_stake_account(StakeState::Initialized(Meta::default()));
        assert_eq!(
            check_stake_is_initialized_with_authority(
                &initialized_stake_account,
                &Pubkey::default(),
                ""
            ),
            Ok(Meta::default())
        );
        let default_delegated_stake_account =
            get_stake_account(StakeState::Stake(Meta::default(), Stake::default()));
        assert_eq!(
            check_stake_is_initialized_with_authority(
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
            check_stake_is_initialized_with_authority(&delegated_stake_account, &withdrawer, ""),
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
            check_stake_is_initialized_with_authority(
                &delegated_stake_account,
                &wrong_withdrawer,
                ""
            ),
            Err(ErrorCode::InvalidStakeOwner.into())
        );
    }

    #[test]
    pub fn stake_is_not_locked_check() {
        let clock = get_clock();

        // no lock on default stake account
        let unlocked_stake_account = get_stake_account(StakeState::Uninitialized);
        assert_eq!(
            check_stake_is_not_locked(&unlocked_stake_account, &clock, None, ""),
            Ok(())
        );
        let rewards_pool_stake_account = get_stake_account(StakeState::RewardsPool);
        assert_eq!(
            check_stake_is_not_locked(&rewards_pool_stake_account, &clock, None, ""),
            Ok(())
        );

        let initialized_stake_account = get_stake_account(StakeState::Initialized(Meta::default()));
        assert_eq!(
            check_stake_is_not_locked(&initialized_stake_account, &clock, None, ""),
            Ok(())
        );
        let default_delegated_stake_account =
            get_stake_account(StakeState::Stake(Meta::default(), Stake::default()));
        assert_eq!(
            check_stake_is_not_locked(&default_delegated_stake_account, &clock, None, ""),
            Ok(())
        );

        let custodian = Pubkey::new_unique();
        let epoch_lockup = Lockup {
            epoch: clock.epoch + 1, // lock-up to the next epoch
            unix_timestamp: 0,
            custodian,
        };
        let epoch_locked_stake_account = get_stake_account(StakeState::Stake(
            Meta {
                lockup: epoch_lockup,
                ..Meta::default()
            },
            Stake::default(),
        ));

        assert!(clock.epoch > 0 && clock.unix_timestamp > 0);

        // locked, wrong custodian
        let wrong_custodian = Pubkey::new_unique();
        assert_eq!(
            check_stake_is_not_locked(&epoch_locked_stake_account, &clock, None, ""),
            Err(ErrorCode::StakeLockedUp.into())
        );
        assert_eq!(
            check_stake_is_not_locked(
                &epoch_locked_stake_account,
                &clock,
                Some(&wrong_custodian),
                ""
            ),
            Err(ErrorCode::StakeLockedUp.into())
        );
        // locked, correct custodian
        assert_eq!(
            check_stake_is_not_locked(&epoch_locked_stake_account, &clock, Some(&custodian), ""),
            Ok(())
        );

        let unix_timestamp_lockup = Lockup {
            epoch: 0,
            unix_timestamp: clock.unix_timestamp + 1, // lock-up to the future timestamp
            custodian,
        };
        let unix_locked_stake_account = get_stake_account(StakeState::Stake(
            Meta {
                lockup: unix_timestamp_lockup,
                ..Meta::default()
            },
            Stake::default(),
        ));
        assert_eq!(
            check_stake_is_not_locked(&unix_locked_stake_account, &clock, None, ""),
            Err(ErrorCode::StakeLockedUp.into())
        );
    }

    #[test]
    pub fn stake_is_activated_check() {
        let clock = get_clock();
        let stake_history = StakeHistory::default();

        // no stake delegation
        let no_stake_stake_account = get_stake_account(StakeState::Uninitialized);
        assert_eq!(
            check_stake_exist_and_fully_activated(
                &no_stake_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::StakeNotDelegated.into())
        );
        let rewards_pool_stake_account = get_stake_account(StakeState::RewardsPool);
        assert_eq!(
            check_stake_exist_and_fully_activated(
                &rewards_pool_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::StakeNotDelegated.into())
        );
        let initialized_stake_account = get_stake_account(StakeState::Initialized(Meta::default()));
        assert_eq!(
            check_stake_exist_and_fully_activated(
                &initialized_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::StakeNotDelegated.into())
        );
        // delegated but no stake
        let delegated_stake_account =
            get_stake_account(StakeState::Stake(Meta::default(), Stake::default()));
        assert_eq!(
            check_stake_exist_and_fully_activated(
                &delegated_stake_account,
                clock.epoch,
                &stake_history
            ),
            Err(ErrorCode::NoStakeOrNotFullyActivated.into())
        );

        // requirements for the mocked clock instance
        assert!(clock.epoch > 0);

        // stake, but not activated
        let stake = Stake {
            delegation: Delegation {
                stake: 100,
                activation_epoch: clock.epoch,
                ..Delegation::default()
            },
            ..Stake::default()
        };
        let stake_account = get_stake_account(StakeState::Stake(Meta::default(), stake));
        assert_eq!(
            check_stake_exist_and_fully_activated(&stake_account, clock.epoch, &stake_history),
            Err(ErrorCode::NoStakeOrNotFullyActivated.into())
        );
        // stake, but deactivated
        let stake = Stake {
            delegation: Delegation {
                stake: 100,
                activation_epoch: clock.epoch - 1,
                deactivation_epoch: clock.epoch,
                ..Delegation::default()
            },
            ..Stake::default()
        };
        let stake_account = get_stake_account(StakeState::Stake(Meta::default(), stake));
        assert_eq!(
            check_stake_exist_and_fully_activated(&stake_account, clock.epoch, &stake_history),
            Err(ErrorCode::NoStakeOrNotFullyActivated.into())
        );

        let stake = Stake {
            delegation: Delegation {
                stake: 100,
                activation_epoch: clock.epoch - 1,
                deactivation_epoch: u64::MAX,
                ..Delegation::default()
            },
            ..Stake::default()
        };
        let stake_account = get_stake_account(StakeState::Stake(Meta::default(), stake));
        assert_eq!(
            check_stake_exist_and_fully_activated(&stake_account, clock.epoch, &stake_history),
            Ok(stake)
        );
    }

    pub fn get_stake_account(stake_state: StakeState) -> StakeAccount {
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
        get_stake_account(StakeState::Stake(meta, stake))
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
