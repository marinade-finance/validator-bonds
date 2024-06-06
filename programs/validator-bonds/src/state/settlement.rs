use crate::constants::{SETTLEMENT_CLAIMS_SEED, SETTLEMENT_SEED, SETTLEMENT_STAKER_AUTHORITY_SEED};
use crate::error::ErrorCode;
use crate::ID;
use anchor_lang::prelude::*;
use std::fmt::Debug;

/// Settlement account for a particular config and merkle root
/// Settlement defines that a protected event happened and it will be settled
#[account]
#[derive(Debug)]
pub struct Settlement {
    /// the settlement belongs under this bond, i.e., under a particular validator vote account
    pub bond: Pubkey,
    /// settlement authority used as the 'staker' stake account authority
    /// of stake accounts funded to this settlement
    pub staker_authority: Pubkey,
    /// 256-bit merkle root to check the claims against
    pub merkle_root: [u8; 32],
    /// maximum number of funds that can ever be claimed
    pub max_total_claim: u64,
    /// maximum number of merkle tree nodes that can ever be claimed
    pub max_merkle_nodes: u64,
    /// total lamports funded
    pub lamports_funded: u64,
    /// total lamports that have been claimed
    pub lamports_claimed: u64,
    /// number of nodes that have been claimed
    pub merkle_nodes_claimed: u64,
    /// what epoch the Settlement has been created for
    pub epoch_created_for: u64,
    /// when the Settlement was created
    pub slot_created_at: u64,
    /// address that collects the rent exempt from the Settlement account when closed
    pub rent_collector: Pubkey,
    /// address that collects rent exempt for "split stake account" possibly created on funding settlement
    pub split_rent_collector: Option<Pubkey>,
    /// amount of lamports that are collected for rent exempt for "split stake account"
    pub split_rent_amount: u64,
    /// PDA bumps
    pub bumps: Bumps,
    /// reserve space for future extensions
    pub reserved: [u8; 90],
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Debug, Default)]
pub struct Bumps {
    pub pda: u8,
    pub staker_authority: u8,
    pub settlement_claims: u8,
}

impl Settlement {
    pub fn address(&self) -> Result<Pubkey> {
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

    pub fn settlement_staker_authority(&self, settlement_address: &Pubkey) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                SETTLEMENT_STAKER_AUTHORITY_SEED,
                settlement_address.as_ref(),
                &[self.bumps.staker_authority],
            ],
            &ID,
        )
        .map_err(|_| ErrorCode::InvalidSettlementAuthorityAddress.into())
    }

    pub fn settlement_claims_address(settlement_address: &Pubkey) -> Result<Pubkey> {
        Pubkey::create_program_address(&[SETTLEMENT_CLAIMS_SEED, &settlement_address.as_ref()], &ID)
            .map_err(|_| ErrorCode::InvalidSettlementClaimAddress.into())
    }
}

pub fn find_settlement_address(bond: &Pubkey, merkle_root: &[u8; 32], epoch: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SETTLEMENT_SEED,
            bond.as_ref(),
            merkle_root,
            &epoch.to_le_bytes(),
        ],
        &ID,
    )
}

pub fn find_settlement_staker_authority(settlement_address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SETTLEMENT_STAKER_AUTHORITY_SEED,
            &settlement_address.as_ref(),
        ],
        &ID,
    )
}

pub fn find_settlement_claims_address(settlement_address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SETTLEMENT_CLAIMS_SEED, &settlement_address.as_ref()], &ID)
}
