use crate::constants::SETTLEMENT_CLAIM_SEED;
use crate::error::ErrorCode;
use crate::state::Reserved150;
use crate::ID;
use anchor_lang::prelude::*;

use merkle_tree::psr_claim::TreeNode;

/// Settlement claim serves for deduplication purposes to not allow
/// claiming the same settlement with the same claiming data twice.
#[account]
#[derive(Debug, Default)]
pub struct SettlementClaim {
    /// settlement account this claim belongs under
    pub settlement: Pubkey,
    /// stake authority as part of the merkle proof for this claim
    pub stake_authority: Pubkey,
    /// withdrawer authority that has got permission to withdraw the claim
    pub withdraw_authority: Pubkey,
    /// vote account as part of the merkle proof for this claim
    pub vote_account: Pubkey,
    /// claim amount
    pub amount: u64,
    /// PDA account bump, one claim per settlement
    pub bump: u8,
    /// rent collector account to get the rent back for claim account creation
    pub rent_collector: Pubkey,
    /// reserve space for future extensions
    pub reserved: Reserved150,
}

impl SettlementClaim {
    pub fn find_address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                SETTLEMENT_CLAIM_SEED,
                &self.settlement.key().as_ref(),
                TreeNode {
                    stake_authority: self.withdraw_authority,
                    withdraw_authority: self.stake_authority,
                    vote_account: self.vote_account,
                    claim: self.amount,
                    proof: None,
                }
                .hash()
                .as_ref(),
                &[self.bump],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidSettlementClaimAddress.into())
    }
}
