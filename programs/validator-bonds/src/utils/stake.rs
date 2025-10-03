use crate::checks::get_delegation;
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::stake;
use anchor_lang::solana_program::stake::state::Meta;
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};
use std::cmp::{max, min};

/// This method serves to close/remove the stake account that has been just created
/// and it's not initialized.
/// This returns back the rent reserve of unused stake account
/// when the split stake account is not used for withdrawing, funding settlement...
pub fn return_unused_split_stake_account_rent<'info>(
    stake_program: &Program<'info, Stake>,
    split_stake_account: &Account<'info, StakeAccount>,
    rent_collector: &AccountInfo<'info>,
    clock: &Sysvar<'info, Clock>,
    stake_history: &AccountInfo<'info>,
) -> Result<()> {
    withdraw(
        CpiContext::new(
            stake_program.to_account_info(),
            Withdraw {
                stake: split_stake_account.to_account_info(),
                // the withdrawer authority (owner) of an uninitialized stake account is the stake account itself
                withdrawer: split_stake_account.to_account_info(),
                to: rent_collector.to_account_info(),
                clock: clock.to_account_info(),
                stake_history: stake_history.to_account_info(),
            },
        ),
        split_stake_account.get_lamports(),
        None,
    )
}

pub fn minimal_size_stake_account(stake_meta: &Meta, config: &Config) -> u64 {
    stake_meta.rent_exempt_reserve + config.minimum_stake_lamports
}

#[allow(clippy::too_many_arguments)]
pub fn split_stake<'info>(
    stake_account: &Account<'info, StakeAccount>,
    // amount that is about to be left within stake account (defined by business logic)
    // while the rest is moved into split stake account (has to be made in state of "delegated")
    amount_wanted: u64,
    split_stake_account: &Account<'info, StakeAccount>,
    vote_account: &UncheckedAccount<'info>,
    config: &Account<'info, Config>,
    bonds_withdrawer_authority: &UncheckedAccount<'info>,
    stake_program: &Program<'info, Stake>,
    stake_history: &Sysvar<'info, StakeHistory>,
    stake_config: &UncheckedAccount<'info>,
    clock: &Sysvar<'info, Clock>,
    rent: &Sysvar<'info, Rent>,
) -> Result<()> {
    // this case should be handled by the caller
    require_gt!(
        stake_account.get_lamports(),
        amount_wanted,
        ErrorCode::StakeAccountNotBigEnoughToWithdrawOrSplit
    );
    let delegated_lamports = get_delegation(stake_account)?
        .ok_or(ErrorCode::StakeNotDelegated)?
        .stake;
    let stake_meta = stake_account.meta().ok_or(ErrorCode::UninitializedStake)?;

    // For the 'stake_account' to stay in the "delegated" state, a minimum stake must remain delegated.
    // A portion of the undelegated lamports may need to be withdrawn to the split account before splitting.
    // See: https://github.com/anza-xyz/agave/blob/v2.0.9/programs/stake/src/stake_state.rs#L504
    let non_delegated_lamports = stake_account
        .get_lamports()
        .saturating_sub(delegated_lamports);
    // considering the config `minimum_stake_lamports` will be setup based on the on-chain state
    let minimum_delegation = config.minimum_stake_lamports;
    let stake_rent_exempt = stake_meta.rent_exempt_reserve;

    // the "non delegated part" left and used by business logic within stake account
    // has to be at least of value rent_exempt
    // then the "delegated part" has to be at least of value minimum_delegation (working with a delegated stake)
    // the calculation requires to consider that when considering what is the whole "wanted amount"
    let amount_non_delegated = max(
        stake_rent_exempt,
        min(
            amount_wanted.saturating_sub(minimum_delegation),
            non_delegated_lamports,
        ),
    );
    let amount_delegated = amount_wanted - amount_non_delegated;
    assert!(amount_non_delegated >= stake_rent_exempt);
    assert!(amount_delegated >= minimum_delegation);

    let split_amount_by_withdrawing = non_delegated_lamports - amount_non_delegated;
    let split_amount_by_splitting = delegated_lamports - amount_delegated;
    assert_eq!(
        amount_delegated
            + amount_non_delegated
            + split_amount_by_splitting
            + split_amount_by_withdrawing,
        stake_account.get_lamports()
    );
    assert_eq!(amount_delegated + amount_non_delegated, amount_wanted,);

    //  required to withdraw to avoid `InsufficientDelegation` error
    // see https://github.com/anza-xyz/agave/blob/v2.0.9/programs/stake/src/stake_state.rs#L527C24-L527C71
    if split_amount_by_withdrawing > 0 {
        withdraw(
            CpiContext::new_with_signer(
                stake_program.to_account_info(),
                Withdraw {
                    stake: stake_account.to_account_info(),
                    withdrawer: bonds_withdrawer_authority.to_account_info(),
                    to: split_stake_account.to_account_info(),
                    stake_history: stake_history.to_account_info(),
                    clock: clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &config.key().as_ref(),
                    &[config.bonds_withdrawer_authority_bump],
                ]],
            ),
            split_amount_by_withdrawing,
            None,
        )?;
    }

    if split_amount_by_splitting > 0 {
        // Sufficient delegated lamports are available for splitting.
        msg!(
            "Splitting lamports {} to stake account {}",
            split_stake_account.key(),
            split_amount_by_splitting
        );
        let split_instruction = stake::instruction::split(
            stake_account.to_account_info().key,
            bonds_withdrawer_authority.key,
            split_amount_by_splitting,
            &split_stake_account.key(),
        )
        .last()
        .unwrap()
        .clone();
        invoke_signed(
            &split_instruction,
            &[
                stake_program.to_account_info(),
                stake_account.to_account_info(),
                split_stake_account.to_account_info(),
                bonds_withdrawer_authority.to_account_info(),
            ],
            &[&[
                BONDS_WITHDRAWER_AUTHORITY_SEED,
                &config.key().as_ref(),
                &[config.bonds_withdrawer_authority_bump],
            ]],
        )?;
    } else {
        // Insufficient delegated lamports for splitting.
        //   Splitting would ensure the resulted stake account preserves delegation.
        //   As splitting cannot be process we need manually initialize and delegate instead.
        msg!(
            "Delegating stake account {} to vote account {} with lamports {}",
            split_stake_account.key(),
            vote_account.key(),
            split_stake_account.get_lamports()
        );
        let initialize_instruction = stake::instruction::initialize(
            split_stake_account.to_account_info().key,
            &stake::state::Authorized {
                staker: bonds_withdrawer_authority.key(),
                withdrawer: bonds_withdrawer_authority.key(),
            },
            &stake::state::Lockup::default(),
        );
        invoke(
            &initialize_instruction,
            &[
                stake_program.to_account_info(),
                split_stake_account.to_account_info(),
                rent.to_account_info(),
            ],
        )?;
        let delegate_instruction = &stake::instruction::delegate_stake(
            &split_stake_account.key(),
            &bonds_withdrawer_authority.key(),
            &vote_account.key(),
        );
        invoke_signed(
            delegate_instruction,
            &[
                stake_program.to_account_info(),
                split_stake_account.to_account_info(),
                bonds_withdrawer_authority.to_account_info(),
                vote_account.to_account_info(),
                clock.to_account_info(),
                stake_history.to_account_info(),
                stake_config.to_account_info(),
            ],
            &[&[
                BONDS_WITHDRAWER_AUTHORITY_SEED,
                &config.key().as_ref(),
                &[config.bonds_withdrawer_authority_bump],
            ]],
        )?;
    }
    Ok(())
}
