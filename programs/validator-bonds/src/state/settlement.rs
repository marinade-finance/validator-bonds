use crate::constants::{SETTLEMENT_AUTHORITY_SEED, SETTLEMENT_SEED};
use crate::error::ErrorCode;
use crate::ID;
use anchor_lang::prelude::*;
use std::fmt::Debug;

/// Settlement account for a particular config and merkle root
/// Settlement defines that a protected event happened and it will be settled
#[account]
#[derive(Debug)]
pub struct Settlement {
    /// this settlement belongs under particular bond, i.e., under particular validator vote account
    pub bond: Pubkey,
    /// settlement authority used as the 'staker' stake account authority
    /// of stake accounts funded to this settlement
    pub authority: Pubkey,
    /// 256-bit merkle root to check the claims against
    pub merkle_root: [u8; 32],
    /// maximum number of funds that can ever be claimed from this [Settlement]
    pub max_total_claim: u64,
    /// maximum number of merkle tree nodes that can ever be claimed from this [Settlement]
    pub max_merkle_nodes: u64,
    /// total lamports funded to this [Settlement]
    pub lamports_funded: u64,
    /// total lamports that have been claimed from this [Settlement]
    pub lamports_claimed: u64,
    /// number of nodes that have been claimed from this [Settlement]
    pub merkle_nodes_claimed: u64,
    /// what epoch the [Settlement] has been created for
    pub epoch_created_for: u64,
    /// address that collects the rent exempt from the [Settlement] account when closed
    pub rent_collector: Pubkey,
    /// address claiming the rent exempt for "split stake account" created on funding settlement
    pub split_rent_collector: Option<Pubkey>,
    pub split_rent_amount: u64,
    /// PDA bumps
    pub bumps: Bumps,
    /// reserve space for future extensions
    pub reserved: [u8; 99],
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
                &self.epoch_created_for.to_le_bytes(),
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

// TODO: find authority for both settlement and bonds withdrawer
pub fn find_settlement_authority(settlement_address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SETTLEMENT_AUTHORITY_SEED, &settlement_address.as_ref()],
        &ID,
    )
}
