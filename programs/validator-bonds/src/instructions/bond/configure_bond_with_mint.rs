use crate::error::ErrorCode;
use crate::events::bond::ConfigureBondEvent;
use crate::instructions::{configure_bond, ConfigureBondArgs};
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use anchor_spl::token::{burn, Burn, Token, TokenAccount};

/// Change parameters of validator bond account with token burn
#[derive(Accounts)]
pub struct ConfigureBondWithMint<'info> {
    config: Account<'info, Config>,

    #[account(
        mut,
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.vote_account.key().as_ref(),
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    #[account(
        mut,
        seeds = [
            b"bond_mint",
            bond.key().as_ref(),
        ],
        bump,
        mint::authority = mint,
    )]
    mint: Account<'info, Mint>,

    /// token account to burn bond mint configuration tokens from
    #[account(
        mut,
        token::mint = mint,
        token::authority = token_authority,
    )]
    token_account: Account<'info, TokenAccount>,

    token_authority: Signer<'info>,

    token_program: Program<'info, Token>,
}

impl<'info> ConfigureBondWithMint<'info> {
    pub fn process(&mut self, configure_bond_args: ConfigureBondArgs) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        let (bond_authority_change, cpmpe_change) =
            configure_bond(&mut self.bond, configure_bond_args);

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

        emit!(ConfigureBondEvent {
            bond_authority: bond_authority_change,
            cpmpe: cpmpe_change,
        });

        Ok(())
    }
}
