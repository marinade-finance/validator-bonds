use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_valid_delegation,
};
use crate::constants::BONDS_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::settlement::CloseSettlementEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};

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
            bond.validator_vote_account.as_ref(),
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
        constraint = settlement.epoch_created_at + config.epochs_to_claim_settlement < clock.epoch @ ErrorCode::SettlementNotExpired,
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            settlement.merkle_root.as_ref(),
            settlement.epoch_created_at.to_le_bytes().as_ref(),
        ],
        bump = settlement.bumps.pda,
    )]
    settlement: Account<'info, Settlement>,

    /// CHECK: verified against settlement account
    #[account(mut)]
    rent_collector: UncheckedAccount<'info>,

    /// CHECK: verified against settlement account
    #[account(mut)]
    split_rent_collector: UncheckedAccount<'info>,

    /// CHECK: PDA
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// a stake account to be used to return back the split rent exempt fee
    #[account(mut)]
    stake_account: Account<'info, StakeAccount>,

    clock: Sysvar<'info, Clock>,

    stake_program: Program<'info, Stake>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,
}

impl<'info> CloseSettlement<'info> {
    pub fn process(&mut self) -> Result<()> {
        require!(true == false, ErrorCode::NotYetImplemented);

        if self.settlement.split_rent_collector.is_some() {
            // stake account is managed by bonds program
            let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
                &self.stake_account,
                &self.bonds_withdrawer_authority.key(),
                "stake_account",
            )?;
            // stake account is delegated (deposited by) the bond validator
            check_stake_valid_delegation(&self.stake_account, &self.bond.validator_vote_account)?;
            // provided stake account must be funded; staker == settlement staker authority
            require_keys_eq!(
                stake_meta.authorized.staker,
                self.settlement.settlement_authority,
                ErrorCode::StakeAccountNotFunded,
            );
            withdraw(
                CpiContext::new_with_signer(
                    self.stake_program.to_account_info(),
                    Withdraw {
                        stake: self.stake_account.to_account_info(),
                        withdrawer: self.bonds_withdrawer_authority.to_account_info(),
                        to: self.split_rent_collector.to_account_info(),
                        clock: self.clock.to_account_info(),
                        stake_history: self.stake_history.to_account_info(),
                    },
                    &[&[
                        BONDS_AUTHORITY_SEED,
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
            max_num_nodes: self.settlement.max_num_nodes,
            total_funded: self.settlement.total_funded,
            total_funds_claimed: self.settlement.total_funds_claimed,
            num_nodes_claimed: self.settlement.num_nodes_claimed,
            rent_collector: self.rent_collector.key(),
            split_rent_collector: self.settlement.split_rent_collector,
            expiration_epoch: self.settlement.epoch_created_at
                + self.config.epochs_to_claim_settlement,
            current_epoch: self.clock.epoch,
        });

        Ok(())
    }
}
