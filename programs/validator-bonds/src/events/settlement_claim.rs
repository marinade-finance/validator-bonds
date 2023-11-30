use anchor_lang::prelude::*;

#[event]
pub struct ClaimSettlementEvent {
    pub settlement: Pubkey,
    pub settlement_claim: Pubkey,
    pub stake_authority: Pubkey,
    pub withdraw_authority: Pubkey,
    pub vote_account: Pubkey,
    pub claim: u64,
    pub rent_collector: Pubkey,
    pub bump: u8,
}

#[event]
pub struct CloseSettlementClaimEvent {
    pub settlement: Pubkey,
    pub rent_collector: Pubkey,
}
