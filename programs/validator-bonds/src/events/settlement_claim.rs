use anchor_lang::prelude::*;

#[event]
pub struct ClaimSettlementEvent {
    pub settlement: Pubkey,
    pub settlement_claim: Pubkey,
    pub settlement_lamports_claimed: u64,
    pub settlement_merkle_nodes_claimed: u64,
    pub stake_account_to: Pubkey,
    pub stake_account_withdrawer: Pubkey,
    pub stake_account_staker: Pubkey,
    pub amount: u64,
    pub rent_collector: Pubkey,
    pub bump: u8,
}

#[event]
pub struct CloseSettlementClaimEvent {
    pub settlement: Pubkey,
    pub rent_collector: Pubkey,
}
