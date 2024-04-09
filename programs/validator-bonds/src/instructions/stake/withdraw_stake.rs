#![allow(deprecated)]
// allowing deprecation as anchor 0.29.0 works with old version of StakeState struct

use crate::checks::{check_stake_is_initialized_with_withdrawer_authority, is_closed};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::stake::WithdrawStakeEvent;
use crate::state::config::Config;
use crate::state::settlement::find_settlement_staker_authority;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{stake::state::StakeState, sysvar::stake_history};
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};
use std::ops::Deref;

/// Withdrawing funded stake account belonging to removed settlement that has not been delegated (it's in Initialized state).
/// Such a stake account is considered belonging to the operator of the config account.
#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    /// the config account under which the bond was created
    #[account(
        has_one = operator_authority @ ErrorCode::InvalidOperatorAuthority,
    )]
    pub config: Account<'info, Config>,

    /// operator authority is allowed to reset the non-delegated stake accounts
    pub operator_authority: Signer<'info>,

    /// CHECK: in code
    /// cannot exist; used to derive settlement authority
    pub settlement: UncheckedAccount<'info>,

    /// stake account where staker authority is derived from settlement
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,

    /// CHECK: PDA
    /// bonds authority to withdraw the stake account
    #[account(
      seeds = [
          b"bonds_authority",
          config.key().as_ref(),
      ],
      bump = config.bonds_withdrawer_authority_bump
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: caller may define SystemAccount or any other
    #[account(mut)]
    pub withdraw_to: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,
}

impl<'info> WithdrawStake<'info> {
    pub fn process(ctx: Context<WithdrawStake>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        // The rule stipulates to withdraw only when the settlement does exist.
        require!(
            is_closed(&ctx.accounts.settlement),
            ErrorCode::SettlementNotClosed
        );

        // stake account is managed by bonds program and belongs under bond validator
        check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        let stake_state: &StakeState = ctx.accounts.stake_account.deref();
        // operator is permitted to work only with Initialized non-delegated stake accounts
        let stake_meta = match stake_state {
            StakeState::Initialized(meta) => meta,
            _ => {
                return Err(
                    error!(ErrorCode::WrongStakeAccountState).with_account_name("stake_account")
                )
            }
        };
        // stake account belongs under the bond config account
        require_eq!(
            stake_meta.authorized.withdrawer,
            ctx.accounts.bonds_withdrawer_authority.key(),
            ErrorCode::WrongStakeAccountWithdrawer
        );

        // check the stake account is funded to removed settlement
        let settlement_staker_authority =
            find_settlement_staker_authority(&ctx.accounts.settlement.key()).0;
        require_eq!(
            stake_meta.authorized.staker,
            settlement_staker_authority,
            ErrorCode::SettlementAuthorityMismatch
        );

        let withdrawn_amount = ctx.accounts.stake_account.get_lamports();
        withdraw(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Withdraw {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    withdrawer: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    to: ctx.accounts.withdraw_to.to_account_info(),
                    stake_history: ctx.accounts.stake_history.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            withdrawn_amount,
            None,
        )?;

        emit_cpi!(WithdrawStakeEvent {
            config: ctx.accounts.config.key(),
            operator_authority: ctx.accounts.operator_authority.key(),
            settlement: ctx.accounts.settlement.key(),
            stake_account: ctx.accounts.stake_account.key(),
            withdraw_to: ctx.accounts.withdraw_to.key(),
            settlement_staker_authority,
            withdrawn_amount,
        });

        Ok(())
    }
}
