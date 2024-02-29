use crate::checks::check_bond_authority;
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

    /// validator vote account validator identity or bond authority may change the account
    pub authority: Signer<'info>,

    /// CHECK: check&deserialize the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,
}

impl<'info> ConfigureBond<'info> {
    pub fn process(&mut self, configure_bond_args: ConfigureBondArgs) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        require!(
            check_bond_authority(&self.authority.key(), &self.bond, &self.vote_account),
            ErrorCode::BondChangeNotPermitted
        );

        let (bond_authority_change, cpmpe_change) =
            configure_bond(&mut self.bond, configure_bond_args);

        emit!(ConfigureBondEvent {
            bond_authority: bond_authority_change,
            cpmpe: cpmpe_change,
        });

        Ok(())
    }
}

pub(crate) fn configure_bond(
    bond: &mut Bond,
    configure_args: ConfigureBondArgs,
) -> (Option<PubkeyValueChange>, Option<U64ValueChange>) {
    let bond_authority_change = configure_args.bond_authority.map(|authority| {
        let old = bond.authority;
        bond.authority = authority;
        PubkeyValueChange {
            old,
            new: authority,
        }
    });
    let cpmpe_change = configure_args.cpmpe.map(|new_cpmpe| {
        let old = bond.cpmpe;
        bond.cpmpe = new_cpmpe;
        U64ValueChange {
            old,
            new: new_cpmpe,
        }
    });
    (bond_authority_change, cpmpe_change)
}
