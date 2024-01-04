use crate::checks::check_bond_change_permitted;
use crate::error::ErrorCode;
use crate::events::withdraw::CancelWithdrawRequestEvent;
use crate::state::bond::Bond;
use crate::state::withdraw_request::WithdrawRequest;
use anchor_lang::prelude::*;

/// Cancelling validator bond withdraw request.
/// Only one withdraw request per bond. Cancelling makes a way for a new request with new amount.
#[derive(Accounts)]
pub struct CancelWithdrawRequest<'info> {
    #[account(
        mut,
        has_one = validator_vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            bond.config.key().as_ref(),
            validator_vote_account.key().as_ref()
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    /// CHECK: check&deserialize of the vote account in the code
    #[account()]
    validator_vote_account: UncheckedAccount<'info>,

    /// validator vote account validator identity or bond authority may ask for cancelling
    #[account()]
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
    withdraw_request: Account<'info, WithdrawRequest>,

    #[account(mut)]
    rent_collector: SystemAccount<'info>,
}

impl<'info> CancelWithdrawRequest<'info> {
    pub fn process(&mut self) -> Result<()> {
        require!(
            check_bond_change_permitted(
                &self.authority.key(),
                &self.bond,
                &self.validator_vote_account
            ),
            ErrorCode::InvalidWithdrawRequestAuthority
        );

        emit!(CancelWithdrawRequestEvent {
            withdraw_request: self.withdraw_request.key(),
            bond: self.bond.key(),
            authority: self.authority.key(),
            requested_amount: self.withdraw_request.requested_amount,
            withdrawn_amount: self.withdraw_request.withdrawn_amount,
        });
        Ok(())
    }
}
