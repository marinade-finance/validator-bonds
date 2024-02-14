use crate::events::SplitStakeData;
use crate::state::settlement::Bumps;
use anchor_lang::prelude::*;

#[event]
pub struct InitSettlementEvent {
    pub bond: Pubkey,
    pub vote_account: Pubkey,
    pub authority: Pubkey,
    pub merkle_root: [u8; 32],
    pub max_total_claim: u64,
    pub max_merkle_nodes: u64,
    pub epoch_created_for: u64,
    pub rent_collector: Pubkey,
    pub bumps: Bumps,
}

#[event]
pub struct CloseSettlementEvent {
    pub bond: Pubkey,
    pub settlement: Pubkey,
    pub merkle_root: [u8; 32],
    pub max_total_claim: u64,
    pub max_merkle_nodes: u64,
    pub lamports_funded: u64,
    pub lamports_claimed: u64,
    pub merkle_nodes_claimed: u64,
    pub split_rent_collector: Option<Pubkey>,
    pub split_rent_refund_account: Pubkey,
    pub rent_collector: Pubkey,
    pub expiration_epoch: u64,
    pub current_epoch: u64,
}

#[event]
pub struct FundSettlementEvent {
    pub bond: Pubkey,
    pub vote_account: Pubkey,
    pub settlement: Pubkey,
    pub lamports_funded: u64,
    pub lamports_claimed: u64,
    pub merkle_nodes_claimed: u64,
    pub stake_account: Pubkey,
    pub split_stake_account: Option<SplitStakeData>,
    pub split_rent_collector: Option<Pubkey>,
    pub split_rent_amount: u64,
    pub funding_amount: u64,
}
