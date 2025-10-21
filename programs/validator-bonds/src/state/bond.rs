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
    /// Cost per mille per epoch.
    /// This field represents the bid the bond (vote) account owner is willing to pay
    /// for up to the `max_stake_wanted` being delegated.
    /// The bid is in cost per mille per epoch similar to Google ads cpm system.
    /// ---
    /// The actual amount of lamports deducted from the bond account for the processed bid
    /// is based on the actual delegated lamports during the epoch.
    pub cpmpe: u64,
    /// PDA Bond address bump seed
    pub bump: u8,
    /// Maximum stake (in lamports) that the bond (vote) account owner requests.
    /// This is the maximum stake that will be distributed to the vote account
    /// when all other constraints are fulfilled (managed off-chain).
    /// The vote account owner then goes to auction to obtain up to that maximum.
    /// Use the `cpmpe` field to define the bid for this purpose.
    pub max_stake_wanted: u64,
    /// reserve space for future extensions
    pub reserved: [u8; 134],
}

impl Bond {
    pub fn address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                BOND_SEED,
                self.config.key().as_ref(),
                self.vote_account.as_ref(),
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

pub fn find_bond_mint(bond_account: &Pubkey, validator_identity: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            BOND_MINT_SEED,
            bond_account.as_ref(),
            validator_identity.as_ref(),
        ],
        &ID,
    )
}
