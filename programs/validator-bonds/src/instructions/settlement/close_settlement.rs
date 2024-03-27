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
#[event_cpi]
#[derive(Accounts)]
pub struct CloseSettlement<'info> {
    pub config: Account<'info, Config>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.vote_account.as_ref(),
        ],
        bump = bond.bump,
    )]
    pub bond: Account<'info, Bond>,

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
    pub settlement: Account<'info, Settlement>,

    /// CHECK: PDA
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: verified at settlement #[account()]
    #[account(mut)]
    pub rent_collector: UncheckedAccount<'info>,

    /// CHECK: verified at settlement #[account()]
    #[account(mut)]
    pub split_rent_collector: UncheckedAccount<'info>,

    /// CHECK: deserialization in code only when needed
    /// The stake account is funded to the settlement and credited to the bond's validator vote account.
    /// The lamports are utilized to pay back the rent exemption of the split_stake_account, which can be created upon funding the settlement.
    #[account(mut)]
    pub split_rent_refund_account: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,
}

impl<'info> CloseSettlement<'info> {
    pub fn process(ctx: Context<CloseSettlement>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        if ctx.accounts.settlement.split_rent_collector.is_some() {
            let stake_account = deserialize_stake_account(&ctx.accounts.split_rent_refund_account)?;
            // stake account is managed by bonds program
            check_stake_is_initialized_with_withdrawer_authority(
                &stake_account,
                &ctx.accounts.bonds_withdrawer_authority.key(),
                "stake_account",
            )?;
            // stake account is delegated to bond's validator vote account
            check_stake_valid_delegation(&stake_account, &ctx.accounts.bond.vote_account)?;

            withdraw(
                CpiContext::new_with_signer(
                    ctx.accounts.stake_program.to_account_info(),
                    Withdraw {
                        stake: ctx.accounts.split_rent_refund_account.to_account_info(),
                        withdrawer: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                        to: ctx.accounts.split_rent_collector.to_account_info(),
                        clock: ctx.accounts.clock.to_account_info(),
                        stake_history: ctx.accounts.stake_history.to_account_info(),
                    },
                    &[&[
                        BONDS_WITHDRAWER_AUTHORITY_SEED,
                        &ctx.accounts.config.key().as_ref(),
                        &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                    ]],
                ),
                ctx.accounts.settlement.split_rent_amount,
                None,
            )?;
        }

        emit_cpi!(CloseSettlementEvent {
            bond: ctx.accounts.settlement.bond.key(),
            settlement: ctx.accounts.settlement.key(),
            merkle_root: ctx.accounts.settlement.merkle_root,
            max_total_claim: ctx.accounts.settlement.max_total_claim,
            max_merkle_nodes: ctx.accounts.settlement.max_merkle_nodes,
            lamports_funded: ctx.accounts.settlement.lamports_funded,
            lamports_claimed: ctx.accounts.settlement.lamports_claimed,
            merkle_nodes_claimed: ctx.accounts.settlement.merkle_nodes_claimed,
            rent_collector: ctx.accounts.rent_collector.key(),
            split_rent_collector: ctx.accounts.settlement.split_rent_collector,
            split_rent_refund_account: ctx.accounts.split_rent_refund_account.key(),
            expiration_epoch: ctx.accounts.settlement.epoch_created_for
                + ctx.accounts.config.epochs_to_claim_settlement,
            current_epoch: ctx.accounts.clock.epoch,
        });

        Ok(())
    }
}
