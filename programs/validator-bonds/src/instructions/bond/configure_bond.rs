use crate::checks::check_bond_authority;
use crate::error::ErrorCode;
use crate::events::{bond::ConfigureBondEvent, PubkeyValueChange, U64ValueChange};
use crate::instructions::verify_max_stake_wanted;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureBondArgs {
    /// New bond authority that can manage the bond account.
    pub bond_authority: Option<Pubkey>,
    /// New `cpmpe` value (cost per mille per epoch).
    /// It defines the bid for the validator to get delegated up to `max_stake_wanted` lamports.
    pub cpmpe: Option<u64>,
    /// New `max_stake_wanted` value that the vote account owner declares
    /// as the maximum delegated stake desired.
    pub max_stake_wanted: Option<u64>,
}

/// Change parameters of validator bond account
#[event_cpi]
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

impl ConfigureBond<'_> {
    pub fn process(
        ctx: Context<ConfigureBond>,
        configure_bond_args: ConfigureBondArgs,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        require!(
            check_bond_authority(
                &ctx.accounts.authority.key(),
                &ctx.accounts.bond,
                &ctx.accounts.vote_account
            ),
            ErrorCode::BondChangeNotPermitted
        );

        let ConfigureBondChanges {
            bond_authority_change,
            cpmpe_change,
            max_stake_wanted_change,
        } = configure_bond(
            &mut ctx.accounts.bond,
            ctx.accounts.config.min_bond_max_stake_wanted,
            configure_bond_args,
        )?;

        emit_cpi!(ConfigureBondEvent {
            bond_authority: bond_authority_change,
            cpmpe: cpmpe_change,
            max_stake_wanted: max_stake_wanted_change,
        });

        Ok(())
    }
}

pub struct ConfigureBondChanges {
    pub bond_authority_change: Option<PubkeyValueChange>,
    pub cpmpe_change: Option<U64ValueChange>,
    pub max_stake_wanted_change: Option<U64ValueChange>,
}

pub(crate) fn configure_bond(
    bond: &mut Bond,
    min_bond_max_stake_wanted: u64,
    configure_args: ConfigureBondArgs,
) -> Result<ConfigureBondChanges> {
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
    let max_stake_wanted_change = configure_args.max_stake_wanted.map(|new_max_stake_wanted| {
        let old = bond.max_stake_wanted;
        bond.max_stake_wanted = new_max_stake_wanted;
        U64ValueChange {
            old,
            new: new_max_stake_wanted,
        }
    });
    verify_max_stake_wanted(bond.max_stake_wanted, min_bond_max_stake_wanted)?;

    Ok(ConfigureBondChanges {
        bond_authority_change,
        cpmpe_change,
        max_stake_wanted_change,
    })
}
