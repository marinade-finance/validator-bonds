use crate::checks::{check_stake_is_initialized_with_authority, check_stake_valid_delegation};
use crate::constants::BONDS_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::stake::ResetEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::stake::state::StakeAuthorize;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_spl::stake::{authorize, Authorize, Stake, StakeAccount};

// TODO: considering here that settlement_seed pubkey and bumps will be provided from outside by bot
#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ResetStateArgs {
    pub settlement_stake_authority_bump: u8,
}

/// Resetting stake authority of a funded stake account belonging to removed settlement.
/// I.e., for provided stake account it changes the stake authority from settlement stake authority to bonds withdrawer authority.
#[derive(Accounts)]
#[instruction(params: ResetStateArgs)]
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

    /// CHECK: PDA
    #[account(
        seeds = [
            b"settlement_authority",
            settlement.key().as_ref(),
        ],
        bump = params.settlement_stake_authority_bump,
    )]
    settlement_authority: UncheckedAccount<'info>,

    /// CHECK: PDA
    /// authority that manages (owns being withdrawer authority) all stakes account under the bonds program
    #[account(
      seeds = [
          b"bonds_authority",
          config.key().as_ref(),
      ],
      bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,

    stake_program: Program<'info, Stake>,
}

impl<'info> ResetStake<'info> {
    pub fn process(&mut self) -> Result<()> {
        // settlement account cannot exists
        require_eq!(
            self.settlement.lamports(),
            0,
            ErrorCode::SettlementNotClosed
        );

        // stake account is managed by bonds program and belongs under bond validator
        let stake_meta = check_stake_is_initialized_with_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // one bond can be created for a validator vote account, this stake account belongs to bond
        check_stake_valid_delegation(&self.stake_account, &self.bond.validator_vote_account)?;
        // stake account is funded to particular settlement
        require_eq!(
            stake_meta.authorized.staker,
            self.settlement_authority.key(),
            ErrorCode::SettlementAuthorityMismatch
        );

        // moving the stake account under the bonds authority (withdrawer (owner) authority and staker will be the same)
        authorize(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.bonds_withdrawer_authority.to_account_info(),
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

        emit!(ResetEvent {
            config: self.config.key(),
            bond: self.bond.key(),
            settlement: self.settlement.key(),
            stake_account: self.stake_account.key(),
            settlement_authority: self.settlement_authority.key(),
            bonds_withdrawer_authority: self.bonds_withdrawer_authority.key(),
        });

        Ok(())
    }
}
