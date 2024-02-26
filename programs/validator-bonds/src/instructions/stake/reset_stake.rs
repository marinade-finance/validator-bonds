use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_valid_delegation, is_closed,
};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::stake::ResetStakeEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::find_settlement_staker_authority;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_lang::solana_program::{stake, stake::state::StakeAuthorize, sysvar::stake_history};
use anchor_spl::stake::{authorize, Authorize, Stake, StakeAccount};

/// Resetting stake authority of a funded stake account belonging to removed settlement.
/// I.e., for provided stake account it changes the stake authority from settlement stake authority to bonds withdrawer authority.
#[derive(Accounts)]
pub struct ResetStake<'info> {
    /// the config root account under which the bond was created
    #[account()]
    config: Account<'info, Config>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        has_one = vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref()
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    /// CHECK: cannot exist
    /// settlement account used to derive settlement authority which cannot exists
    settlement: UncheckedAccount<'info>,

    /// stake account belonging under the settlement by staker authority
    #[account(mut)]
    stake_account: Account<'info, StakeAccount>,

    /// CHECK: PDA
    /// bonds withdrawer authority
    /// to cancel settlement funding of the stake account changing staker authority to address
    #[account(
      seeds = [
          b"bonds_authority",
          config.key().as_ref(),
      ],
      bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: the validator vote account to which the stake account is delegated, check in code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    vote_account: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,

    /// CHECK: CPI
    #[account(address = stake::config::ID)]
    stake_config: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,

    stake_program: Program<'info, Stake>,
}

impl<'info> ResetStake<'info> {
    pub fn process(&mut self) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        // settlement account cannot exists
        require!(is_closed(&self.settlement), ErrorCode::SettlementNotClosed);

        // stake account is managed by bonds program and belongs under bond validator
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // a bond account is tightly coupled to a vote account, this stake account belongs to bond
        check_stake_valid_delegation(&self.stake_account, &self.bond.vote_account)?;
        // stake account is funded to removed settlement
        let settlement_staker_authority =
            find_settlement_staker_authority(&self.settlement.key()).0;
        require_eq!(
            stake_meta.authorized.staker,
            settlement_staker_authority,
            ErrorCode::SettlementAuthorityMismatch
        );

        // moving the stake account under the bonds authority (withdrawer and staker will be the same)
        // https://github.com/solana-labs/solana/blob/v1.17.10/sdk/program/src/stake/state.rs#L312
        authorize(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: self.bonds_withdrawer_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Staker,
            None,
        )?;

        // activate the stake, i.e., resetting delegation to the validator again
        let delegate_instruction = &stake::instruction::delegate_stake(
            &self.stake_account.key(),
            &self.bonds_withdrawer_authority.key(),
            &self.bond.vote_account,
        );
        invoke_signed(
            delegate_instruction,
            &[
                self.stake_program.to_account_info(),
                self.stake_account.to_account_info(),
                self.bonds_withdrawer_authority.to_account_info(),
                self.vote_account.to_account_info(),
                self.clock.to_account_info(),
                self.stake_history.to_account_info(),
                self.stake_config.to_account_info(),
            ],
            &[&[
                BONDS_WITHDRAWER_AUTHORITY_SEED,
                &self.config.key().as_ref(),
                &[self.config.bonds_withdrawer_authority_bump],
            ]],
        )?;

        emit!(ResetStakeEvent {
            config: self.config.key(),
            bond: self.bond.key(),
            settlement: self.settlement.key(),
            stake_account: self.stake_account.key(),
            vote_account: self.vote_account.key(),
            settlement_staker_authority,
        });

        Ok(())
    }
}
