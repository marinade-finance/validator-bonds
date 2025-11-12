use crate::error::ErrorCode;
use crate::instructions::v1::tree_node_v1::TreeNodeV1;
use crate::ID;
use anchor_lang::prelude::*;

#[constant]
pub const SETTLEMENT_CLAIM_SEED: &[u8] = b"claim_account";

// NOTE: we cannot rename the account to SettlementClaimV1
//       because the account name is used to determine the account discriminator

/// The settlement claim serves for deduplication purposes,
/// preventing the same settlement from being claimed multiple times with the same claiming data
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
    pub fn address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                SETTLEMENT_CLAIM_SEED,
                self.settlement.key().as_ref(),
                TreeNodeV1 {
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
