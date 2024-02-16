use crate::checks::check_bond_change_permitted;
use crate::error::ErrorCode;
use crate::events::{bond::ConfigureBondEvent, PubkeyValueChange, U64ValueChange};
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureBondArgs {
    pub bond_authority: Option<Pubkey>,
    pub cpmpe: Option<u64>,
}

/// Change parameters of validator bond account
#[derive(Accounts)]
pub struct ConfigureBond<'info> {
    config: Account<'info, Config>,

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
    bond: Account<'info, Bond>,

    /// validator vote account validator identity or bond authority may change the account
    #[account()]
    authority: Signer<'info>,

    /// CHECK: check&deserialize the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    vote_account: UncheckedAccount<'info>,
}

impl<'info> ConfigureBond<'info> {
    pub fn process(
        &mut self,
        ConfigureBondArgs {
            bond_authority,
            cpmpe,
        }: ConfigureBondArgs,
    ) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        require!(
            check_bond_change_permitted(&self.authority.key(), &self.bond, &self.vote_account),
            ErrorCode::BondChangeNotPermitted
        );

        let bond_authority_change = bond_authority.map(|authority| {
            let old = self.bond.authority;
            self.bond.authority = authority;
            PubkeyValueChange {
                old,
                new: authority,
            }
        });
        let cpmpe_change = match cpmpe {
            Some(new_cpmpe) => {
                let old = self.bond.cpmpe;
                self.bond.cpmpe = new_cpmpe;
                Some(U64ValueChange {
                    old,
                    new: new_cpmpe,
                })
            }
            None => None,
        };

        emit!(ConfigureBondEvent {
            bond_authority: bond_authority_change,
            cpmpe: cpmpe_change,
        });

        Ok(())
    }
}
