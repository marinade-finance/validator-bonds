use anchor_lang::prelude::*;

/// Root account that configures the validator bonds program
#[account]
#[derive(Debug, Default)]
pub struct Config {
    /// admin authority that can update the config
    pub admin_authority: Pubkey,
    /// Operator authority (bot hot wallet)
    pub operator_authority: Pubkey,
    /// How many epochs to claim the settlement
    pub claim_settlement_after_epochs: u64,
    /// How many epochs before withdraw is allowed
    pub withdraw_lockup_epochs: u64,
}
