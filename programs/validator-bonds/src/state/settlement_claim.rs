use crate::constants::SETTLEMENT_CLAIM_SEED;
use crate::error::ErrorCode;
use crate::ID;
use anchor_lang::prelude::*;
use merkle_tree::psr_claim::TreeNode;

/// Settlement claim serves for deduplication purposes to not allow
/// claiming the same settlement with the same claiming data twice.
#[account]
#[derive(Debug)]
pub struct SettlementClaim {
    /// settlement account this claim belongs under
    pub settlement: Pubkey,
    /// stake account to which the claim has been withdrawn to
    pub stake_account_to: Pubkey,
    /// staker authority as part of the merkle proof for this claim
    pub stake_account_staker: Pubkey,
    /// withdrawer authority as part of the merkle proof for this claim
    pub stake_account_withdrawer: Pubkey,
    /// claim amount
    pub amount: u64,
    /// PDA account bump, one claim per settlement
    pub bump: u8,
    /// rent collector account to get the rent back for claim account creation
    pub rent_collector: Pubkey,
    /// reserve space for future extensions
    pub reserved: [u8; 93],
}

impl SettlementClaim {
    pub fn find_address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                SETTLEMENT_CLAIM_SEED,
                &self.settlement.key().as_ref(),
                TreeNode {
                    stake_authority: self.stake_account_staker,
                    withdraw_authority: self.stake_account_withdrawer,
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

pub fn find_settlement_claim_address(settlement: &Pubkey, tree_node_bytes: &[u8]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SETTLEMENT_CLAIM_SEED, settlement.as_ref(), tree_node_bytes],
        &ID,
    )
}
