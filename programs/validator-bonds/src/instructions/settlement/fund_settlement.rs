use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_is_not_locked,
    check_stake_valid_delegation,
};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::settlement::FundSettlementEvent;
use crate::events::SplitStakeData;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use crate::utils::{minimal_size_stake_account, return_unused_split_stake_account_rent};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_lang::solana_program::{
    stake,
    stake::state::{StakeAuthorize, StakeStateV2},
};
use anchor_spl::stake::{
    authorize, deactivate_stake, withdraw, Authorize, DeactivateStake, Stake, StakeAccount,
    Withdraw,
};

/// Funding the settlement by providing a stake account delegated to a particular validator vote account based on the Merkle proof.
/// The settlement has been previously created by the operator to fulfill some protected event (e.g., slashing).
/// Permission-ed to operator authority.
#[event_cpi]
#[derive(Accounts)]
pub struct FundSettlement<'info> {
    #[account(
        has_one = operator_authority @ ErrorCode::InvalidOperatorAuthority,
    )]
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
        mut,
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

    /// operator signer authority is allowed to fund the settlement account
    pub operator_authority: Signer<'info>,

    /// stake account to be funded into the settlement
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,

    /// CHECK: PDA
    /// the settlement stake authority differentiates between deposited and funded stake accounts
    /// deposited accounts have the bonds_withdrawer_authority, while funded accounts have the settlement_staker_authority
    #[account(
        seeds = [
            b"settlement_authority",
            settlement.key().as_ref(),
        ],
        bump = settlement.bumps.staker_authority,
    )]
    pub settlement_staker_authority: UncheckedAccount<'info>,

    /// CHECK: PDA
    /// authority that manages (owns) all stakes account under the bonds program
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// if an account that does not exist is provided, it will be initialized as a stake account (with the necessary signature)
    /// the split_stake_account is required when the provided stake_account contains more lamports than necessary to fund the settlement
    /// in this case, the excess lamports from the stake account are split into the new split_stake_account,
    /// if the split_stake_account is not needed, the rent payer is refunded back within tx
    #[account(
        init,
        payer = split_stake_rent_payer,
        space = std::mem::size_of::<StakeStateV2>(),
        owner = stake_program.key(),
    )]
    pub split_stake_account: Account<'info, StakeAccount>,

    /// the rent exempt payer of the split_stake_account creation
    /// if the split_stake_account is not needed (no leftover lamports on funding), then the rent payer is refunded
    /// if the split_stake_account is needed to spill out over funding of the settlement,
    ///     then the rent payer is refunded when the settlement is closed
    #[account(
        mut,
        owner = system_program.key(),
    )]
    pub split_stake_rent_payer: Signer<'info>,

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

impl<'info> FundSettlement<'info> {
    pub fn process(ctx: Context<FundSettlement>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        if ctx.accounts.settlement.lamports_funded >= ctx.accounts.settlement.max_total_claim {
            msg!("Settlement is already fully funded");
            return_unused_split_stake_account_rent(
                &ctx.accounts.stake_program,
                &ctx.accounts.split_stake_account,
                &ctx.accounts.split_stake_rent_payer,
                &ctx.accounts.clock,
                &ctx.accounts.stake_history,
            )?;
            return Ok(());
        }

        // stake account is managed by bonds program
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // the provided stake account must NOT have been used to fund settlement (but must be owned by the bonds program)
        // when funded to the bond account, the staker must be equal to the bonds withdrawer authority
        // when funded to the settlement, the staker must be equal to the settlement staker authority
        require_keys_eq!(
            stake_meta.authorized.staker,
            ctx.accounts.bonds_withdrawer_authority.key(),
            ErrorCode::StakeAccountIsFundedToSettlement,
        );
        // only stake account delegated to (i.e., funded by) the bond validator vote account
        let stake_delegation = check_stake_valid_delegation(
            &ctx.accounts.stake_account,
            &ctx.accounts.bond.vote_account,
        )?;
        // funded stake account cannot be locked as we want to deactivate&withdraw
        check_stake_is_not_locked(
            &ctx.accounts.stake_account,
            &ctx.accounts.clock,
            "stake_account",
        )?;

        let split_stake_rent_exempt = ctx.accounts.split_stake_account.get_lamports();
        let stake_account_min_size = minimal_size_stake_account(&stake_meta, &ctx.accounts.config);

        // note: we can over-fund the settlement when the stake account is in shape to not being possible to split it
        let amount_available = ctx.accounts.stake_account.get_lamports();
        // amount needed: "amount + rent exempt + minimal stake size" -> ensuring stake account may exist
        // NOTE: once deactivated the balance may drop only to "rent exempt" and "minimal stake size" is not needed anymore,
        //       but we want to re-activate later the left-over at the stake account thus needed to be funded with plus minimal stake size
        let amount_needed = ctx.accounts.settlement.max_total_claim
            - ctx.accounts.settlement.lamports_funded
            + stake_account_min_size;
        // the left-over stake account has to be capable to exist after splitting
        let left_over_splittable = amount_available > amount_needed
            && amount_available - amount_needed >= stake_account_min_size + split_stake_rent_exempt;

        let (funding_amount, is_split) =
            // -> no split needed or possible, whole stake account funded, still amount funded is subtracted off the min size
            // as after claiming the stake will be capable to exist
            if amount_available <= amount_needed || !left_over_splittable  {
                let lamports_to_fund = ctx.accounts.stake_account.get_lamports() - stake_account_min_size;

                // whole amount used, no splitting - closing and returning rent
                return_unused_split_stake_account_rent(
                    &ctx.accounts.stake_program,
                    &ctx.accounts.split_stake_account,
                    &ctx.accounts.split_stake_rent_payer,
                    &ctx.accounts.clock,
                    &ctx.accounts.stake_history,
                )?;
                (lamports_to_fund, false)
            } else {
                // -> to fund only part of the lamports available in the stake account
                //    'stake_account' is funded to settlement, the overflow is moved into 'split_stake_account'

                // stake_account gains:
                // --  amount_needed
                // --    "+" what is needed to be paid back to split rent payer on close
                // split_stake_account gains (i.e., fund_split_leftover):
                // -- what overflows from funding:
                // --  lamports available (delegated and non-delegated)
                // --    "-" amount needed
                // --    "-" what is needed to be paid back to split rent payer on close
                let mut fund_split_leftover =
                    ctx.accounts.stake_account.get_lamports() - amount_needed - split_stake_rent_exempt;

                // For the 'stake_account' to stay in the "delegated" state, a minimum stake must remain delegated.
                // A portion of the undelegated lamports may need to be moved to the split account before splitting.
                // See: https://github.com/anza-xyz/agave/blob/v2.0.9/programs/stake/src/stake_state.rs#L504
                let lamports_non_delegated = ctx.accounts.stake_account.get_lamports() -  stake_delegation.stake;
                let lamports_max_possible_non_delegated = ctx.accounts.settlement.max_total_claim
                    - ctx.accounts.settlement.lamports_funded + stake_meta.rent_exempt_reserve;

                if lamports_non_delegated > lamports_max_possible_non_delegated {
                    let mut lamports_to_transfer = lamports_non_delegated - lamports_max_possible_non_delegated;
                    if fund_split_leftover >= lamports_to_transfer {
                        // to be split; something is withdrawn directly and some part is moved by split ix
                        fund_split_leftover -= lamports_to_transfer;
                    } else {
                        // nothing to be split; all is withdrawn directly, to withdraw:
                        //   (to pay the funding + minimal size of stake account + rent == amount_needed) + returning rent for the split
                        fund_split_leftover = 0;
                        lamports_to_transfer = ctx.accounts.stake_account.get_lamports() - amount_needed - split_stake_rent_exempt;
                    }
                    msg!(
                        "Withdraw non-delegated: {} to split stake {}; fund_split_leftover: {}",
                        lamports_to_transfer,
                        ctx.accounts.split_stake_account.key(),
                        fund_split_leftover
                    );
                    withdraw(
                        CpiContext::new_with_signer(
                            ctx.accounts.stake_program.to_account_info(),
                            Withdraw {
                                stake: ctx.accounts.stake_account.to_account_info(),
                                withdrawer: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                                to: ctx.accounts.split_stake_account.to_account_info(),
                                stake_history: ctx.accounts.stake_history.to_account_info(),
                                clock: ctx.accounts.clock.to_account_info(),
                            },
                            &[&[
                                BONDS_WITHDRAWER_AUTHORITY_SEED,
                                &ctx.accounts.config.key().as_ref(),
                                &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                            ]],
                        ),
                        lamports_to_transfer,
                        None,
                    )?;
                }

                if fund_split_leftover > 0 {
                    // Sufficient delegated lamports are available for splitting.
                    msg!(
                        "Splitting to stake account {} with lamports {}",
                        ctx.accounts.split_stake_account.key(),
                        fund_split_leftover
                    );
                    let split_instruction = stake::instruction::split(
                        ctx.accounts.stake_account.to_account_info().key,
                        ctx.accounts.bonds_withdrawer_authority.key,
                        fund_split_leftover,
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
                            ctx.accounts.split_stake_account.to_account_info(),
                            ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                        ],
                        &[&[
                            BONDS_WITHDRAWER_AUTHORITY_SEED,
                            &ctx.accounts.config.key().as_ref(),
                            &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                        ]],
                    )?;
                } else {
                    // Insufficient delegated lamports for splitting.
                    //   Initializing and delegating the split_stake_account instead.
                    msg!(
                        "Delegating stake account {} to vote account {} with lamports {}",
                        ctx.accounts.split_stake_account.key(),
                        ctx.accounts.bond.vote_account.key(),
                        ctx.accounts.split_stake_account.get_lamports()
                    );
                    let initialize_instruction = stake::instruction::initialize(
                        ctx.accounts.split_stake_account.to_account_info().key,
                        &stake::state::Authorized {
                            staker: ctx.accounts.bonds_withdrawer_authority.key(),
                            withdrawer: ctx.accounts.bonds_withdrawer_authority.key(),
                        },
                        &stake::state::Lockup::default(),
                    );
                    invoke(
                        &initialize_instruction,
                        &[
                            ctx.accounts.stake_program.to_account_info(),
                            ctx.accounts.split_stake_account.to_account_info(),
                            ctx.accounts.rent.to_account_info(),
                        ],
                    )?;
                    let delegate_instruction = &stake::instruction::delegate_stake(
                        &ctx.accounts.split_stake_account.key(),
                        &ctx.accounts.bonds_withdrawer_authority.key(),
                        &ctx.accounts.bond.vote_account,
                    );
                        invoke_signed(
                        delegate_instruction,
                        &[
                            ctx.accounts.stake_program.to_account_info(),
                            ctx.accounts.split_stake_account.to_account_info(),
                            ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                            ctx.accounts.vote_account.to_account_info(),
                            ctx.accounts.clock.to_account_info(),
                            ctx.accounts.stake_history.to_account_info(),
                            ctx.accounts.stake_config.to_account_info(),
                        ],
                        &[&[
                            BONDS_WITHDRAWER_AUTHORITY_SEED,
                            &ctx.accounts.config.key().as_ref(),
                            &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                        ]],
                    )?;
                }

                // the split rent collector will get back the rent on closing the settlement
                ctx.accounts.settlement.split_rent_collector = Some(ctx.accounts.split_stake_rent_payer.key());
                ctx.accounts.settlement.split_rent_amount = split_stake_rent_exempt;

                let lamports_to_fund = amount_needed - stake_account_min_size;
                (lamports_to_fund, true)
            };

        // deactivating stake to be withdraw-able on claim_settlement instruction
        // NOTE: do not deactivate when already deactivated (deactivated: deactivation_epoch != u64::MAX)
        if stake_delegation.deactivation_epoch == u64::MAX {
            deactivate_stake(CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                DeactivateStake {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    staker: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ))?;
        } else {
            msg!(
                "Stake account {} is already deactivated",
                ctx.accounts.stake_account.key()
            );
        }
        // funding, i.e., moving stake account from bond authority to settlement authority
        authorize(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Authorize {
                    stake: ctx.accounts.stake_account.to_account_info(),
                    authorized: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: ctx.accounts.settlement_staker_authority.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Staker,
            None,
        )?;

        ctx.accounts.settlement.lamports_funded += funding_amount;

        msg!(
            "Funded {} lamports to settlement {} of epoch {}",
            funding_amount,
            ctx.accounts.settlement.key(),
            ctx.accounts.settlement.epoch_created_for
        );
        emit_cpi!(FundSettlementEvent {
            bond: ctx.accounts.bond.key(),
            settlement: ctx.accounts.settlement.key(),
            settlement_epoch: ctx.accounts.settlement.epoch_created_for,
            funding_amount,
            stake_account: ctx.accounts.stake_account.key(),
            lamports_funded: ctx.accounts.settlement.lamports_funded,
            lamports_claimed: ctx.accounts.settlement.lamports_claimed,
            merkle_nodes_claimed: ctx.accounts.settlement.merkle_nodes_claimed,
            split_stake_account: if is_split {
                Some(SplitStakeData {
                    address: ctx.accounts.split_stake_account.key(),
                    amount: ctx.accounts.split_stake_account.get_lamports(),
                })
            } else {
                None
            },
            split_rent_collector: ctx.accounts.settlement.split_rent_collector,
            split_rent_amount: ctx.accounts.settlement.split_rent_amount,
        });

        Ok(())
    }
}
