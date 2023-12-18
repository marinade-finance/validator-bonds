use crate::constants::BOND_SEED;
use crate::error::ErrorCode;
use crate::state::Reserved150;
use crate::utils::basis_points::HundredthBasisPoint;
use crate::ID;
use anchor_lang::prelude::*;

/// Bond account for a validator vote address
#[account]
#[derive(Debug, Default)]
pub struct Bond {
    /// Contract root config address. Validator bond is created for this config as PDA
    /// but saving the address here for easier access with getProgramAccounts call
    pub config: Pubkey,
    /// Validator vote address that this bond account is crated for
    /// INVARIANTS:
    ///  - one bond account per validator vote address
    ///  - bond program does not change received stake account delegation voter_pubkey to any other validator vote
    pub validator_vote_account: Pubkey,
    /// Authority that may close the bond or withdraw stake accounts associated with the bond
    /// The same powers has got the owner of the validator vote account
    // https://github.com/solana-labs/solana/blob/master/vote/src/vote_account.rs
    pub authority: Pubkey,
    /// Revenue that is distributed from the bond (from validator) to the protocol
    pub revenue_share: HundredthBasisPoint,
    /// PDA Bond address bump seed
    pub bump: u8,
    /// reserve space for future extensions
    pub reserved: Reserved150,
}

impl Bond {
    pub fn find_address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                BOND_SEED,
                &self.config.key().as_ref(),
                &self.validator_vote_account.as_ref(),
                &[self.bump],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidBondAddress.into())
    }
}
