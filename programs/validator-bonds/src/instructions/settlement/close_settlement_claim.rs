use crate::error::ErrorCode;
use crate::events::settlement_claim::CloseSettlementClaimEvent;
use crate::state::settlement_claim::SettlementClaim;
use anchor_lang::prelude::*;

// Closing settlement claim to get back rent for the account
#[derive(Accounts)]
pub struct CloseSettlementClaim<'info> {
    /// CHECK: checking existence of the account, address verified by settlement claim PDA address
    settlement: UncheckedAccount<'info>,

    #[account(
          mut,
          close = rent_collector,
          has_one = rent_collector @ ErrorCode::RentCollectorMismatch,
          has_one = settlement @ ErrorCode::SettlementAccountMismatch,
      )]
    settlement_claim: Account<'info, SettlementClaim>,

    /// CHECK: account rent except back to creator of the account, verified by settlement claim account
    #[account(mut)]
    rent_collector: UncheckedAccount<'info>,
}

impl<'info> CloseSettlementClaim<'info> {
    pub fn process(&mut self) -> Result<()> {
        // The rule is that the settlement claim can be closed only when settlement does not exist
        // TODO: is there a nicer (more anchor native) way to verify the non-existence of the account?
        require_eq!(
            self.settlement.lamports(),
            0,
            ErrorCode::SettlementNotClosed
        );

        emit!(CloseSettlementClaimEvent {
            settlement: self.settlement.key(),
            rent_collector: self.rent_collector.key(),
        });

        Ok(())
    }
}
