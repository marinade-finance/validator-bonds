use anchor_lang::prelude::*;

#[event]
pub struct InitConfigEvent {
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub claim_settlement_after_epochs: u64,
    pub withdraw_lockup_epochs: u64,
}
