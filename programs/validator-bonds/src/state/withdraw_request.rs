use crate::constants::WITHDRAW_REQUEST_SEED;
use crate::error::ErrorCode;
use crate::state::Reserved150;
use crate::ID;
use anchor_lang::prelude::*;

/// Request from a validator to withdraw their bond
#[account]
#[derive(Debug, Default)]
pub struct WithdrawRequest {
    /// Validator that requested the withdraw
    pub validator_vote_account: Pubkey,
    /// Bond account that the withdraw request is for
    pub bond: Pubkey,
    /// Epoch when the withdraw was requested, i.e., when this "ticket" is created
    pub epoch: u64,
    /// Amount of lamports to withdraw
    pub requested_amount: u64,
    /// Amount of lamports withdrawn so far
    pub withdrawn_amount: u64,
    /// PDA account bump
    pub bump: u8,
    /// reserve space for future extensions
    pub reserved: Reserved150,
}

impl WithdrawRequest {
    pub fn find_address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                WITHDRAW_REQUEST_SEED,
                &self.bond.key().as_ref(),
                &[self.bump],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidWithdrawRequestAddress.into())
    }
}
