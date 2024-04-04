use crate::checks::get_validator_vote_account_validator_identity;
use crate::constants::BOND_MINT_SEED;
use crate::error::ErrorCode;
use crate::events::bond::MintBondEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;

use anchor_lang::solana_program::vote::program::ID as vote_program_id;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        create_metadata_accounts_v3,
        mpl_token_metadata::types::{Creator, DataV2},
        CreateMetadataAccountsV3, Metadata,
    },
    token::{mint_to, Mint, MintTo, Token, TokenAccount},
};

/// Minting a bond SPL token that can be used for configuring the bond account.
// see configure_mint_bond.rs
#[event_cpi]
#[derive(Accounts)]
pub struct MintBond<'info> {
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
    pub bond: Account<'info, Bond>,

    #[account(
        init_if_needed,
        seeds = [
            b"bond_mint",
            bond.key().as_ref(),
            validator_identity.key().as_ref(),
        ],
        bump,
        payer = rent_payer,
        mint::decimals = 0,
        mint::authority = mint,
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: verified to be associated with the vote account in the code
    pub validator_identity: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = rent_payer,
        associated_token::mint = mint,
        associated_token::authority = validator_identity,
    )]
    pub validator_identity_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: check&deserialize the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    /// CHECK: new token metadata to be possibly created
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// rent exempt payer of account creation
    #[account(
        mut,
        owner = system_program.key(),
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub metadata_program: Program<'info, Metadata>,

    pub rent: Sysvar<'info, Rent>,
}

impl<'info> MintBond<'info> {
    pub fn process(ctx: Context<MintBond>) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        let validator_identity_vote_account =
            get_validator_vote_account_validator_identity(&ctx.accounts.vote_account)?;
        require_keys_eq!(
            ctx.accounts.validator_identity.key(),
            validator_identity_vote_account,
            ErrorCode::ValidatorIdentityBondMintMismatch
        );

        let bond_pubkey = ctx.accounts.bond.key();
        let mint_signer_seeds = &[
            BOND_MINT_SEED,
            &bond_pubkey.as_ref(),
            &validator_identity_vote_account.as_ref(),
            &[ctx.bumps.mint],
        ];
        let mint_signer = [&mint_signer_seeds[..]];
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    authority: ctx.accounts.mint.to_account_info(),
                    to: ctx
                        .accounts
                        .validator_identity_token_account
                        .to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                &mint_signer,
            ),
            1,
        )?;

        if ctx.accounts.metadata.get_lamports() == 0 {
            create_metadata_accounts_v3(
                CpiContext::new_with_signer(
                    ctx.accounts.metadata_program.to_account_info(),
                    CreateMetadataAccountsV3 {
                        mint: ctx.accounts.mint.to_account_info(),
                        update_authority: ctx.accounts.mint.to_account_info(),
                        mint_authority: ctx.accounts.mint.to_account_info(),
                        payer: ctx.accounts.rent_payer.to_account_info(),
                        metadata: ctx.accounts.metadata.to_account_info(),
                        system_program: ctx.accounts.system_program.to_account_info(),
                        rent: ctx.accounts.rent.to_account_info(),
                    },
                    &mint_signer,
                ),
                DataV2 {
                    name: "Validator Bonds".to_string(),
                    symbol: "VBOND".to_string(),
                    uri: "https://github.com/marinade-finance/validator-bonds".to_string(),
                    seller_fee_basis_points: 0,
                    creators: Some(vec![Creator {
                        address: ctx.accounts.bond.key(),
                        verified: false,
                        share: 100,
                    }]),
                    collection: None,
                    uses: None,
                },
                false,
                true,
                None,
            )?;
        }

        emit_cpi!(MintBondEvent {
            bond: ctx.accounts.bond.key(),
            validator_identity_token_account: ctx.accounts.validator_identity_token_account.key(),
            validator_identity: ctx.accounts.validator_identity.key(),
            token_metadata: ctx.accounts.metadata.key(),
        });

        Ok(())
    }
}
