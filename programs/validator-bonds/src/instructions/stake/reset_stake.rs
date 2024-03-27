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

/// Resetting the stake authority of a funded stake account belonging to a removed settlement.
/// I.e., for the provided stake account, it changes the stake authority from the settlement stake authority to the bonds withdrawer authority.
#[event_cpi]
#[derive(Accounts)]
pub struct ResetStake<'info> {
    /// the config account under which the bond was created
    pub config: Account<'info, Config>,

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
    pub bond: Account<'info, Bond>,

    /// CHECK: in code
    /// cannot exist; used to derive settlement authority
    pub settlement: UncheckedAccount<'info>,

    /// stake account belonging under the settlement by staker authority
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,

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
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: the validator vote account to which the stake account is delegated, check in code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,

    /// CHECK: CPI
    #[account(address = stake::config::ID)]
    pub stake_config: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,
}

impl<'info> ResetStake<'info> {
    pub fn process(ctx: Context<ResetStake>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        // The rule stipulates to reset only when the settlement does exist.
        require!(
            is_closed(&ctx.accounts.settlement),
            ErrorCode::SettlementNotClosed
        );

        // stake account is managed by bonds program and belongs under bond validator
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // a bond account is tightly coupled to a vote account, this stake account belongs to bond
        check_stake_valid_delegation(&ctx.accounts.stake_account, &ctx.accounts.bond.vote_account)?;
        // stake account is funded to removed settlement
        let settlement_staker_authority =
            find_settlement_staker_authority(&ctx.accounts.settlement.key()).0;
        require_eq!(
            stake_meta.authorized.staker,
            settlement_staker_authority,
            ErrorCode::SettlementAuthorityMismatch
        );

        // moving the stake account under the bonds authority (withdrawer and staker will be the same)
        // https://github.com/solana-labs/solana/blob/v1.17.10/sdk/program/src/stake/state.rs#L312
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Staker,
            None,
        )?;

        // activate the stake, i.e., resetting delegation to the validator again
        let delegate_instruction = &stake::instruction::delegate_stake(
            &ctx.accounts.stake_account.key(),
            &ctx.accounts.bonds_withdrawer_authority.key(),
            &ctx.accounts.bond.vote_account,
        );
        invoke_signed(
            delegate_instruction,
            &[
                ctx.accounts.stake_program.to_account_info(),
                ctx.accounts.stake_account.to_account_info(),
                ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                ctx.accounts.vote_account.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.stake_history.to_account_info(),
                ctx.accounts.stake_config.to_account_info(),
            ],
            &[&[
                BONDS_WITHDRAWER_AUTHORITY_SEED,
                &ctx.accounts.config.key().as_ref(),
                &[ctx.accounts.config.bonds_withdrawer_authority_bump],
            ]],
        )?;

        emit_cpi!(ResetStakeEvent {
            config: ctx.accounts.config.key(),
            bond: ctx.accounts.bond.key(),
            settlement: ctx.accounts.settlement.key(),
            stake_account: ctx.accounts.stake_account.key(),
            vote_account: ctx.accounts.vote_account.key(),
            settlement_staker_authority,
        });

        Ok(())
    }
}
