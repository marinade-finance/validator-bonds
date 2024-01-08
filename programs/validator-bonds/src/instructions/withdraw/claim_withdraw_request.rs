use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_valid_delegation,
    check_validator_vote_account_validator_identity,
};
use crate::constants::BONDS_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::withdraw::ClaimWithdrawRequestEvent;
use crate::events::{SplitStakeData, U64ValueChange};
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::withdraw_request::WithdrawRequest;
use crate::utils::{minimal_size_stake_account, return_unused_split_stake_account_rent};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::stake::state::{StakeAuthorize, StakeState};
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::solana_program::{program::invoke_signed, stake, system_program};
use anchor_spl::stake::{authorize, Authorize, Stake, StakeAccount};

/// Withdrawing funds from a bond account, to proceed the withdraw one must create a withdraw request first.
/// Withdrawal takes StakeAccount that associated with bonds program and changes owner back to validator vote withdrawer.
#[derive(Accounts)]
pub struct ClaimWithdrawRequest<'info> {
    /// the config root configuration account
    #[account()]
    config: Account<'info, Config>,

    #[account(
        mut,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        has_one = validator_vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            validator_vote_account.key().as_ref()
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    /// CHECK: deserialization of the vote account in the code
    #[account()]
    validator_vote_account: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = validator_vote_account @ ErrorCode::WithdrawRequestVoteAccountMismatch,
        has_one = bond @ ErrorCode::BondAccountMismatch,
        constraint = withdraw_request.epoch + config.withdraw_lockup_epochs < clock.epoch @ ErrorCode::WithdrawRequestNotReady,
        seeds = [
            b"withdraw_account",
            bond.key().as_ref(),
        ],
        bump = withdraw_request.bump
    )]
    withdraw_request: Account<'info, WithdrawRequest>,

    /// CHECK: PDA
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// stake account to be used to withdraw the funds
    /// this stake account has to be delegated to the validator vote account associated to the bond
    #[account(mut)]
    stake_account: Account<'info, StakeAccount>,

    /// CHECK: this has to match with validator vote account validator identity.
    /// This is the account that will be the new owner (withdrawer authority) of the stake account
    /// and ultimately it receives the withdrawing funds
    #[account(mut)]
    withdrawer: UncheckedAccount<'info>,

    /// this is a whatever address that does not exist
    /// when withdrawing needs to split the provided account this will be used as a new stake account
    #[account(
        init,
        payer = split_stake_rent_payer,
        space = std::mem::size_of::<StakeState>(),
        owner = stake::program::ID,
    )]
    split_stake_account: Account<'info, StakeAccount>,

    /// when the split_stake_account is created the rent for creation is taken from here
    /// when the split_stake_account is not created then no rent is payed
    #[account(
        mut,
        owner = system_program::ID
    )]
    split_stake_rent_payer: Signer<'info>,

    stake_program: Program<'info, Stake>,

    system_program: Program<'info, System>,

    /// CHECK: stake history address, no parsing not eating CPU cycles
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,
}

impl<'info> ClaimWithdrawRequest<'info> {
    pub fn process(&mut self) -> Result<()> {
        // vote account validator identity matches the authority where the funds will be withdrawn to
        // i.e., this address will be the new owner (withdrawer authority) of the stake account
        check_validator_vote_account_validator_identity(
            &self.validator_vote_account,
            &self.withdrawer.key(),
        )?;

        // stake account is delegated to the validator vote account associated with the bond
        let stake_delegation =
            check_stake_valid_delegation(&self.stake_account, &self.bond.validator_vote_account)?;

        // stake account belongs under the bonds program
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // stake account is not funded
        require_keys_eq!(
            stake_meta.authorized.staker,
            self.bonds_withdrawer_authority.key(),
            ErrorCode::StakeAccountAlreadyFunded,
        );

        // the amount that has not yet been withdrawn from the request
        let amount_to_fulfill_withdraw = self
            .withdraw_request
            .requested_amount
            .saturating_sub(self.withdraw_request.withdrawn_amount);

        // when the stake account is bigger to the non withdrawn amount of the withdrawal request
        // we need to split the stake account to parts and withdraw only the non withdrawn amount
        let (withdrawing_amount, is_split) = if self.stake_account.get_lamports()
            > amount_to_fulfill_withdraw
        {
            // ensuring that splitting means stake accounts will be big enough
            // note: the rent exempt of the newly created split account has been already paid by the tx caller
            let minimal_stake_size = minimal_size_stake_account(&stake_meta, &self.config);
            if self.stake_account.get_lamports() - amount_to_fulfill_withdraw < minimal_stake_size
                || amount_to_fulfill_withdraw < minimal_stake_size
            {
                return Err(error!(ErrorCode::StakeAccountNotBigEnoughToSplit)
                    .with_account_name("stake_account")
                    .with_values(("stake_account_lamports - amount_to_fulfill_withdraw < minimal_stake_size || amount_to_fulfill_withdraw < minimal_stake_size",
                                  format!("{} - {} < {} || {} < {}",
                                          self.stake_account.get_lamports(),
                                          amount_to_fulfill_withdraw,
                                          minimal_stake_size,
                                          amount_to_fulfill_withdraw,
                                          minimal_stake_size,
                                  ))));
            }

            let withdraw_split_leftover =
                self.stake_account.get_lamports() - amount_to_fulfill_withdraw;
            let split_instruction = stake::instruction::split(
                &self.stake_account.key(),
                self.bonds_withdrawer_authority.key,
                withdraw_split_leftover,
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
                    self.bonds_withdrawer_authority.to_account_info(),
                    self.split_stake_account.to_account_info(),
                ],
                &[&[
                    BONDS_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            )?;
            // the amount  is enough to fulfil the missing part of the withdrawal request
            (amount_to_fulfill_withdraw, true)
        } else {
            return_unused_split_stake_account_rent(
                &self.stake_program,
                &self.split_stake_account,
                &self.split_stake_rent_payer,
                &self.clock,
                &self.stake_history,
            )?;
            // withdrawal amount is full stake account
            (stake_delegation.stake, false)
        };

        let old_withdrawn_amount = self.withdraw_request.withdrawn_amount;
        self.withdraw_request.withdrawn_amount = self
            .withdraw_request
            .withdrawn_amount
            .saturating_add(withdrawing_amount);

        // changing owner of the stake account to entity defined in this ix (via withdraw request)
        authorize(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: self.withdrawer.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
                &[&[
                    BONDS_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            // withdrawer authority (owner) is now the withdrawer authority defined by ix
            StakeAuthorize::Staker,
            None,
        )?;
        authorize(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Authorize {
                    stake: self.stake_account.to_account_info(),
                    authorized: self.bonds_withdrawer_authority.to_account_info(),
                    new_authorized: self.withdrawer.to_account_info(),
                    clock: self.clock.to_account_info(),
                },
                &[&[
                    BONDS_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            StakeAuthorize::Withdrawer,
            None,
        )?;

        emit!(ClaimWithdrawRequestEvent {
            bond: self.bond.key(),
            validator_vote_account: self.validator_vote_account.key(),
            withdraw_request: self.withdraw_request.key(),
            stake_account: self.stake_account.key(),
            split_stake: if is_split {
                Some(SplitStakeData {
                    address: self.split_stake_account.key(),
                    amount: self.split_stake_account.get_lamports(),
                })
            } else {
                None
            },
            new_stake_account_owner: self.withdrawer.key(),
            withdrawing_amount,
            withdrawn_amount: U64ValueChange {
                old: old_withdrawn_amount,
                new: self.withdraw_request.withdrawn_amount,
            },
        });
        msg!(
            "stake account {} claimed to {} with amount {}",
            self.stake_account.key(),
            self.withdrawer.key(),
            withdrawing_amount
        );

        Ok(())
    }
}
