use crate::checks::check_bond_change_permitted;
use crate::error::ErrorCode;
use crate::events::withdraw::CreateWithdrawRequestEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::withdraw_request::WithdrawRequest;
use crate::state::Reserved150;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitWithdrawRequestArgs {
    pub amount: u64,
}

/// Creates a withdraw request of bond funds for a validator vote account
#[derive(Accounts)]
pub struct InitWithdrawRequest<'info> {
    /// the config root account under which the bond was created
    #[account()]
    config: Account<'info, Config>,

    #[account(
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

    /// CHECK: check&deserialize of the vote account in the code
    #[account()]
    validator_vote_account: UncheckedAccount<'info>,

    /// validator vote account node identity or bond authority may ask for the withdrawal
    #[account()]
    authority: Signer<'info>,

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
    withdraw_request: Account<'info, WithdrawRequest>,

    /// rent exempt payer of withdraw request account creation
    #[account(
        mut,
        owner = system_program::ID
    )]
    rent_payer: Signer<'info>,

    system_program: Program<'info, System>,

    clock: Sysvar<'info, Clock>,
}

impl<'info> InitWithdrawRequest<'info> {
    pub fn process(
        &mut self,
        InitWithdrawRequestArgs { amount }: InitWithdrawRequestArgs,
        withdraw_request_bump: u8,
    ) -> Result<()> {
        require!(
            check_bond_change_permitted(
                &self.authority.key(),
                &self.bond,
                &self.validator_vote_account
            ),
            ErrorCode::InvalidWithdrawRequestAuthority
        );

        self.withdraw_request.set_inner(WithdrawRequest {
            bond: self.bond.key(),
            validator_vote_account: self.bond.validator_vote_account.key(),
            bump: withdraw_request_bump,
            epoch: self.clock.epoch,
            withdrawn_amount: 0,
            requested_amount: amount,
            reserved: Reserved150::default(),
        });
        emit!(CreateWithdrawRequestEvent {
            withdraw_request: self.withdraw_request.key(),
            bond: self.withdraw_request.bond.key(),
            validator_vote_account: self.withdraw_request.validator_vote_account.key(),
            bump: self.withdraw_request.bump,
            requested_amount: self.withdraw_request.requested_amount,
            epoch: self.withdraw_request.epoch,
        });

        Ok(())
    }
}
