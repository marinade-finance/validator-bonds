use crate::constants::SETTLEMENT_CLAIM_SEED;
use crate::error::ErrorCode;
use crate::state::Reserved150;
use crate::ID;
use anchor_lang::prelude::*;

/// Settlement claim serves for deduplication purposes to not allow
/// claiming the same settlement with the same claiming data twice.
#[account]
#[derive(Debug, Default)]
pub struct SettlementClaim {
    /// settlement account this claim belongs under
    pub settlement: Pubkey,
    /// staker authority as part of the merkle proof for this claim
    pub staker_authority: Pubkey,
    /// withdrawer authority that has got permission to withdraw the claim
    pub withdrawer_authority: Pubkey,
    /// vote account as part of the merkle proof for this claim
    pub vote_account: Pubkey,
    /// claim amount
    pub claim: u64,
    /// PDA account bump, one claim per settlement
    pub bump: u8,
    /// rent collector account to get the rent back for claim account creation
    pub rent_collector: Pubkey,
    /// reserve space for future extensions
    pub reserved: Reserved150,
}

impl SettlementClaim {
    pub fn find_address(&self) -> Result<Pubkey> {
        // TODO: I'm not sure about the maximal seed length for the program address
        Pubkey::create_program_address(
            &[
                SETTLEMENT_CLAIM_SEED,
                &self.settlement.key().as_ref(),
                &self.staker_authority.as_ref(),
                &self.withdrawer_authority.as_ref(),
                &self.vote_account.as_ref(),
                &self.claim.to_le_bytes().as_ref(),
                &[self.bump],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidSettlementClaimAddress.into())
    }
}
