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
    metadata::{
        create_metadata_accounts_v3,
        mpl_token_metadata::types::{Creator, DataV2},
        CreateMetadataAccountsV3, Metadata,
    },
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

    /// CHECK: New metadata account to be possibly created
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// rent exempt payer of account creation
    #[account(
        mut,
        owner = system_program_id,
    )]
    rent_payer: Signer<'info>,

    system_program: Program<'info, System>,

    token_program: Program<'info, Token>,

    associated_token_program: Program<'info, AssociatedToken>,

    metadata_program: Program<'info, Metadata>,

    rent: Sysvar<'info, Rent>,
}

impl<'info> MintBond<'info> {
    pub fn process(&mut self, mint_bond_bump: u8) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        if self.mint.supply != 0 {
            return Err(error!(ErrorCode::InvalidBondMintSupply)
                .with_values(("mint_supply", self.mint.supply)));
        }

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

        let bond_pubkey = self.bond.key();
        let mint_signer_seeds = &[BOND_MINT_SEED, &bond_pubkey.as_ref(), &[mint_bond_bump]];
        let mint_signer = [&mint_signer_seeds[..]];
        mint_to(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                MintTo {
                    authority: self.mint.to_account_info(),
                    to: self.destination_token_account.to_account_info(),
                    mint: self.mint.to_account_info(),
                },
                &mint_signer,
            ),
            1,
        )?;

        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                self.metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    mint: self.mint.to_account_info(),
                    update_authority: self.mint.to_account_info(),
                    mint_authority: self.mint.to_account_info(),
                    payer: self.rent_payer.to_account_info(),
                    metadata: self.metadata.to_account_info(),
                    system_program: self.system_program.to_account_info(),
                    rent: self.rent.to_account_info(),
                },
                &mint_signer,
            ),
            DataV2 {
                name: "Validator Bonds".to_string(),
                symbol: "VBOND".to_string(),
                uri: "https://github.com/marinade-finance/validator-bonds".to_string(),
                seller_fee_basis_points: 0,
                creators: Some(vec![Creator {
                    address: self.bond.key(),
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

        emit!(MintBondEvent {
            bond: self.bond.key(),
            destination_token_account: self.destination_token_account.key(),
            destination_authority: self.destination_authority.key(),
            token_metadata: self.metadata.key(),
        });

        Ok(())
    }
}
