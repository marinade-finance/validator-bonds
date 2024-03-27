use crate::checks::check_bond_authority;
use crate::error::ErrorCode;
use crate::events::withdraw::CancelWithdrawRequestEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::withdraw_request::WithdrawRequest;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

/// Cancelling a validator bond withdrawal request.
/// Only one withdrawal request per bond is permitted.
/// Cancelling makes way for a new request with a new amount.
#[event_cpi]
#[derive(Accounts)]
pub struct CancelWithdrawRequest<'info> {
    pub config: Account<'info, Config>,

    #[account(
        has_one = vote_account @ ErrorCode::VoteAccountMismatch,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref()
        ],
        bump = bond.bump,
    )]
    pub bond: Account<'info, Bond>,

    /// CHECK: check&deserialize of the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    /// validator vote account validator identity or bond authority may ask for cancelling
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = rent_collector,
        has_one = bond @ ErrorCode::BondAccountMismatch,
        seeds = [
            b"withdraw_account",
            bond.key().as_ref(),
        ],
        bump = withdraw_request.bump
    )]
    pub withdraw_request: Account<'info, WithdrawRequest>,

    /// CHECK: caller may define SystemAccount or any other
    #[account(mut)]
    pub rent_collector: UncheckedAccount<'info>,
}

impl<'info> CancelWithdrawRequest<'info> {
    pub fn process(ctx: Context<CancelWithdrawRequest>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        require!(
            check_bond_authority(
                &ctx.accounts.authority.key(),
                &ctx.accounts.bond,
                &ctx.accounts.vote_account
            ),
            ErrorCode::InvalidWithdrawRequestAuthority
        );

        emit_cpi!(CancelWithdrawRequestEvent {
            withdraw_request: ctx.accounts.withdraw_request.key(),
            bond: ctx.accounts.bond.key(),
            authority: ctx.accounts.authority.key(),
            requested_amount: ctx.accounts.withdraw_request.requested_amount,
            withdrawn_amount: ctx.accounts.withdraw_request.withdrawn_amount,
        });
        Ok(())
    }
}
