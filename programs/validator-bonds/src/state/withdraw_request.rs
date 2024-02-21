use crate::constants::WITHDRAW_REQUEST_SEED;
use crate::error::ErrorCode;
use crate::ID;
use anchor_lang::prelude::*;

/// Request from a validator to withdraw their bond
#[account]
#[derive(Debug)]
pub struct WithdrawRequest {
    /// Validator vote account that requested the withdraw
    pub vote_account: Pubkey,
    /// Bond account that the withdraw request is for (has to match with vote_account)
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
    pub reserved: [u8; 93],
}

impl WithdrawRequest {
    pub fn address(&self) -> Result<Pubkey> {
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

pub fn find_withdraw_request_address(bond: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[WITHDRAW_REQUEST_SEED, bond.as_ref()], &ID)
}
