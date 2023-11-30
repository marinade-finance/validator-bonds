use crate::constants::{SETTLEMENT_AUTHORITY_SEED, SETTLEMENT_SEED};
use crate::error::ErrorCode;
use crate::state::Reserved150;
use crate::ID;
use anchor_lang::prelude::*;

/// Settlement account for a particular config and merkle root
/// Settlement defines an insurance event happens and it's needed to be settled
#[account]
#[derive(Debug, Default)]
pub struct Settlement {
    /// this settlement belongs under particular bond, i.e., under particular validator vote account
    pub bond: Pubkey,
    /// stake account authority that manages the funded stake accounts
    pub settlement_authority: Pubkey,
    /// 256-bit merkle root to check the claims against
    pub merkle_root: [u8; 32],
    /// maximum number of funds that can ever be claimed from this [Settlement]
    pub max_total_claim: u64,
    /// maximum number of nodes that can ever be claimed from this [Settlement]
    pub max_num_nodes: u64,
    /// total funds that have been deposited to this [Settlement]
    pub total_funded: u64,
    /// total funds that have been claimed from this [Settlement]
    pub total_funds_claimed: u64,
    /// number of nodes that have been claimed from this [Settlement]
    pub num_nodes_claimed: u64,
    /// epoch that the [Settlement] has been created at
    pub epoch_created_at: u64,
    /// address that collects the rent exempt from the [Settlement] account when closed
    pub rent_collector: Pubkey,
    /// address that may claim the rent exempt for creation of "split stake account"
    pub split_rent_collector: Option<Pubkey>,
    pub split_rent_amount: u64,
    /// PDA bumps
    pub bumps: Bumps,
    /// reserve space for future extensions
    pub reserved: Reserved150,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Debug, Default)]
pub struct Bumps {
    pub pda: u8,
    pub authority: u8,
}

impl Settlement {
    pub fn find_address(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                SETTLEMENT_SEED,
                &self.bond.key().as_ref(),
                &self.merkle_root,
                &[self.bumps.pda],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidSettlementAddress.into())
    }

    pub fn authority_address(&self, settlement_address: &Pubkey) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                SETTLEMENT_AUTHORITY_SEED,
                settlement_address.as_ref(),
                &[self.bumps.authority],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidSettlementAuthorityAddress.into())
    }
}

pub fn find_settlement_authority(settlement_address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SETTLEMENT_AUTHORITY_SEED, &settlement_address.as_ref()],
        &ID,
    )
}
