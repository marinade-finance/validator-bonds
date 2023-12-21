use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_valid_delegation,
};
use crate::constants::BONDS_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::stake::ResetEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::stake;
use anchor_lang::solana_program::stake::state::StakeAuthorize;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_spl::stake::{authorize, Authorize, Stake, StakeAccount};

/// Resetting stake authority of a funded stake account belonging to removed settlement.
/// I.e., for provided stake account it changes the stake authority from settlement stake authority to bonds withdrawer authority.
#[derive(Accounts)]
pub struct ResetStake<'info> {
    /// the config root account under which the bond was created
    #[account()]
    config: Account<'info, Config>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.validator_vote_account.key().as_ref()
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    /// CHECK: verification that it does not exist
    settlement: UncheckedAccount<'info>,

    /// stake account belonging to authority of the settlement
    #[account(mut)]
    stake_account: Account<'info, StakeAccount>,

    /// CHECK: CPI calls of stake authorize permits to change the staker only with correct settlement authority
    settlement_authority: UncheckedAccount<'info>,

    /// CHECK: PDA
    /// authority that owns (withdrawer authority) all stakes account under the bonds program
    #[account(
      seeds = [
          b"bonds_authority",
          config.key().as_ref(),
      ],
      bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: the validator vote account to which the stake account is delegated, check in code
    validator_vote_account: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,

    /// CHECK: CPI
    #[account(address = stake::config::ID)]
    stake_config: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,

    stake_program: Program<'info, Stake>,
}

impl<'info> ResetStake<'info> {
    pub fn process(&mut self) -> Result<()> {
        require!(true == false, ErrorCode::NotYetImplemented);

        // settlement account cannot exists
        require_eq!(
            self.settlement.lamports(),
            0,
            ErrorCode::SettlementNotClosed
        );

        // stake account is managed by bonds program and belongs under bond validator
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // one bond can be created for a validator vote account, this stake account belongs to bond
        check_stake_valid_delegation(&self.stake_account, &self.bond.validator_vote_account)?;
        check_stake_valid_delegation(&self.stake_account, &self.validator_vote_account.key())?;
        // stake account is funded to particular settlement
        require_eq!(
            stake_meta.authorized.staker,
            self.settlement_authority.key(),
            ErrorCode::SettlementAuthorityMismatch
        );

        // moving the stake account under the bonds authority (withdrawer and staker will be the same)
        // https://github.com/solana-labs/solana/blob/v1.17.10/sdk/program/src/stake/state.rs#L312
        authorize(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.settlement_authority.to_account_info(),
                    new_authorized: self.bonds_withdrawer_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
                &[&[
                    BONDS_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Staker,
            None,
        )?;

        // activate the stake, i.e., resetting is delegating to the validator again
        let delegate_instruction = &stake::instruction::delegate_stake(
            &self.stake_account.key(),
            &self.bonds_withdrawer_authority.key(),
            &self.bond.validator_vote_account,
        );
        invoke_signed(
            delegate_instruction,
            &[
                self.stake_program.to_account_info(),
                self.stake_account.to_account_info(),
                self.bonds_withdrawer_authority.to_account_info(),
                self.validator_vote_account.to_account_info(),
                self.clock.to_account_info(),
                self.stake_history.to_account_info(),
                self.stake_config.to_account_info(),
            ],
            &[&[
                BONDS_AUTHORITY_SEED,
                &self.config.key().as_ref(),
                &[self.config.bonds_withdrawer_authority_bump],
            ]],
        )?;

        emit!(ResetEvent {
            config: self.config.key(),
            bond: self.bond.key(),
            settlement: self.settlement.key(),
            stake_account: self.stake_account.key(),
            validator_vote_acount: self.validator_vote_account.key(),
            settlement_authority: self.settlement_authority.key(),
            bonds_withdrawer_authority: self.bonds_withdrawer_authority.key(),
        });

        Ok(())
    }
}
