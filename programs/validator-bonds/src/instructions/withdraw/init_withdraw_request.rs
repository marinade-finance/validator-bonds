use crate::checks::check_bond_authority;
use crate::error::ErrorCode;
use crate::events::withdraw::InitWithdrawRequestEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::withdraw_request::WithdrawRequest;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program::ID as system_program_id;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitWithdrawRequestArgs {
    pub amount: u64,
}

/// Creates a withdrawal request of bond funds for a validator vote account
#[derive(Accounts)]
pub struct InitWithdrawRequest<'info> {
    /// the config root account under which the bond was created
    pub config: Account<'info, Config>,

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
    pub bond: Account<'info, Bond>,

    /// CHECK: check&deserialize of the validator vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    /// validator vote account node identity or bond authority may ask for the withdrawal
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<WithdrawRequest>(),
        seeds = [
            b"withdraw_account",
            bond.key().as_ref(),
        ],
        bump,
    )]
    pub withdraw_request: Account<'info, WithdrawRequest>,

    /// rent exempt payer of withdraw request account creation
    #[account(
        mut,
        owner = system_program_id
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,

    pub clock: Sysvar<'info, Clock>,
}

impl<'info> InitWithdrawRequest<'info> {
    pub fn process(
        &mut self,
        InitWithdrawRequestArgs { amount }: InitWithdrawRequestArgs,
        withdraw_request_bump: u8,
    ) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        require!(
            check_bond_authority(&self.authority.key(), &self.bond, &self.vote_account),
            ErrorCode::InvalidWithdrawRequestAuthority
        );

        self.withdraw_request.set_inner(WithdrawRequest {
            bond: self.bond.key(),
            vote_account: self.bond.vote_account.key(),
            bump: withdraw_request_bump,
            epoch: self.clock.epoch,
            withdrawn_amount: 0,
            requested_amount: amount,
            reserved: [0; 93],
        });
        emit!(InitWithdrawRequestEvent {
            withdraw_request: self.withdraw_request.key(),
            bond: self.withdraw_request.bond.key(),
            vote_account: self.withdraw_request.vote_account.key(),
            requested_amount: self.withdraw_request.requested_amount,
            epoch: self.withdraw_request.epoch,
        });

        Ok(())
    }
}
