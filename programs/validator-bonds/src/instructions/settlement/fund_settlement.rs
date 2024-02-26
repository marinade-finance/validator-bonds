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
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_program::ID as system_program_id;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::solana_program::{
    stake,
    stake::state::{StakeAuthorize, StakeStateV2},
};
use anchor_spl::stake::{
    authorize, deactivate_stake, Authorize, DeactivateStake, Stake, StakeAccount,
};

/// Funding settlement by providing stake account delegated to particular validator vote account based on the merkle proof.
/// The settlement has been previously created by operator to fulfil some protected event (e.g., slashing)
/// Currently permission-ed.
#[derive(Accounts)]
pub struct FundSettlement<'info> {
    #[account(
        has_one = operator_authority @ ErrorCode::InvalidOperatorAuthority,
    )]
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
    settlement: Account<'info, Settlement>,

    /// operator signer authority is allowed to fund the settlement account
    /// (making this operation permission-ed, at least for the first version of the contract)
    operator_authority: Signer<'info>,

    /// stake account to be funded into the settlement
    #[account(mut)]
    stake_account: Account<'info, StakeAccount>,

    /// CHECK: PDA
    /// settlement stake authority to differentiate deposited and funded stake accounts
    /// deposited has got bonds_withdrawer_authority, whilst funded has got the settlement authority
    #[account(
        seeds = [
            b"settlement_authority",
            settlement.key().as_ref(),
        ],
        bump = settlement.bumps.staker_authority,
    )]
    settlement_staker_authority: UncheckedAccount<'info>,

    /// CHECK: PDA
    /// authority that manages (owns) all stakes account under the bonds program
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// an account that does not exist, it will be initialized as a stake account (the signature needed)
    /// the split_stake_account is needed when the provided stake_account is consists of more lamports
    /// than the amount needed to fund the settlement, the left-over lamports from the stake account is split
    /// into the new split_stake_account; when the split_stake_account is not needed, the rent payer is refunded
    #[account(
        init,
        payer = split_stake_rent_payer,
        space = std::mem::size_of::<StakeStateV2>(),
        owner = stake::program::ID,
    )]
    split_stake_account: Account<'info, StakeAccount>,

    /// rent exempt payer of the split_stake_account creation
    /// if the split_stake_account is not needed (no left-over lamports on funding) then rent payer is refunded
    /// it the split_stake_account is needed to spill out over funding of the settlement
    ///     then the rent payer is refunded when the settlement is closed
    #[account(
        mut,
        owner = system_program_id,
    )]
    split_stake_rent_payer: Signer<'info>,

    system_program: Program<'info, System>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,

    rent: Sysvar<'info, Rent>,

    stake_program: Program<'info, Stake>,
}

impl<'info> FundSettlement<'info> {
    pub fn process(&mut self) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        if self.settlement.lamports_funded >= self.settlement.max_total_claim {
            msg!("Settlement is already fully funded");
            return_unused_split_stake_account_rent(
                &self.stake_program,
                &self.split_stake_account,
                &self.split_stake_rent_payer,
                &self.clock,
                &self.stake_history,
            )?;
            return Ok(());
        }

        // stake account is managed by bonds program
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // provided stake account must NOT have been used to fund settlement (but must be owned by bonds program)
        // funded to bond account -> staker == bonds withdrawer authority, funded to settlement -> staker == settlement staker authority
        require_keys_eq!(
            stake_meta.authorized.staker,
            self.bonds_withdrawer_authority.key(),
            ErrorCode::StakeAccountIsFundedToSettlement,
        );
        // only stake account delegated to (i.e., funded by) the bond validator vote account
        let stake_delegation =
            check_stake_valid_delegation(&self.stake_account, &self.bond.vote_account)?;

        // funded stake account cannot be locked as we want to deactivate&withdraw
        check_stake_is_not_locked(&self.stake_account, &self.clock, "stake_account")?;

        let split_stake_rent_exempt = self.split_stake_account.to_account_info().lamports();
        let stake_account_min_size = minimal_size_stake_account(&stake_meta, &self.config);

        // note: we can over-fund the settlement when the stake account is in shape to not being possible to split it
        let amount_available = self.stake_account.get_lamports();
        // amount needed: "amount + rent exempt + minimal stake size" -> ensuring stake account may exist
        // NOTE: once deactivated the balance may drop only to "rent exempt" and "minimal stake size" is not needed anymore,
        //       but we want to re-activate later the left-over at the stake account thus needed to be funded with plus minimal stake size
        let amount_needed = self.settlement.max_total_claim - self.settlement.lamports_funded
            + stake_account_min_size;
        // the left-over stake account has to be capable to exist after splitting
        let left_over_splittable = amount_available > amount_needed
            && amount_available - amount_needed >= stake_account_min_size + split_stake_rent_exempt;

        let (funding_amount, is_split) =
            // no split needed or possible, whole stake account funded, still amout funded is substracted off the min size
            // as after claiming the stake will be capable to exist
            if amount_available <= amount_needed || !left_over_splittable  {
                let lamports_to_fund = self.stake_account.get_lamports() - stake_account_min_size;

                // whole amount used, not split - closing and returning rent
                return_unused_split_stake_account_rent(
                    &self.stake_program,
                    &self.split_stake_account,
                    &self.split_stake_rent_payer,
                    &self.clock,
                    &self.stake_history,
                )?;
                (lamports_to_fund, false)
            } else {
                let lamports_to_fund = amount_needed - stake_account_min_size;
                // split gains what overflows from funding + amount needed to pay back to split rent payer on close
                let fund_split_leftover =
                    self.stake_account.get_lamports() - amount_needed - split_stake_rent_exempt;

                let split_instruction = stake::instruction::split(
                  self.stake_account.to_account_info().key,
                  self.bonds_withdrawer_authority.key,
                  fund_split_leftover,
                  &self.split_stake_account.key(),
                )
                .last()
                .unwrap()
                .clone();
                invoke_signed(
                    &split_instruction,
                    &[
                        self.stake_program.to_account_info(),
                        self.stake_account.to_account_info(),
                        self.split_stake_account.to_account_info(),
                        self.bonds_withdrawer_authority.to_account_info(),
                    ],
                    &[&[
                        BONDS_WITHDRAWER_AUTHORITY_SEED,
                        &self.config.key().as_ref(),
                        &[self.config.bonds_withdrawer_authority_bump],
                    ]],
                )?;

                // the split rent collector will get back the rent on closing the settlement
                self.settlement.split_rent_collector = Some(self.split_stake_rent_payer.key());
                self.settlement.split_rent_amount = split_stake_rent_exempt;

                (lamports_to_fund, true)
            };

        // deactivating stake to be withdraw-able on claim_settlement instruction
        // NOTE: do not deactivate when already deactivated (deactivated: deactivation_epoch != u64::MAX)
        if stake_delegation.deactivation_epoch == u64::MAX {
            deactivate_stake(CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                DeactivateStake {
                    stake: self.stake_account.to_account_info(),
                    staker: self.bonds_withdrawer_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ))?;
        } else {
            msg!(
                "Stake account {} is already deactivated",
                self.stake_account.key()
            );
        }
        // moving stake account from bond authority to settlement authority to differentiate funded and non-funded stake accounts
        authorize(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: self.settlement_staker_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Staker,
            None,
        )?;

        self.settlement.lamports_funded += funding_amount;

        emit!(FundSettlementEvent {
            bond: self.bond.key(),
            vote_account: self.bond.vote_account,
            settlement: self.settlement.key(),
            funding_amount,
            lamports_funded: self.settlement.lamports_funded,
            lamports_claimed: self.settlement.lamports_claimed,
            merkle_nodes_claimed: self.settlement.merkle_nodes_claimed,
            stake_account: self.stake_account.key(),
            split_stake_account: if is_split {
                Some(SplitStakeData {
                    address: self.split_stake_account.key(),
                    amount: self.split_stake_account.get_lamports(),
                })
            } else {
                None
            },
            split_rent_collector: self.settlement.split_rent_collector,
            split_rent_amount: self.settlement.split_rent_amount,
        });

        Ok(())
    }
}
