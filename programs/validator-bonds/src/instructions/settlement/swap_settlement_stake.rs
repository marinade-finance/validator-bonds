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
use anchor_lang::solana_program::stake::state::{StakeAuthorize, StakeStateV2};
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_lang::solana_program::{
    stake, stake::config::ID as stake_config_id, system_instruction,
};
use anchor_spl::stake::{
    authorize, deactivate_stake, Authorize, DeactivateStake, Stake, StakeAccount,
};

const SETTLEMENT_STAKER_AUTHORITY_SEED: &[u8] = b"settlement_authority";

/// Atomically swaps a settlement's delegated stake account for a freshly created
/// one of equal value that is immediately claimable. The caller provides liquid
/// SOL; the instruction creates the replacement stake (create_account_with_seed,
/// base == caller), delegates it to the settlement's validator and instantly
/// deactivates it — leaving it effective-stake zero (claimable now as a settlement
/// stake) while remaining a delegated stake of that validator, so the settlement's
/// unclaimed remainder reaps back to the validator's bond at close (ResetStake).
/// The caller receives the settlement's original delegated stake.
///
/// Permission-less: only the caller signs. The swap is value neutral to the
/// settlement (equal lamports, same delegation) and touches no claim accounting
/// (orthogonal to ClaimSettlementV2).
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

    /// the settlement-owned delegated stake account, handed over to the caller
    #[account(mut)]
    pub settlement_stake: Box<Account<'info, StakeAccount>>,

    /// CHECK: created within the instruction via create_account_with_seed (base == caller), validated by the stake program CPIs
    /// the replacement stake account the settlement keeps; delegated and deactivated in the same epoch
    #[account(mut)]
    pub new_stake_account: UncheckedAccount<'info>,

    /// the caller funds `new_stake_account` from their own SOL and receives `settlement_stake`
    #[account(mut, owner = system_program.key())]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub rent: Sysvar<'info, Rent>,

    pub stake_program: Program<'info, Stake>,

    /// CHECK: CPI
    #[account(address = stake_config_id)]
    pub stake_config: UncheckedAccount<'info>,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SwapSettlementStakeArgs {
    /// seed used to derive the new stake account via create_account_with_seed (base == caller)
    pub stake_account_seed: String,
}

impl SwapSettlementStake<'_> {
    pub fn process(
        ctx: Context<SwapSettlementStake>,
        SwapSettlementStakeArgs { stake_account_seed }: SwapSettlementStakeArgs,
    ) -> Result<()> {
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

        // Only a stake that has NOT finished deactivating may be swapped: one already
        // fully deactivated is claimable as-is, so swapping it adds nothing and would
        // only let a permission-less caller churn the settlement's funded account. The
        // replacement created below deactivates this epoch, so it too is frozen from
        // further swaps next epoch — confining any churn to the deactivation epoch.
        let deactivation_epoch = get_delegation(&ctx.accounts.settlement_stake)?
            .map_or(0, |delegation| delegation.deactivation_epoch);
        require!(
            deactivation_epoch >= ctx.accounts.clock.epoch,
            ErrorCode::SwapStakeAlreadyDeactivated,
        );

        // the replacement carries the same value, keeping the settlement whole; the
        // caller funds exactly this amount when the account is created below
        let amount = ctx.accounts.settlement_stake.get_lamports();

        // create_account_with_seed lets the caller be the only signer (base == caller), avoiding a throw-away stake keypair
        invoke(
            &system_instruction::create_account_with_seed(
                &ctx.accounts.caller.key(),
                &ctx.accounts.new_stake_account.key(),
                &ctx.accounts.caller.key(),
                &stake_account_seed,
                amount,
                std::mem::size_of::<StakeStateV2>() as u64,
                &ctx.accounts.stake_program.key(),
            ),
            &[
                ctx.accounts.caller.to_account_info(),
                ctx.accounts.new_stake_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // the replacement looks exactly like a funded settlement stake: settlement staker, bonds withdrawer
        let initialize_instruction = stake::instruction::initialize(
            ctx.accounts.new_stake_account.key,
            &stake::state::Authorized {
                staker: ctx.accounts.settlement_staker_authority.key(),
                withdrawer: ctx.accounts.bonds_withdrawer_authority.key(),
            },
            &stake::state::Lockup::default(),
        );
        invoke(
            &initialize_instruction,
            &[
                ctx.accounts.stake_program.to_account_info(),
                ctx.accounts.new_stake_account.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        let config_key = ctx.accounts.config.key();
        let settlement_key = ctx.accounts.settlement.key();
        let settlement_authority_seeds: &[&[u8]] = &[
            SETTLEMENT_STAKER_AUTHORITY_SEED,
            settlement_key.as_ref(),
            &[ctx.accounts.settlement.bumps.staker_authority],
        ];
        let bonds_authority_seeds: &[&[u8]] = &[
            BONDS_WITHDRAWER_AUTHORITY_SEED,
            config_key.as_ref(),
            &[ctx.accounts.config.bonds_withdrawer_authority_bump],
        ];

        // Delegate the new stake to the settlement's validator and immediately
        // deactivate it: effective stake stays 0 (claimable now) while it remains a
        // delegated stake of this validator, so the unclaimed remainder reaps back to
        // the validator's bond at close. Signed by the settlement staker authority.
        let delegate_instruction = stake::instruction::delegate_stake(
            &ctx.accounts.new_stake_account.key(),
            &ctx.accounts.settlement_staker_authority.key(),
            &ctx.accounts.bond.vote_account,
        );
        invoke_signed(
            &delegate_instruction,
            &[
                ctx.accounts.stake_program.to_account_info(),
                ctx.accounts.new_stake_account.to_account_info(),
                ctx.accounts.settlement_staker_authority.to_account_info(),
                ctx.accounts.vote_account.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.stake_history.to_account_info(),
                ctx.accounts.stake_config.to_account_info(),
            ],
            &[settlement_authority_seeds],
        )?;
        deactivate_stake(CpiContext::new_with_signer(
            ctx.accounts.stake_program.to_account_info(),
            DeactivateStake {
                stake: ctx.accounts.new_stake_account.to_account_info(),
                staker: ctx.accounts.settlement_staker_authority.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
            },
            &[settlement_authority_seeds],
        ))?;

        // settlement_stake -> caller: move staker (signed by settlement authority)
        // and withdrawer (signed by bonds authority) to the caller
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.settlement_stake.to_account_info(),
                    authorized: ctx.accounts.settlement_staker_authority.to_account_info(),
                    new_authorized: ctx.accounts.caller.to_account_info(),
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
                    new_authorized: ctx.accounts.caller.to_account_info(),
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
            new_stake_account: ctx.accounts.new_stake_account.key(),
            caller: ctx.accounts.caller.key(),
            amount,
        });

        Ok(())
    }
}
