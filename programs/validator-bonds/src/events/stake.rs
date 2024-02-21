use crate::events::DelegationInfo;
use anchor_lang::prelude::*;

#[event]
pub struct MergeStakeEvent {
    pub config: Pubkey,
    pub staker_authority: Pubkey,
    pub destination_stake: Pubkey,
    pub destination_delegation: Option<DelegationInfo>,
    pub source_stake: Pubkey,
    pub source_delegation: Option<DelegationInfo>,
}

#[event]
pub struct ResetStakeEvent {
    pub config: Pubkey,
    pub bond: Pubkey,
    pub settlement: Pubkey,
    pub stake_account: Pubkey,
    pub vote_account: Pubkey,
    pub settlement_authority: Pubkey,
}

#[event]
pub struct WithdrawStakeEvent {
    pub config: Pubkey,
    pub operator_authority: Pubkey,
    pub settlement: Pubkey,
    pub stake_account: Pubkey,
    pub withdraw_to: Pubkey,
    pub settlement_authority: Pubkey,
    pub withdrawn_amount: u64,
}
