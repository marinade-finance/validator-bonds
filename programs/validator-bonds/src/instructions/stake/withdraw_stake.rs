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
    pub fn process(&mut self) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        // The rule stipulates to withdraw only when the settlement does exist.
        require!(is_closed(&self.settlement), ErrorCode::SettlementNotClosed);

        // stake account is managed by bonds program and belongs under bond validator
        check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        let stake_state: &StakeState = self.stake_account.deref();
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
            self.bonds_withdrawer_authority.key(),
            ErrorCode::WrongStakeAccountWithdrawer
        );

        // check the stake account is funded to removed settlement
        let settlement_staker_authority =
            find_settlement_staker_authority(&self.settlement.key()).0;
        require_eq!(
            stake_meta.authorized.staker,
            settlement_staker_authority,
            ErrorCode::SettlementAuthorityMismatch
        );

        let withdrawn_amount = self.stake_account.get_lamports();
        withdraw(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Withdraw {
                    stake: self.stake_account.to_account_info(),
                    withdrawer: self.bonds_withdrawer_authority.to_account_info(),
                    to: self.withdraw_to.to_account_info(),
                    stake_history: self.stake_history.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            withdrawn_amount,
            None,
        )?;

        emit!(WithdrawStakeEvent {
            config: self.config.key(),
            operator_authority: self.operator_authority.key(),
            settlement: self.settlement.key(),
            stake_account: self.stake_account.key(),
            withdraw_to: self.withdraw_to.key(),
            settlement_staker_authority,
            withdrawn_amount,
        });

        Ok(())
    }
}
