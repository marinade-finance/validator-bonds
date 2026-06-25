use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_is_not_locked, get_delegation,
};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::settlement::SwapSettlementStakeEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::stake::state::StakeAuthorize;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_lang::solana_program::{stake, stake::config::ID as stake_config_id};
use anchor_spl::stake::{
    authorize, deactivate_stake, Authorize, DeactivateStake, Stake, StakeAccount,
};

const SETTLEMENT_STAKER_AUTHORITY_SEED: &[u8] = b"settlement_authority";

/// Atomically swaps a settlement's delegated stake account for a user-provided
/// undelegated one of equal value. The user's stake is delegated to the
/// settlement's validator and instantly deactivated — leaving it effective-stake
/// zero (so it is immediately claimable as a settlement stake) while remaining a
/// delegated stake of that validator, so the settlement's unclaimed remainder
/// reaps back to the validator's bond at close (ResetStake). The user receives
/// the settlement's original delegated stake.
///
/// Permissionless: anyone willing to provide a matching undelegated stake may
/// swap. Touches no claim accounting (orthogonal to ClaimSettlementV2).
#[event_cpi]
#[derive(Accounts)]
pub struct SwapSettlementStake<'info> {
    /// the config account under which the settlement was created
    pub config: Box<Account<'info, Config>>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.vote_account.as_ref(),
        ],
        bump = bond.bump,
    )]
    pub bond: Box<Account<'info, Bond>>,

    /// CHECK: the validator vote account the swapped stake is delegated to, linked to bond
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
        address = bond.vote_account @ ErrorCode::VoteAccountMismatch,
    )]
    pub vote_account: UncheckedAccount<'info>,

    #[account(
        has_one = bond @ ErrorCode::BondAccountMismatch,
        constraint = settlement.epoch_created_for + config.epochs_to_claim_settlement >= clock.epoch @ ErrorCode::SettlementExpired,
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            settlement.merkle_root.as_ref(),
            settlement.epoch_created_for.to_le_bytes().as_ref(),
        ],
        bump = settlement.bumps.pda,
    )]
    pub settlement: Box<Account<'info, Settlement>>,

    /// CHECK: PDA, the settlement staker authority of the settlement-owned stakes
    #[account(
        seeds = [
            SETTLEMENT_STAKER_AUTHORITY_SEED,
            settlement.key().as_ref(),
        ],
        bump = settlement.bumps.staker_authority,
    )]
    pub settlement_staker_authority: UncheckedAccount<'info>,

    /// CHECK: PDA, the withdrawer authority of all stake accounts under the bonds program
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// the settlement-owned delegated stake account, handed over to the user
    #[account(mut)]
    pub settlement_stake: Box<Account<'info, StakeAccount>>,

    /// the user-provided undelegated stake account, handed over to the settlement
    #[account(
        mut,
        constraint = settlement_stake.key() != user_stake.key() @ ErrorCode::MergeMismatchSameSourceDestination,
    )]
    pub user_stake: Box<Account<'info, StakeAccount>>,

    /// the user that provides `user_stake` and receives `settlement_stake`
    pub user_authority: Signer<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,

    /// CHECK: CPI
    #[account(address = stake_config_id)]
    pub stake_config: UncheckedAccount<'info>,
}

impl SwapSettlementStake<'_> {
    pub fn process(ctx: Context<SwapSettlementStake>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        // settlement_stake is owned by the settlement: withdrawer is the bonds
        // authority and staker is this settlement's staker authority
        let settlement_stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.settlement_stake,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "settlement_stake",
        )?;
        require_keys_eq!(
            settlement_stake_meta.authorized.staker,
            ctx.accounts.settlement_staker_authority.key(),
            ErrorCode::SettlementAuthorityMismatch,
        );
        check_stake_is_not_locked(
            &ctx.accounts.settlement_stake,
            &ctx.accounts.clock,
            "settlement_stake",
        )?;

        // user_stake is fully owned by the user and undelegated (so it can be
        // delegated to the settlement's validator below)
        let user_stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.user_stake,
            &ctx.accounts.user_authority.key(),
            "user_stake",
        )?;
        require_keys_eq!(
            user_stake_meta.authorized.staker,
            ctx.accounts.user_authority.key(),
            ErrorCode::WrongStakeAccountStaker,
        );
        require!(
            get_delegation(&ctx.accounts.user_stake)?.is_none(),
            ErrorCode::SwapStakeAccountDelegated,
        );
        check_stake_is_not_locked(&ctx.accounts.user_stake, &ctx.accounts.clock, "user_stake")?;

        // equal value keeps the settlement whole and the swap fair to the user
        require_eq!(
            ctx.accounts.settlement_stake.get_lamports(),
            ctx.accounts.user_stake.get_lamports(),
            ErrorCode::SwapStakeAccountAmountMismatch,
        );

        // Delegate the user stake to the settlement's validator and immediately
        // deactivate it: effective stake stays 0 (claimable now) while it remains
        // a delegated stake of this validator, so the unclaimed remainder reaps
        // back to the validator's bond at close. Signed by the user (still staker).
        let delegate_instruction = stake::instruction::delegate_stake(
            &ctx.accounts.user_stake.key(),
            &ctx.accounts.user_authority.key(),
            &ctx.accounts.bond.vote_account,
        );
        invoke(
            &delegate_instruction,
            &[
                ctx.accounts.stake_program.to_account_info(),
                ctx.accounts.user_stake.to_account_info(),
                ctx.accounts.user_authority.to_account_info(),
                ctx.accounts.vote_account.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.stake_history.to_account_info(),
                ctx.accounts.stake_config.to_account_info(),
            ],
        )?;
        deactivate_stake(CpiContext::new(
            ctx.accounts.stake_program.to_account_info(),
            DeactivateStake {
                stake: ctx.accounts.user_stake.to_account_info(),
                staker: ctx.accounts.user_authority.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
            },
        ))?;

        // user_stake -> settlement: move staker and withdrawer to the settlement
        // authorities (signed by the user, still the staker/withdrawer)
        authorize(
            CpiContext::new(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.user_stake.to_account_info(),
                    authorized: ctx.accounts.user_authority.to_account_info(),
                    new_authorized: ctx.accounts.settlement_staker_authority.to_account_info(),
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
                    stake: ctx.accounts.user_stake.to_account_info(),
                    authorized: ctx.accounts.user_authority.to_account_info(),
                    new_authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
            ),
            StakeAuthorize::Withdrawer,
            None,
        )?;

        // settlement_stake -> user: move staker (signed by settlement authority)
        // and withdrawer (signed by bonds authority) to the user
        let config_key = ctx.accounts.config.key();
        let settlement_key = ctx.accounts.settlement.key();
        let bonds_authority_seeds: &[&[u8]] = &[
            BONDS_WITHDRAWER_AUTHORITY_SEED,
            config_key.as_ref(),
            &[ctx.accounts.config.bonds_withdrawer_authority_bump],
        ];
        let settlement_authority_seeds: &[&[u8]] = &[
            SETTLEMENT_STAKER_AUTHORITY_SEED,
            settlement_key.as_ref(),
            &[ctx.accounts.settlement.bumps.staker_authority],
        ];
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.settlement_stake.to_account_info(),
                    authorized: ctx.accounts.settlement_staker_authority.to_account_info(),
                    new_authorized: ctx.accounts.user_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[settlement_authority_seeds],
            ),
            StakeAuthorize::Staker,
            None,
        )?;
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.settlement_stake.to_account_info(),
                    authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: ctx.accounts.user_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[bonds_authority_seeds],
            ),
            StakeAuthorize::Withdrawer,
            None,
        )?;

        emit_cpi!(SwapSettlementStakeEvent {
            config: config_key,
            bond: ctx.accounts.bond.key(),
            settlement: settlement_key,
            settlement_stake: ctx.accounts.settlement_stake.key(),
            user_stake: ctx.accounts.user_stake.key(),
            user_authority: ctx.accounts.user_authority.key(),
            amount: ctx.accounts.settlement_stake.get_lamports(),
        });

        Ok(())
    }
}
