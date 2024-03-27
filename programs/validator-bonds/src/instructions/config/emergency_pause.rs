use crate::error::ErrorCode;
use crate::events::config::{EmergencyPauseEvent, EmergencyResumeEvent};
use crate::state::config::Config;
use anchor_lang::prelude::*;

/// The program can be paused in case of an emergency
#[event_cpi]
#[derive(Accounts)]
pub struct EmergencyPauseResume<'info> {
    #[account(
        mut,
        has_one = pause_authority @ ErrorCode::InvalidPauseAuthority
    )]
    pub config: Account<'info, Config>,

    pub pause_authority: Signer<'info>,
}

impl<'info> EmergencyPauseResume<'info> {
    pub fn pause(ctx: Context<EmergencyPauseResume>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::AlreadyPaused);
        ctx.accounts.config.paused = true;
        emit_cpi!(EmergencyPauseEvent {
            config: ctx.accounts.config.key(),
            pause_authority: ctx.accounts.pause_authority.key(),
            admin_authority: ctx.accounts.config.admin_authority,
            operator_authority: ctx.accounts.config.operator_authority,
            epochs_to_claim_settlement: ctx.accounts.config.epochs_to_claim_settlement,
            withdraw_lockup_epochs: ctx.accounts.config.withdraw_lockup_epochs,
            minimum_stake_lamports: ctx.accounts.config.minimum_stake_lamports,
        });

        Ok(())
    }

    pub fn resume(ctx: Context<EmergencyPauseResume>) -> Result<()> {
        require!(ctx.accounts.config.paused, ErrorCode::NotPaused);
        ctx.accounts.config.paused = false;
        emit_cpi!(EmergencyResumeEvent {
            config: ctx.accounts.config.key(),
            pause_authority: ctx.accounts.pause_authority.key(),
            admin_authority: ctx.accounts.config.admin_authority,
            operator_authority: ctx.accounts.config.operator_authority,
            epochs_to_claim_settlement: ctx.accounts.config.epochs_to_claim_settlement,
            withdraw_lockup_epochs: ctx.accounts.config.withdraw_lockup_epochs,
            minimum_stake_lamports: ctx.accounts.config.minimum_stake_lamports,
        });
        Ok(())
    }
}
