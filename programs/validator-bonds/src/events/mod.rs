use anchor_lang::prelude::*;
use anchor_lang::solana_program::stake::state::Delegation;

pub mod bond;
pub mod config;
pub mod settlement;
pub mod settlement_claim;
pub mod stake;
pub mod withdraw;

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct PubkeyValueChange {
    pub old: Pubkey,
    pub new: Pubkey,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct U64ValueChange {
    pub old: u64,
    pub new: u64,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct DelegationInfo {
    /// to whom the stake is delegated
    pub voter_pubkey: Pubkey,
    /// activated stake amount, set at delegate() time
    pub stake: u64,
    /// epoch at which this stake was activated, std::Epoch::MAX if is a bootstrap stake
    pub activation_epoch: u64,
    /// epoch the stake was deactivated, std::Epoch::MAX if not deactivated
    pub deactivation_epoch: u64,
}

impl From<Delegation> for DelegationInfo {
    fn from(
        Delegation {
            voter_pubkey,
            stake,
            activation_epoch,
            deactivation_epoch,
            ..
        }: Delegation,
    ) -> Self {
        Self {
            voter_pubkey,
            stake,
            activation_epoch,
            deactivation_epoch,
        }
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SplitStakeData {
    pub address: Pubkey,
    pub amount: u64,
}
