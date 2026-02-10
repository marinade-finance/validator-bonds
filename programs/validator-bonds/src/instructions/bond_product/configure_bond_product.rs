use crate::checks::check_bond_authority;
use crate::error::ErrorCode;
use crate::events::bond_product::ConfigureBondProductEvent;
use crate::state::bond::Bond;
use crate::state::bond_product::{
    BondProduct, ProductType, ProductTypeConfig, ValidateProductTypeConfig,
};
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureBondProductArgs {
    pub config_data: ProductTypeConfig,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ConfigureBondProduct<'info> {
    pub config: Account<'info, Config>,

    #[account(
        has_one = vote_account @ ErrorCode::VoteAccountMismatch,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref(),
        ],
        bump = bond.bump,
    )]
    pub bond: Account<'info, Bond>,

    /// CHECK: check&deserialize the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = bond @ ErrorCode::BondAccountMismatch,
        seeds = [
            b"bond_product",
            bond.key().as_ref(),
            bond_product.product_type.to_seed(),
        ],
        bump = bond_product.bump,
    )]
    pub bond_product: Account<'info, BondProduct>,

    /// validator vote account validator identity or bond authority may change the account
    pub authority: Signer<'info>,
}

impl ConfigureBondProduct<'_> {
    pub fn process(
        ctx: Context<ConfigureBondProduct>,
        args: ConfigureBondProductArgs,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        require!(
            check_bond_authority(
                &ctx.accounts.authority.key(),
                &ctx.accounts.bond,
                &ctx.accounts.vote_account
            ),
            ErrorCode::BondProductSetupNotPermitted
        );

        let bond_product = &mut ctx.accounts.bond_product;

        validate_product_config_match(&bond_product.product_type, &args.config_data)?;
        args.config_data.validate()?;

        let old_config_data = bond_product.config_data.clone();

        bond_product.config_data = args.config_data.clone();

        emit_cpi!(ConfigureBondProductEvent {
            config: ctx.accounts.config.key(),
            bond_product: bond_product.key(),
            bond: bond_product.bond,
            vote_account: bond_product.vote_account,
            product_type: bond_product.product_type.clone(),
            old_config_data,
            new_config_data: args.config_data,
        });

        Ok(())
    }
}

fn validate_product_config_match(
    product_type: &ProductType,
    config_data: &ProductTypeConfig,
) -> Result<()> {
    match (product_type, config_data) {
        (ProductType::Commission, ProductTypeConfig::Commission(_)) => Ok(()),
        (ProductType::Custom(_), ProductTypeConfig::Custom(_)) => Ok(()),
        _ => Err(error!(ErrorCode::BondProductTypeMismatch)
            .with_values(("product_type", format!("{product_type:?}")))
            .with_values(("config_data", format!("{config_data:?}")))),
    }
}
