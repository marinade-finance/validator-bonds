use crate::checks::{
    check_bond_authority, check_stake_is_initialized_with_withdrawer_authority,
    check_stake_valid_delegation,
};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::withdraw::ClaimWithdrawRequestEvent;
use crate::events::{SplitStakeData, U64ValueChange};
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::withdraw_request::WithdrawRequest;
use crate::utils::{minimal_size_stake_account, return_unused_split_stake_account_rent};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::stake::state::{StakeAuthorize, StakeStateV2};
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_lang::solana_program::{program::invoke_signed, stake};
use anchor_spl::stake::{authorize, Authorize, Stake, StakeAccount};

/// Withdrawing funds from a bond account requires creating a withdrawal request first.
/// The withdrawal process involves taking a StakeAccount associated with the bonds program
/// and changing its owner (withdrawer and staker authorities) back to the validator vote withdrawer.
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimWithdrawRequest<'info> {
    /// the config root configuration account
    config: Box<Account<'info, Config>>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        has_one = vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref()
        ],
        bump = bond.bump,
    )]
    pub bond: Box<Account<'info, Bond>>,

    /// CHECK: deserialization of the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    /// validator vote account node identity or bond authority may claim
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = vote_account @ ErrorCode::WithdrawRequestVoteAccountMismatch,
        has_one = bond @ ErrorCode::BondAccountMismatch,
        constraint = withdraw_request.epoch + config.withdraw_lockup_epochs < clock.epoch @ ErrorCode::WithdrawRequestNotReady,
        seeds = [
            b"withdraw_account",
            bond.key().as_ref(),
        ],
        bump = withdraw_request.bump
    )]
    pub withdraw_request: Box<Account<'info, WithdrawRequest>>,

    /// CHECK: PDA
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// stake account to be used to withdraw the funds
    /// this stake account has to be delegated to the validator vote account associated to the bond
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,

    /// CHECK: whatever address, authority signature states his intention to withdraw the funds
    /// New owner of the stake account, it will be accounted to the withdrawer authority
    pub withdrawer: UncheckedAccount<'info>,

    /// this is a whatever address that does not exist
    /// when withdrawing needs to split the provided account this will be used as a new stake account
    #[account(
        init,
        payer = split_stake_rent_payer,
        space = std::mem::size_of::<StakeStateV2>(),
        owner = stake_program.key(),
    )]
    pub split_stake_account: Account<'info, StakeAccount>,

    /// when the split_stake_account is created the rent for creation is taken from here
    /// when the split_stake_account is not created then no rent is paid
    #[account(
        mut,
        owner = system_program.key()
    )]
    pub split_stake_rent_payer: Signer<'info>,

    pub stake_program: Program<'info, Stake>,

    pub system_program: Program<'info, System>,

    pub stake_history: Sysvar<'info, StakeHistory>,

    pub clock: Sysvar<'info, Clock>,
}

impl<'info> ClaimWithdrawRequest<'info> {
    pub fn process(ctx: Context<ClaimWithdrawRequest>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        require_gt!(
            ctx.accounts
                .withdraw_request
                .requested_amount
                .saturating_sub(ctx.accounts.withdraw_request.withdrawn_amount),
            0,
            ErrorCode::WithdrawRequestAlreadyFulfilled,
        );

        // claim is permission-ed as the init withdraw request
        require!(
            check_bond_authority(
                &ctx.accounts.authority.key(),
                &ctx.accounts.bond,
                &ctx.accounts.vote_account
            ),
            ErrorCode::InvalidWithdrawRequestAuthority
        );

        // stake account is delegated to the validator vote account associated with the bond
        check_stake_valid_delegation(&ctx.accounts.stake_account, &ctx.accounts.bond.vote_account)?;

        // stake account belongs under the bonds program
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // stake account is NOT funded to settlement
        require_keys_eq!(
            stake_meta.authorized.staker,
            ctx.accounts.bonds_withdrawer_authority.key(),
            ErrorCode::StakeAccountIsFundedToSettlement,
        );

        // the amount that has not yet been withdrawn from the request
        let amount_to_fulfill_withdraw = ctx
            .accounts
            .withdraw_request
            .requested_amount
            .saturating_sub(ctx.accounts.withdraw_request.withdrawn_amount);

        // when the stake account is bigger to the non-withdrawn amount of the withdrawal request
        // we need to split the stake account to parts and withdraw only the non-withdrawn amount
        let (withdrawing_amount, is_split) = if ctx.accounts.stake_account.get_lamports()
            > amount_to_fulfill_withdraw
        {
            // ensuring that splitting means stake accounts will be big enough
            // note: the rent exempt of the newly created split account has been already paid by the tx caller
            let minimal_stake_size = minimal_size_stake_account(&stake_meta, &ctx.accounts.config);
            if ctx.accounts.stake_account.get_lamports() - amount_to_fulfill_withdraw
                < minimal_stake_size
            {
                return Err(error!(ErrorCode::StakeAccountNotBigEnoughToSplit)
                    .with_account_name("stake_account")
                    .with_values((
                        "stake_account_lamports - amount_to_fulfill_withdraw < minimal_stake_size",
                        format!(
                            "{} - {} < {}",
                            ctx.accounts.stake_account.get_lamports(),
                            amount_to_fulfill_withdraw,
                            minimal_stake_size,
                        ),
                    )));
            }
            if amount_to_fulfill_withdraw < minimal_stake_size {
                return Err(error!(ErrorCode::WithdrawRequestAmountTooSmall)
                    .with_account_name("stake_account")
                    .with_values((
                        "amount_to_fulfill_withdraw < minimal_stake_size",
                        format!("{} < {}", amount_to_fulfill_withdraw, minimal_stake_size,),
                    )));
            }

            let withdraw_split_leftover =
                ctx.accounts.stake_account.get_lamports() - amount_to_fulfill_withdraw;
            let split_instruction = stake::instruction::split(
                &ctx.accounts.stake_account.key(),
                ctx.accounts.bonds_withdrawer_authority.key,
                withdraw_split_leftover,
                &ctx.accounts.split_stake_account.key(),
            )
            .last()
            .unwrap()
            .clone();
            invoke_signed(
                &split_instruction,
                &[
                    ctx.accounts.stake_program.to_account_info(),
                    ctx.accounts.stake_account.to_account_info(),
                    ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    ctx.accounts.split_stake_account.to_account_info(),
                ],
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            )?;
            // the amount  is enough to fulfil the missing part of the withdrawal request
            (amount_to_fulfill_withdraw, true)
        } else {
            return_unused_split_stake_account_rent(
                &ctx.accounts.stake_program,
                &ctx.accounts.split_stake_account,
                &ctx.accounts.split_stake_rent_payer,
                &ctx.accounts.clock,
                &ctx.accounts.stake_history.to_account_info(),
            )?;
            // withdrawal amount is full stake account
            (ctx.accounts.stake_account.get_lamports(), false)
        };

        let old_withdrawn_amount = ctx.accounts.withdraw_request.withdrawn_amount;
        ctx.accounts.withdraw_request.withdrawn_amount = ctx
            .accounts
            .withdraw_request
            .withdrawn_amount
            .saturating_add(withdrawing_amount);

        // changing owner of the stake account to entity defined in this ix (via withdraw request)
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: ctx.accounts.withdrawer.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            // withdrawer authority (owner) is now the withdrawer authority defined by ix
            StakeAuthorize::Staker,
            None,
        )?;
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: ctx.accounts.withdrawer.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Withdrawer,
            None,
        )?;

        emit_cpi!(ClaimWithdrawRequestEvent {
            bond: ctx.accounts.bond.key(),
            vote_account: ctx.accounts.vote_account.key(),
            withdraw_request: ctx.accounts.withdraw_request.key(),
            stake_account: ctx.accounts.stake_account.key(),
            split_stake: if is_split {
                Some(SplitStakeData {
                    address: ctx.accounts.split_stake_account.key(),
                    amount: ctx.accounts.split_stake_account.get_lamports(),
                })
            } else {
                None
            },
            new_stake_account_owner: ctx.accounts.withdrawer.key(),
            withdrawing_amount,
            withdrawn_amount: U64ValueChange {
                old: old_withdrawn_amount,
                new: ctx.accounts.withdraw_request.withdrawn_amount,
            },
        });
        msg!(
            "stake account {} claimed to {} with amount {}",
            ctx.accounts.stake_account.key(),
            ctx.accounts.withdrawer.key(),
            withdrawing_amount
        );

        Ok(())
    }
}
