use crate::constants::{BOND_MINT_SEED, BOND_SEED};
use crate::error::ErrorCode;
use crate::ID;
use anchor_lang::prelude::*;

/// Bond account for a validator vote address
#[account]
#[derive(Debug)]
pub struct Bond {
    /// Program root config address. Validator bond is created for this config as PDA
    // saving the address here for easier access with getProgramAccounts call
    pub config: Pubkey,
    /// Validator vote address that this bond account is crated for
    /// INVARIANTS:
    ///  - one bond account per validator vote address
    ///  - this program does NOT change stake account delegation voter_pubkey to any other validator vote account
    pub vote_account: Pubkey,
    /// Authority that may close the bond or withdraw stake accounts associated with the bond
    /// The same powers has got the owner of the validator vote account
    // https://github.com/solana-labs/solana/blob/master/vote/src/vote_account.rs
    pub authority: Pubkey,
    /// Cost per mille per epoch
    pub cpmpe: u64,
    /// PDA Bond address bump seed
    pub bump: u8,
    /// reserve space for future extensions
    pub reserved: [u8; 142],
}

impl Bond {
    pub fn address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                BOND_SEED,
                &self.config.key().as_ref(),
                &self.vote_account.as_ref(),
                &[self.bump],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidBondAddress.into())
    }
}

pub fn find_bond_address(config: &Pubkey, vote_account: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[BOND_SEED, config.key().as_ref(), vote_account.as_ref()],
        &ID,
    )
}

pub fn find_bond_mint(bond_account: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[BOND_MINT_SEED, bond_account.as_ref()], &ID)
}

// TODO: cannot find in Anchor code to get this info elsewhere
#[cfg(not(target_os = "solana"))]
pub fn find_event_authority() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], &ID)
}
