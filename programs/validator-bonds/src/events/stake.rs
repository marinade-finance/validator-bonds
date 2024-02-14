use crate::events::DelegationInfo;
use anchor_lang::prelude::*;

#[event]
pub struct MergeEvent {
    pub config: Pubkey,
    pub staker_authority: Pubkey,
    pub destination_stake: Pubkey,
    pub destination_delegation: Option<DelegationInfo>,
    pub source_stake: Pubkey,
    pub source_delegation: Option<DelegationInfo>,
}

#[event]
pub struct ResetEvent {
    pub config: Pubkey,
    pub bond: Pubkey,
    pub settlement: Pubkey,
    pub stake_account: Pubkey,
    pub vote_account: Pubkey,
    pub settlement_authority: Pubkey,
}
