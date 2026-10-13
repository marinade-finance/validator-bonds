use crate::checks::{
    check_stake_exist_and_activating_or_activated,
    check_stake_is_initialized_with_withdrawer_authority, check_stake_is_not_locked,
    check_stake_valid_delegation,
};
use crate::error::ErrorCode;
use crate::events::bond::RefundBondBalanceEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_spl::stake::StakeAccount;

/// Permissionless recovery of lamports mistakenly transferred to the bond account.
/// Sweeps the bond account balance above rent-exempt minimum onto an existing
/// bond-funded stake account, making it part of the bond funding.
#[event_cpi]
#[derive(Accounts)]
pub struct RefundBondBalance<'info> {
    pub config: Account<'info, Config>,

    /// bond account whose excess lamports are refunded into the stake account
    #[account(
        mut,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.vote_account.as_ref()
        ],
        bump = bond.bump,
    )]
    pub bond: Account<'info, Bond>,

    /// CHECK: PDA
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump,
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// bond-funded stake account the excess lamports are credited to
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_history: Sysvar<'info, StakeHistory>,

    pub rent: Sysvar<'info, Rent>,
}

impl RefundBondBalance<'_> {
    pub fn process(ctx: Context<RefundBondBalance>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // staker == bonds withdrawer authority means not funded to a settlement
        require_keys_eq!(
            stake_meta.authorized.staker,
            ctx.accounts.bonds_withdrawer_authority.key(),
            ErrorCode::StakeAccountIsFundedToSettlement,
        );
        check_stake_valid_delegation(&ctx.accounts.stake_account, &ctx.accounts.bond.vote_account)?;
        check_stake_is_not_locked(
            &ctx.accounts.stake_account,
            &ctx.accounts.clock,
            "stake_account",
        )?;
        check_stake_exist_and_activating_or_activated(
            &ctx.accounts.stake_account,
            ctx.accounts.clock.epoch,
            &ctx.accounts.stake_history,
        )?;

        let bond_info = ctx.accounts.bond.to_account_info();
        let rent_exempt = ctx.accounts.rent.minimum_balance(bond_info.data_len());
        let excess = bond_info.lamports().saturating_sub(rent_exempt);
        require_gt!(excess, 0, ErrorCode::RefundBondBalanceNoExcessLamports);

        bond_info.sub_lamports(excess)?;
        ctx.accounts
            .stake_account
            .to_account_info()
            .add_lamports(excess)?;

        emit_cpi!(RefundBondBalanceEvent {
            bond: ctx.accounts.bond.key(),
            vote_account: ctx.accounts.bond.vote_account.key(),
            stake_account: ctx.accounts.stake_account.key(),
            amount: excess,
        });
        msg!(
            "bond {} refunded excess {} lamports to stake account {}",
            ctx.accounts.bond.key(),
            excess,
            ctx.accounts.stake_account.key()
        );

        Ok(())
    }
}
