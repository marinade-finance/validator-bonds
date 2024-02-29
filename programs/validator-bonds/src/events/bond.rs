use crate::events::{PubkeyValueChange, U64ValueChange};
use anchor_lang::prelude::*;

#[event]
pub struct InitBondEvent {
    pub config_address: Pubkey,
    pub vote_account: Pubkey,
    pub validator_identity: Pubkey,
    pub authority: Pubkey,
    pub cpmpe: u64,
    pub bond_bump: u8,
}

#[event]
pub struct ConfigureBondEvent {
    pub bond_authority: Option<PubkeyValueChange>,
    pub cpmpe: Option<U64ValueChange>,
}

#[event]
pub struct CloseBondEvent {
    pub config_address: Pubkey,
    pub vote_account: Pubkey,
    pub authority: Pubkey,
    pub cpmpe: u64,
    pub bump: u8,
}

#[event]
pub struct FundBondEvent {
    pub bond: Pubkey,
    pub vote_account: Pubkey,
    pub stake_account: Pubkey,
    pub stake_authority_signer: Pubkey,
    pub deposited_amount: u64,
}

#[event]
pub struct MintBondEvent {
    pub bond: Pubkey,
    pub destination_token_account: Pubkey,
    pub destination_authority: Pubkey,
    pub token_metadata: Pubkey,
}
