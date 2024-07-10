use crate::checks::is_closed;
use crate::error::ErrorCode;
use crate::instructions::v1::settlement_claim_v1::SettlementClaim;
use anchor_lang::prelude::*;

// Closing settlement claim to get back rent for the account
#[event_cpi]
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
    pub fn process(ctx: Context<CloseSettlementClaim>) -> Result<()> {
        // NOTE: We intentionally do not check for the paused state here.
        //       This instruction only allows returning rent and has no crucial impact on the system.

        // The rule stipulates that the settlement claim can only be closed when the settlement does exist.
        require!(
            is_closed(&ctx.accounts.settlement),
            ErrorCode::SettlementNotClosed
        );

        Ok(())
    }
}
