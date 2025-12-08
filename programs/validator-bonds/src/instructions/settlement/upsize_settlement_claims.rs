use crate::state::settlement_claims::{account_increase_size, SettlementClaims};
use anchor_lang::prelude::*;

/// Increases SettlementClaims account size up to the maximum number of merkle nodes.
#[derive(Accounts)]
pub struct UpsizeSettlementClaims<'info> {
    #[account(
        mut,
        realloc = account_increase_size(&settlement_claims)?,
        realloc::zero = true,
        realloc::payer=rent_payer,
        seeds = [
            b"claims_account",
            settlement_claims.settlement.key().as_ref(),
        ],
        bump,
    )]
    pub settlement_claims: Account<'info, SettlementClaims>,

    /// rent exempt payer of account reallocation
    #[account(
        mut,
        owner = system_program.key(),
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl UpsizeSettlementClaims<'_> {
    pub fn process(ctx: Context<UpsizeSettlementClaims>) -> Result<()> {
        // NOTE: intentionally not considering pause state here,
        //       as the account size increase is a benign operation

        msg!(
            "Increase SettlementClaims account size, current size: {}",
            ctx.accounts
                .settlement_claims
                .to_account_info()
                .data
                .borrow()
                .len()
        );

        Ok(())
    }
}
