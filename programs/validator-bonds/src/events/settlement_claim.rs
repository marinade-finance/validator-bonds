use crate::events::U64ValueChange;
use anchor_lang::prelude::*;

#[event]
pub struct ClaimSettlementEvent {
    pub settlement_claim: Pubkey,
    pub settlement: Pubkey,
    pub settlement_lamports_claimed: U64ValueChange,
    pub settlement_merkle_nodes_claimed: u64,
    pub stake_account_to: Pubkey,
    pub stake_account_withdrawer: Pubkey,
    pub stake_account_staker: Pubkey,
    pub amount: u64,
    pub rent_collector: Pubkey,
}

#[event]
pub struct CloseSettlementClaimEvent {
    pub settlement: Pubkey,
    pub rent_collector: Pubkey,
}
