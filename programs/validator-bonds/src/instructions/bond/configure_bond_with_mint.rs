use crate::checks::get_validator_vote_account_validator_identity;
use crate::error::ErrorCode;
use crate::events::bond::ConfigureBondWithMintEvent;
use crate::instructions::{configure_bond, ConfigureBondArgs, ConfigureBondChanges};
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_spl::token::Mint;
use anchor_spl::token::{burn, Burn, Token, TokenAccount};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureBondWithMintArgs {
    /// Validator identity configured within the vote account.
    pub validator_identity: Pubkey,
    /// New bond authority that can manage the bond account.
    pub bond_authority: Option<Pubkey>,
    /// New `cpmpe` value (cost per mille per epoch).
    /// It defines the bid for the validator to get delegated up to `max_stake_wanted` lamports.
    pub cpmpe: Option<u64>,
    /// new max_stake_wanted value that vote account owner declares
    /// as the maximum delegated stake wanted
    pub max_stake_wanted: Option<u64>,
}

/// Change parameters of validator bond account with token burning
#[event_cpi]
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
    pub mint: Box<Account<'info, Mint>>,

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
    pub token_account: Box<Account<'info, TokenAccount>>,

    pub token_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

impl<'info> ConfigureBondWithMint<'info> {
    pub fn process(
        ctx: Context<ConfigureBondWithMint>,
        configure_bond_mint_args: ConfigureBondWithMintArgs,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        let validator_identity_vote_account =
            get_validator_vote_account_validator_identity(&ctx.accounts.vote_account)?;
        require_keys_eq!(
            configure_bond_mint_args.validator_identity,
            validator_identity_vote_account,
            ErrorCode::ValidatorIdentityBondMintMismatch
        );

        let ConfigureBondChanges {
            bond_authority_change,
            cpmpe_change,
            max_stake_wanted_change,
        } = configure_bond(
            &mut ctx.accounts.bond,
            ctx.accounts.config.min_bond_max_stake_wanted,
            ConfigureBondArgs {
                bond_authority: configure_bond_mint_args.bond_authority,
                cpmpe: configure_bond_mint_args.cpmpe,
                max_stake_wanted: configure_bond_mint_args.max_stake_wanted,
            },
        )?;

        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.token_authority.to_account_info(),
                },
            ),
            1,
        )?;

        emit_cpi!(ConfigureBondWithMintEvent {
            validator_identity: configure_bond_mint_args.validator_identity,
            bond_authority: bond_authority_change,
            cpmpe: cpmpe_change,
            max_stake_wanted: max_stake_wanted_change,
        });

        Ok(())
    }
}
