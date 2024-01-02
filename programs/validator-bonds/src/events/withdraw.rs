use crate::events::{SplitStakeData, U64ValueChange};
use anchor_lang::prelude::*;

#[event]
pub struct InitWithdrawRequestEvent {
    pub withdraw_request: Pubkey,
    pub bond: Pubkey,
    pub validator_vote_account: Pubkey,
    pub bump: u8,
    pub epoch: u64,
    pub requested_amount: u64,
}

#[event]
pub struct CancelWithdrawRequestEvent {
    pub withdraw_request: Pubkey,
    pub bond: Pubkey,
    pub authority: Pubkey,
    pub requested_amount: u64,
    pub withdrawn_amount: u64,
}

#[event]
pub struct ClaimWithdrawRequestEvent {
    pub withdraw_request: Pubkey,
    pub bond: Pubkey,
    pub validator_vote_account: Pubkey,
    pub stake_account: Pubkey,
    pub split_stake: Option<SplitStakeData>,
    pub new_stake_account_owner: Pubkey,
    pub withdrawing_amount: u64,
    pub withdrawn_amount: U64ValueChange,
}
