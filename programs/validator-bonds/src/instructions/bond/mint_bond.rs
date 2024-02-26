use crate::checks::{
    get_validator_vote_account_authorized_withdrawer, get_validator_vote_account_validator_identity,
};
use crate::constants::BOND_MINT_SEED;
use crate::error::ErrorCode;
use crate::events::bond::MintBondEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program::ID as system_program_id;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{mint_to, Mint, MintTo, Token, TokenAccount},
};

/// Minting bond SPL token that can be used for configuring the bond account (see configure_mint_bond.rs)
#[derive(Accounts)]
pub struct MintBond<'info> {
    config: Account<'info, Config>,

    #[account(
        mut,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref(),
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    #[account(
        init_if_needed,
        seeds = [
            b"bond_mint",
            bond.key().as_ref(),
        ],
        bump,
        payer = rent_payer,
        mint::decimals = 0,
        mint::authority = mint,
    )]
    mint: Account<'info, Mint>,

    /// CHECK: authority is checked to be related to the vote account in the code
    destination_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = rent_payer,
        associated_token::mint = mint,
        associated_token::authority = destination_authority,
    )]
    destination_token_account: Account<'info, TokenAccount>,

    /// CHECK: check&deserialize the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    vote_account: UncheckedAccount<'info>,

    /// rent exempt payer of account creation
    #[account(
        mut,
        owner = system_program_id,
    )]
    rent_payer: Signer<'info>,

    system_program: Program<'info, System>,

    token_program: Program<'info, Token>,

    associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> MintBond<'info> {
    pub fn process(&mut self, mint_bond_bump: u8) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        let validator_identity = get_validator_vote_account_validator_identity(&self.vote_account)?;
        let authorized_withdrawer =
            get_validator_vote_account_authorized_withdrawer(&self.vote_account)?;
        if self.destination_authority.key() != validator_identity
            && self.destination_authority.key() != authorized_withdrawer
        {
            return Err(
                error!(ErrorCode::InvalidBondMintToDestination).with_values((
                    "destination_authority/validator_identity/authorized_withdrawer",
                    format!(
                        "{}/{}/{}",
                        self.destination_authority.key(),
                        validator_identity,
                        authorized_withdrawer
                    ),
                )),
            );
        }

        mint_to(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                MintTo {
                    authority: self.mint.to_account_info(),
                    to: self.destination_token_account.to_account_info(),
                    mint: self.mint.to_account_info(),
                },
                &[&[BOND_MINT_SEED, &self.bond.key().as_ref(), &[mint_bond_bump]]],
            ),
            1,
        )?;

        emit!(MintBondEvent {
            bond: self.bond.key(),
            destination_token_account: self.destination_token_account.key(),
            destination_authority: self.destination_authority.key(),
            rent_payer: *self.rent_payer.key,
        });

        Ok(())
    }
}
