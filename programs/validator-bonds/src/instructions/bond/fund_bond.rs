use crate::checks::{
    check_stake_exist_and_fully_activated, check_stake_is_initialized_with_withdrawer_authority,
    check_stake_is_not_locked, check_stake_valid_delegation,
};
use crate::error::ErrorCode;
use crate::events::bond::FundBondEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::stake::state::StakeAuthorize;
use anchor_spl::stake::{authorize, Authorize, Stake, StakeAccount};

/// Funds the stake account to the validator bond record.
// The same operation can be performed by manually changing the withdrawer and staker
// authorities of the stake account to match the bond's withdrawer authority address.
// This transaction ensures the stake account is in a state considered properly funded.
#[event_cpi]
#[derive(Accounts)]
pub struct FundBond<'info> {
    pub config: Account<'info, Config>,

    /// bond account to be deposited to with the provided stake account
    #[account(
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
    /// new owner of the stake_account, it's the bonds withdrawer authority
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump,
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// stake account to be deposited
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,

    /// authority signature permitting to change the stake_account authorities
    pub stake_authority: Signer<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_history: Sysvar<'info, StakeHistory>,

    pub stake_program: Program<'info, Stake>,
}

impl<'info> FundBond<'info> {
    pub fn process(ctx: Context<FundBond>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        // check current stake account withdrawer authority with permission to authorize
        check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.stake_authority.key(),
            "stake_account",
        )?;
        // check the stake account is in valid state to be used for bonds
        check_stake_is_not_locked(
            &ctx.accounts.stake_account,
            &ctx.accounts.clock,
            "stake_account",
        )?;
        check_stake_exist_and_fully_activated(
            &ctx.accounts.stake_account,
            ctx.accounts.clock.epoch,
            &ctx.accounts.stake_history,
        )?;
        check_stake_valid_delegation(&ctx.accounts.stake_account, &ctx.accounts.bond.vote_account)?;

        // when the stake account is already "owned" by the bonds program, return OK
        if check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account",
        )
        .is_ok()
        {
            msg!(
                "Stake account {} is already funded to the bonds program",
                ctx.accounts.stake_account.key()
            );
            return Ok(());
        }

        authorize(
            CpiContext::new(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.stake_authority.to_account_info(),
                    new_authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
            ),
            StakeAuthorize::Staker,
            None,
        )?;

        authorize(
            CpiContext::new(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.stake_authority.to_account_info(),
                    new_authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
            ),
            // withdrawer authority (owner) is the validator bonds program
            StakeAuthorize::Withdrawer,
            None,
        )?;

        emit_cpi!(FundBondEvent {
            bond: ctx.accounts.bond.key(),
            vote_account: ctx.accounts.bond.vote_account.key(),
            stake_account: ctx.accounts.stake_account.key(),
            stake_authority_signer: ctx.accounts.stake_authority.key(),
            deposited_amount: ctx.accounts.stake_account.get_lamports(),
        });

        Ok(())
    }
}
