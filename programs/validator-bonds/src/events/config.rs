use crate::events::{PubkeyValueChange, U64ValueChange};
use anchor_lang::prelude::*;

#[event]
pub struct InitConfigEvent {
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub withdraw_lockup_epochs: u64,
    pub epochs_to_claim_settlement: u64,
    pub minimum_stake_lamports: u64,
    pub bonds_withdrawer_authority: Pubkey,
    pub bonds_withdrawer_authority_bump: u8,
}

#[event]
pub struct ConfigureConfigEvent {
    pub admin_authority: Option<PubkeyValueChange>,
    pub operator_authority: Option<PubkeyValueChange>,
    pub epochs_to_claim_settlement: Option<U64ValueChange>,
    pub minimum_stake_lamports: Option<U64ValueChange>,
    pub withdraw_lockup_epochs: Option<U64ValueChange>,
}
