use crate::error::ErrorCode;
use crate::events::settlement::CancelSettlementEvent;
use crate::instructions::withdraw_refund_stake_account;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_spl::stake::Stake;

/// Closes the settlement account, whoever can close it when the epoch expires
#[event_cpi]
#[derive(Accounts)]
pub struct CancelSettlement<'info> {
    #[account(
        mut,
        constraint = config.operator_authority == authority.key() ||
                     config.pause_authority == authority.key() @ ErrorCode::OperatorAndPauseAuthorityMismatch,
    )]
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
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            settlement.merkle_root.as_ref(),
            settlement.epoch_created_for.to_le_bytes().as_ref(),
        ],
        bump = settlement.bumps.pda,
    )]
    pub settlement: Account<'info, Settlement>,

    /// Cancelling is permitted only to emergency or operator authority
    pub authority: Signer<'info>,

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
    /// The lamports are utilized to pay back the rent exemption of the split_stake_account
    #[account(mut)]
    pub split_rent_refund_account: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,
}

impl<'info> CancelSettlement<'info> {
    pub fn process(ctx: Context<CancelSettlement>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        if ctx.accounts.settlement.split_rent_collector.is_some() {
            withdraw_refund_stake_account(
                &ctx.accounts.split_rent_refund_account,
                &ctx.accounts.bonds_withdrawer_authority,
                &ctx.accounts.bond,
                &ctx.accounts.stake_program,
                &ctx.accounts.split_rent_collector,
                ctx.accounts.settlement.split_rent_amount,
                &ctx.accounts.clock,
                &ctx.accounts.stake_history,
                &ctx.accounts.config,
            )?;
        }

        emit_cpi!(CancelSettlementEvent {
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
            split_rent_refund: ctx
                .accounts
                .settlement
                .split_rent_collector
                .map(|_| ctx.accounts.split_rent_refund_account.key()),
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }
}
