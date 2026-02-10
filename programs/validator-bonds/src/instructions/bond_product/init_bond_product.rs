use crate::checks::check_bond_authority;
use crate::error::ErrorCode;
use crate::events::bond_product::InitBondProductEvent;
use crate::state::bond::Bond;
use crate::state::bond_product::{
    BondProduct, ProductType, ProductTypeConfig, ValidateProductTypeConfig,
};
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitBondProductArgs {
    pub product_type: ProductType,
    pub config_data: ProductTypeConfig,
}

/// Creates new bond product account
#[event_cpi]
#[derive(Accounts)]
#[instruction(args: InitBondProductArgs)]
pub struct InitBondProduct<'info> {
    /// The config account that the bond belongs to
    pub config: Account<'info, Config>,

    #[account(
        mut,
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

    /// The bond product account being created
    #[account(
        init,
        payer = rent_payer,
        space = calculate_space(&args.product_type, &args.config_data),
        seeds = [
            b"bond_product",
            bond.key().as_ref(),
            args.product_type.to_seed(),
        ],
        bump,
    )]
    pub bond_product: Account<'info, BondProduct>,

    /// permission-ed: the validator identity or bond authority signs the instruction, InitBondProductArgs applied
    /// permission-less: no signature, default configuration for the bond product
    pub authority: Option<Signer<'info>>,

    /// Rent payer for the bond product account creation
    #[account(
        mut,
        owner = system_program.key()
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl InitBondProduct<'_> {
    pub fn process(ctx: Context<InitBondProduct>, args: InitBondProductArgs) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        let bond_product = &mut ctx.accounts.bond_product;
        bond_product.config = ctx.accounts.config.key();
        bond_product.vote_account = ctx.accounts.vote_account.key();
        bond_product.bond = ctx.accounts.bond.key();
        bond_product.product_type = args.product_type.clone();
        bond_product.bump = ctx.bumps.bond_product;

        let authority = if let Some(authority) = &ctx.accounts.authority {
            // permission-ed: authority is signer, configuration is possible
            require!(
                check_bond_authority(
                    &authority.key(),
                    &ctx.accounts.bond,
                    &ctx.accounts.vote_account
                ),
                ErrorCode::BondProductSetupNotPermitted
            );
            bond_product.config_data = args.config_data.clone();
            Some(authority.key())
        } else {
            // permission-less: no signature, default config
            bond_product.config_data = ProductTypeConfig::default_by_type(&args.product_type)?;
            None
        };

        args.config_data.validate()?;

        emit_cpi!(InitBondProductEvent {
            bond_product: bond_product.key(),
            config: ctx.accounts.config.key(),
            bond: bond_product.bond,
            vote_account: bond_product.vote_account,
            product_type: bond_product.product_type.clone(),
            authority,
        });

        Ok(())
    }
}

fn calculate_space(product_type: &ProductType, config_data: &ProductTypeConfig) -> usize {
    // Validate they match
    let valid = matches!(
        (product_type, config_data),
        (ProductType::Commission, ProductTypeConfig::Commission(_))
            | (ProductType::Custom(_), ProductTypeConfig::Custom(_))
    );

    if !valid {
        panic!("Product type {product_type:?} and config data {config_data:?} mismatch");
    }

    BondProduct::calculate_space(product_type, config_data)
}
