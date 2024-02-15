use crate::constants::BONDS_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::ID;
use anchor_lang::prelude::*;

/// Root account that configures the validator bonds program
#[account]
#[derive(Debug)]
pub struct Config {
    /// Admin authority that can update the config
    pub admin_authority: Pubkey,
    /// Operator authority (bot hot wallet)
    pub operator_authority: Pubkey,
    /// How many epochs permitting to claim the settlement
    pub epochs_to_claim_settlement: u64,
    /// How many epochs before withdraw is allowed
    pub withdraw_lockup_epochs: u64,
    /// Minimum amount of lamports to be considered for a stake account operations (e.g., split)
    pub minimum_stake_lamports: u64,
    /// PDA bonds bonds stake accounts authority bump seed
    pub bonds_withdrawer_authority_bump: u8,
    /// reserved space for future changes
    pub reserved: [u8; 512],
}

impl Config {
    pub fn bonds_withdrawer_authority_address(&self, config_address: &Pubkey) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                BONDS_AUTHORITY_SEED,
                config_address.as_ref(),
                &[self.bonds_withdrawer_authority_bump],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidBondsWithdrawerAuthorityAddress.into())
    }
}

pub fn find_bonds_withdrawer_authority(config_address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[BONDS_AUTHORITY_SEED, config_address.as_ref()], &ID)
}
