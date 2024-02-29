use crate::checks::is_closed;
use crate::error::ErrorCode;
use crate::events::settlement_claim::CloseSettlementClaimEvent;
use crate::state::settlement_claim::SettlementClaim;
use anchor_lang::prelude::*;

// Closing settlement claim to get back rent for the account
#[derive(Accounts)]
pub struct CloseSettlementClaim<'info> {
    /// CHECK: code to check non-existence of the account
    pub settlement: UncheckedAccount<'info>,

    #[account(
          mut,
          close = rent_collector,
          has_one = rent_collector @ ErrorCode::RentCollectorMismatch,
          has_one = settlement @ ErrorCode::SettlementAccountMismatch,
      )]
    pub settlement_claim: Account<'info, SettlementClaim>,

    /// CHECK: account rent except back to creator of the account, verified by settlement claim account
    #[account(mut)]
    pub rent_collector: UncheckedAccount<'info>,
}

impl<'info> CloseSettlementClaim<'info> {
    pub fn process(&mut self) -> Result<()> {
        // The rule stipulates that the settlement claim can only be closed when the settlement does exist.
        require!(is_closed(&self.settlement), ErrorCode::SettlementNotClosed);

        emit!(CloseSettlementClaimEvent {
            settlement: self.settlement.key(),
            rent_collector: self.rent_collector.key(),
        });

        Ok(())
    }
}
