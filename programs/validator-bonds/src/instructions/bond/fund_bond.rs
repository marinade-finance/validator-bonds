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

/// Deposit stake account as validator bond record
#[derive(Accounts)]
pub struct FundBond<'info> {
    #[account()]
    config: Account<'info, Config>,

    /// bond account to be deposited to with the provided stake account
    #[account(
        mut,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.validator_vote_account.as_ref()
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    /// CHECK: PDA
    /// new owner of the stake account, it's the bonds program PDA
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump,
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// stake account to be deposited
    #[account(mut)]
    stake_account: Account<'info, StakeAccount>,

    /// authority signature permitting to change the stake_account authorities
    #[account()]
    stake_authority: Signer<'info>,

    clock: Sysvar<'info, Clock>,

    stake_history: Sysvar<'info, StakeHistory>,

    stake_program: Program<'info, Stake>,
}

impl<'info> FundBond<'info> {
    pub fn process(&mut self) -> Result<()> {
        // when the stake account is already "owned" by the bonds program, let's just return OK
        if check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )
        .is_ok()
        {
            msg!(
                "Stake account {} is already owned by the bonds program",
                self.stake_account.key()
            );
            return Ok(());
        }

        // check we've got signature of the stake account owner
        check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.stake_authority.key(),
            "stake_account",
        )?;
        // check the stake account is in valid state to be used for bonds
        check_stake_is_not_locked(&self.stake_account, &self.clock, "stake_account")?;
        check_stake_exist_and_fully_activated(
            &self.stake_account,
            self.clock.epoch,
            &self.stake_history,
        )?;
        check_stake_valid_delegation(&self.stake_account, &self.bond.validator_vote_account)?;

        authorize(
            CpiContext::new(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.stake_authority.to_account_info(),
                    new_authorized: self.bonds_withdrawer_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
            ),
            StakeAuthorize::Staker,
            None,
        )?;

        authorize(
            CpiContext::new(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.stake_authority.to_account_info(),
                    new_authorized: self.bonds_withdrawer_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
            ),
            // withdrawer authority (owner) is the validator bonds program
            StakeAuthorize::Withdrawer,
            None,
        )?;

        emit!(FundBondEvent {
            bond: self.bond.key(),
            validator_vote: self.bond.validator_vote_account.key(),
            stake_account: self.stake_account.key(),
            stake_authority_signer: self.stake_authority.key(),
            deposited_amount: self.stake_account.get_lamports(),
        });

        Ok(())
    }
}
