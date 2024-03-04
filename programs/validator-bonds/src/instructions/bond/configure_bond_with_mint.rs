use crate::checks::get_validator_vote_account_validator_identity;
use crate::error::ErrorCode;
use crate::events::bond::ConfigureBondWithMintEvent;
use crate::instructions::{configure_bond, ConfigureBondArgs};
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_spl::token::Mint;
use anchor_spl::token::{burn, Burn, Token, TokenAccount};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureBondWithMintArgs {
    /// new bond authority
    pub bond_authority: Option<Pubkey>,
    /// new cpmpe value
    pub cpmpe: Option<u64>,
    /// validator identity configured within the vote account
    pub validator_identity: Pubkey,
}

/// Change parameters of validator bond account with token burning
#[derive(Accounts)]
#[instruction(params: ConfigureBondWithMintArgs)]
pub struct ConfigureBondWithMint<'info> {
    pub config: Account<'info, Config>,

    #[account(
        mut,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        has_one = vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref(),
        ],
        bump = bond.bump,
    )]
    pub bond: Account<'info, Bond>,

    #[account(
        mut,
        seeds = [
            b"bond_mint",
            bond.key().as_ref(),
            params.validator_identity.as_ref(),
        ],
        bump,
        mint::authority = mint,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: check&deserialize the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    /// token account to burn bond mint configuration tokens from
    #[account(
        mut,
        token::mint = mint,
        token::authority = token_authority,
    )]
    pub token_account: Account<'info, TokenAccount>,

    pub token_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

impl<'info> ConfigureBondWithMint<'info> {
    pub fn process(&mut self, args: ConfigureBondWithMintArgs) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        let validator_identity_vote_account =
            get_validator_vote_account_validator_identity(&self.vote_account)?;
        require_keys_eq!(
            args.validator_identity,
            validator_identity_vote_account,
            ErrorCode::ValidatorIdentityBondMintMismatch
        );

        let (bond_authority_change, cpmpe_change) = configure_bond(
            &mut self.bond,
            ConfigureBondArgs {
                bond_authority: args.bond_authority,
                cpmpe: args.cpmpe,
            },
        );

        burn(
            CpiContext::new(
                self.token_program.to_account_info(),
                Burn {
                    mint: self.mint.to_account_info(),
                    from: self.token_account.to_account_info(),
                    authority: self.token_authority.to_account_info(),
                },
            ),
            1,
        )?;

        emit!(ConfigureBondWithMintEvent {
            validator_identity: args.validator_identity,
            bond_authority: bond_authority_change,
            cpmpe: cpmpe_change,
        });

        Ok(())
    }
}
