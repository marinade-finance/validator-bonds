use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_valid_delegation,
};
use crate::constants::{BONDS_WITHDRAWER_AUTHORITY_SEED, SETTLEMENT_STAKER_AUTHORITY_SEED};
use crate::error::ErrorCode;
use crate::events::settlement::SwapSettlementStakeEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_lang::solana_program::{
    stake,
    stake::state::{StakeAuthorize, StakeStateV2},
    system_instruction,
};
use anchor_spl::stake::{
    authorize, deactivate_stake, Authorize, DeactivateStake, Stake, StakeAccount,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SwapSettlementStakeArgs {
    /// seed used to derive the new stake account via create_account_with_seed (base == caller)
    pub stake_account_seed: String,
}

/// Replacing an active settlement-funded stake account with an equally sized, immediately inactive one.
/// A funded stake account is active until it deactivates over an epoch boundary; only then can claim_settlement
/// withdraw from it. The caller provides liquid SOL to mint a replacement stake that is delegated and deactivated
/// within the same epoch (activation_epoch == deactivation_epoch => never effective => withdrawable at once),
/// letting claiming start without waiting an epoch. In exchange the caller receives the original active stake account.
/// Permission-less; the swap is value neutral to the settlement (equal lamports, same delegation).
#[event_cpi]
#[derive(Accounts)]
pub struct SwapSettlementStake<'info> {
    pub config: Account<'info, Config>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        has_one = vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref(),
        ],
        bump = bond.bump,
    )]
    pub bond: Box<Account<'info, Bond>>,

    /// CHECK: the validator vote account to which the stake account is delegated, linked to bond
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    #[account(
        has_one = bond @ ErrorCode::BondAccountMismatch,
        constraint = settlement.staker_authority == settlement_staker_authority.key() @ ErrorCode::SettlementAuthorityMismatch,
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            settlement.merkle_root.as_ref(),
            settlement.epoch_created_for.to_le_bytes().as_ref(),
        ],
        bump = settlement.bumps.pda,
    )]
    pub settlement: Box<Account<'info, Settlement>>,

    /// CHECK: PDA
    /// staker authority of stake accounts funded to this settlement
    #[account(
        seeds = [
            b"settlement_authority",
            settlement.key().as_ref(),
        ],
        bump = settlement.bumps.staker_authority,
    )]
    pub settlement_staker_authority: UncheckedAccount<'info>,

    /// CHECK: PDA
    /// authority that manages (owns) all stake accounts under the bonds program
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// the original active stake account funded to the settlement; handed over to the caller
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,

    /// CHECK: created within the instruction via create_account_with_seed (base == caller), validated by the stake program CPIs
    /// the replacement stake account the settlement keeps; delegated and deactivated in the same epoch
    #[account(mut)]
    pub new_stake_account: UncheckedAccount<'info>,

    /// caller funds the replacement stake account and receives the original active one
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
    #[account(address = stake::config::ID)]
    pub stake_config: UncheckedAccount<'info>,
}

impl SwapSettlementStake<'_> {
    pub fn process(
        ctx: Context<SwapSettlementStake>,
        SwapSettlementStakeArgs { stake_account_seed }: SwapSettlementStakeArgs,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        // the original stake account must be funded to THIS settlement and managed by the bonds program
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        require_keys_eq!(
            stake_meta.authorized.staker,
            ctx.accounts.settlement.staker_authority,
            ErrorCode::StakeAccountNotFundedToSettlement,
        );
        let stake_delegation = check_stake_valid_delegation(
            &ctx.accounts.stake_account,
            &ctx.accounts.bond.vote_account,
        )?;
        // Only a stake still deactivating in the current epoch benefits from the swap: one already
        // fully deactivated is claimable as-is, and limiting to this epoch confines any swap churn
        // to the funding epoch (afterwards the funded stake is inactive and can no longer be swapped).
        require!(
            stake_delegation.deactivation_epoch == ctx.accounts.clock.epoch,
            ErrorCode::SwapStakeNotDeactivatedThisEpoch
        );

        // the replacement must carry the same value so the settlement stays funded; enforced by construction
        let lamports = ctx.accounts.stake_account.get_lamports();

        // create_account_with_seed lets the caller be the only signer (base == caller), avoiding a throw-away stake keypair
        invoke(
            &system_instruction::create_account_with_seed(
                &ctx.accounts.caller.key(),
                &ctx.accounts.new_stake_account.key(),
                &ctx.accounts.caller.key(),
                &stake_account_seed,
                lamports,
                std::mem::size_of::<StakeStateV2>() as u64,
                &ctx.accounts.stake_program.key(),
            ),
            &[
                ctx.accounts.caller.to_account_info(),
                ctx.accounts.new_stake_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // the replacement looks exactly like a freshly funded settlement stake: settlement staker, bonds withdrawer
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

        let settlement_staker_authority_seeds: &[&[u8]] = &[
            SETTLEMENT_STAKER_AUTHORITY_SEED,
            ctx.accounts.settlement.to_account_info().key.as_ref(),
            std::slice::from_ref(&ctx.accounts.settlement.bumps.staker_authority),
        ];

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
            &[settlement_staker_authority_seeds],
        )?;

        // deactivating in the same epoch it was delegated keeps the stake fully inactive (effective stake stays 0),
        // so claim_settlement can withdraw from it immediately
        deactivate_stake(CpiContext::new_with_signer(
            ctx.accounts.stake_program.to_account_info(),
            DeactivateStake {
                stake: ctx.accounts.new_stake_account.to_account_info(),
                staker: ctx.accounts.settlement_staker_authority.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
            },
            &[settlement_staker_authority_seeds],
        ))?;

        // hand the original active stake account to the caller (both staker and withdrawer)
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.settlement_staker_authority.to_account_info(),
                    new_authorized: ctx.accounts.caller.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[settlement_staker_authority_seeds],
            ),
            StakeAuthorize::Staker,
            None,
        )?;
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: ctx.accounts.caller.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Withdrawer,
            None,
        )?;

        emit_cpi!(SwapSettlementStakeEvent {
            bond: ctx.accounts.bond.key(),
            settlement: ctx.accounts.settlement.key(),
            vote_account: ctx.accounts.bond.vote_account,
            original_stake_account: ctx.accounts.stake_account.key(),
            new_stake_account: ctx.accounts.new_stake_account.key(),
            caller: ctx.accounts.caller.key(),
            lamports,
            settlement_staker_authority: ctx.accounts.settlement_staker_authority.key(),
            bonds_withdrawer_authority: ctx.accounts.bonds_withdrawer_authority.key(),
        });

        Ok(())
    }
}
