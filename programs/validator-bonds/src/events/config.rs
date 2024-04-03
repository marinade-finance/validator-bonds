use crate::events::{PubkeyValueChange, U64ValueChange};
use anchor_lang::prelude::*;

#[event]
pub struct InitConfigEvent {
    pub config: Pubkey,
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub withdraw_lockup_epochs: u64,
    pub epochs_to_claim_settlement: u64,
    pub minimum_stake_lamports: u64,
    pub bonds_withdrawer_authority: Pubkey,
    pub slots_to_start_settlement_claiming: u64,
}

#[event]
pub struct ConfigureConfigEvent {
    pub admin_authority: Option<PubkeyValueChange>,
    pub operator_authority: Option<PubkeyValueChange>,
    pub pause_authority: Option<PubkeyValueChange>,
    pub epochs_to_claim_settlement: Option<U64ValueChange>,
    pub minimum_stake_lamports: Option<U64ValueChange>,
    pub withdraw_lockup_epochs: Option<U64ValueChange>,
    pub slots_to_start_settlement_claiming: Option<U64ValueChange>,
}

#[event]
pub struct EmergencyPauseEvent {
    pub config: Pubkey,
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub epochs_to_claim_settlement: u64,
    pub withdraw_lockup_epochs: u64,
    pub minimum_stake_lamports: u64,
    pub pause_authority: Pubkey,
}

#[event]
pub struct EmergencyResumeEvent {
    pub config: Pubkey,
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub epochs_to_claim_settlement: u64,
    pub withdraw_lockup_epochs: u64,
    pub minimum_stake_lamports: u64,
    pub pause_authority: Pubkey,
}
