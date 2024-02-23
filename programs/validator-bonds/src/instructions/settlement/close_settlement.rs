use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_valid_delegation,
    deserialize_stake_account,
};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::settlement::CloseSettlementEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_spl::stake::{withdraw, Stake, Withdraw};

/// Closes the settlement account, whoever can close it when the epoch expires
#[derive(Accounts)]
pub struct CloseSettlement<'info> {
    #[account()]
    config: Account<'info, Config>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.vote_account.as_ref(),
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    /// settlement to close when expired
    #[account(
        mut,
        close = rent_collector,
        has_one = bond @ ErrorCode::BondAccountMismatch,
        has_one = rent_collector @ ErrorCode::RentCollectorMismatch,
        constraint = (settlement.split_rent_collector.is_none() || settlement.split_rent_collector.unwrap() == split_rent_collector.key()) @ ErrorCode::RentCollectorMismatch,
        constraint = settlement.epoch_created_for + config.epochs_to_claim_settlement < clock.epoch @ ErrorCode::SettlementNotExpired,
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            settlement.merkle_root.as_ref(),
            settlement.epoch_created_for.to_le_bytes().as_ref(),
        ],
        bump = settlement.bumps.pda,
    )]
    settlement: Account<'info, Settlement>,

    /// CHECK: PDA
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: verified at settlement #[account()]
    #[account(mut)]
    rent_collector: UncheckedAccount<'info>,

    /// CHECK: verified at settlement #[account()]
    #[account(mut)]
    split_rent_collector: UncheckedAccount<'info>,

    /// CHECK: deserialization in code only when needed
    /// a stake account that was funded to the settlement credited to bond's validator vote account
    /// lamports of the stake accounts are used to pay back rent exempt of the split_stake_account
    /// that can be created on funding the settlement
    #[account(mut)]
    split_rent_refund_account: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,

    stake_program: Program<'info, Stake>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,
}

impl<'info> CloseSettlement<'info> {
    pub fn process(&mut self) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        if self.settlement.split_rent_collector.is_some() {
            let stake_account = deserialize_stake_account(&self.split_rent_refund_account)?;
            // stake account is managed by bonds program
            check_stake_is_initialized_with_withdrawer_authority(
                &stake_account,
                &self.bonds_withdrawer_authority.key(),
                "stake_account",
            )?;
            // stake account is delegated to bond's validator vote account
            check_stake_valid_delegation(&stake_account, &self.bond.vote_account)?;

            withdraw(
                CpiContext::new_with_signer(
                    self.stake_program.to_account_info(),
                    Withdraw {
                        stake: self.split_rent_refund_account.to_account_info(),
                        withdrawer: self.bonds_withdrawer_authority.to_account_info(),
                        to: self.split_rent_collector.to_account_info(),
                        clock: self.clock.to_account_info(),
                        stake_history: self.stake_history.to_account_info(),
                    },
                    &[&[
                        BONDS_WITHDRAWER_AUTHORITY_SEED,
                        &self.config.key().as_ref(),
                        &[self.config.bonds_withdrawer_authority_bump],
                    ]],
                ),
                self.settlement.split_rent_amount,
                None,
            )?;
        }

        emit!(CloseSettlementEvent {
            bond: self.settlement.bond.key(),
            settlement: self.settlement.key(),
            merkle_root: self.settlement.merkle_root,
            max_total_claim: self.settlement.max_total_claim,
            max_merkle_nodes: self.settlement.max_merkle_nodes,
            lamports_funded: self.settlement.lamports_funded,
            lamports_claimed: self.settlement.lamports_claimed,
            merkle_nodes_claimed: self.settlement.merkle_nodes_claimed,
            rent_collector: self.rent_collector.key(),
            split_rent_collector: self.settlement.split_rent_collector,
            split_rent_refund_account: self.split_rent_refund_account.key(),
            expiration_epoch: self.settlement.epoch_created_for
                + self.config.epochs_to_claim_settlement,
            current_epoch: self.clock.epoch,
        });

        Ok(())
    }
}
