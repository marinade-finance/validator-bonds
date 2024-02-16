use crate::error::ErrorCode;
use crate::events::config::{EmergencyPauseEvent, EmergencyResumeEvent};
use crate::state::config::Config;
use anchor_lang::prelude::*;

/// The program can be paused in case of an emergency
#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    #[account(
        mut,
        has_one = pause_authority @ ErrorCode::InvalidPauseAuthority
    )]
    pub config: Account<'info, Config>,

    pub pause_authority: Signer<'info>,
}

impl<'info> EmergencyPause<'info> {
    pub fn pause(&mut self) -> Result<()> {
        require!(!self.config.paused, ErrorCode::AlreadyPaused);
        self.config.paused = true;
        emit!(EmergencyPauseEvent {
            config: self.config.key(),
            pause_authority: self.pause_authority.key(),
            admin_authority: self.config.admin_authority,
            operator_authority: self.config.operator_authority,
            epochs_to_claim_settlement: self.config.epochs_to_claim_settlement,
            withdraw_lockup_epochs: self.config.withdraw_lockup_epochs,
            minimum_stake_lamports: self.config.minimum_stake_lamports,
        });

        Ok(())
    }

    pub fn resume(&mut self) -> Result<()> {
        require!(self.config.paused, ErrorCode::NotPaused);
        self.config.paused = false;
        emit!(EmergencyResumeEvent {
            config: self.config.key(),
            pause_authority: self.pause_authority.key(),
            admin_authority: self.config.admin_authority,
            operator_authority: self.config.operator_authority,
            epochs_to_claim_settlement: self.config.epochs_to_claim_settlement,
            withdraw_lockup_epochs: self.config.withdraw_lockup_epochs,
            minimum_stake_lamports: self.config.minimum_stake_lamports,
        });
        Ok(())
    }
}
