use crate::events::{PubkeyValueChange, U64ValueChange};
use anchor_lang::prelude::*;

#[event]
pub struct InitBondEvent {
    pub bond: Pubkey,
    pub config: Pubkey,
    pub vote_account: Pubkey,
    pub validator_identity: Pubkey,
    pub authority: Pubkey,
    pub cpmpe: u64,
}

#[event]
pub struct ConfigureBondEvent {
    pub bond_authority: Option<PubkeyValueChange>,
    pub cpmpe: Option<U64ValueChange>,
}

#[event]
pub struct ConfigureBondWithMintEvent {
    pub validator_identity: Pubkey,
    pub bond_authority: Option<PubkeyValueChange>,
    pub cpmpe: Option<U64ValueChange>,
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
    pub validator_identity: Pubkey,
    pub validator_identity_token_account: Pubkey,
    pub token_metadata: Pubkey,
}
