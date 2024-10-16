use crate::checks::{
    check_vote_account_validator_identity, get_validator_vote_account_validator_identity,
};
use crate::error::ErrorCode;
use crate::events::bond::InitBondEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitBondArgs {
    pub bond_authority: Pubkey,
    pub cpmpe: u64,
    pub max_stake_wanted: u64,
}

/// Creates new validator bond account based on the validator vote address
#[event_cpi]
#[derive(Accounts)]
pub struct InitBond<'info> {
    /// the config account under which the bond is created
    pub config: Account<'info, Config>,

    /// CHECK: deserialization of the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    pub vote_account: UncheckedAccount<'info>,

    /// permission-ed: the validator identity signs the instruction, InitBondArgs applied
    /// permission-less: no signature, default init bond configuration
    pub validator_identity: Option<Signer<'info>>,

    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<Bond>(),
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            vote_account.key().as_ref()
        ],
        bump,
    )]
    pub bond: Account<'info, Bond>,

    /// rent exempt payer of validator bond account creation
    #[account(
        mut,
        owner = system_program.key()
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitBond<'info> {
    pub fn process(
        ctx: Context<InitBond>,
        InitBondArgs {
            bond_authority,
            cpmpe,
            max_stake_wanted,
        }: InitBondArgs,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        let mut cpmpe = cpmpe;
        let mut bond_authority = bond_authority;
        let mut max_stake_wanted = max_stake_wanted;
        let validator_identity =
            if let Some(validator_identity_info) = &ctx.accounts.validator_identity {
                // permission-ed: validator identity is signer, configuration is possible
                check_vote_account_validator_identity(
                    &ctx.accounts.vote_account,
                    &validator_identity_info.key(),
                )?;
                verify_max_stake_wanted(
                    max_stake_wanted,
                    ctx.accounts.config.min_bond_max_stake_wanted,
                )?;
                validator_identity_info.key()
            } else {
                // permission-less: not possible to configure bond account
                cpmpe = 0;
                max_stake_wanted = 0;
                let validator_identity =
                    get_validator_vote_account_validator_identity(&ctx.accounts.vote_account)?;
                bond_authority = validator_identity;
                validator_identity
            };

        ctx.accounts.bond.set_inner(Bond {
            config: ctx.accounts.config.key(),
            vote_account: ctx.accounts.vote_account.key(),
            authority: bond_authority,
            cpmpe,
            max_stake_wanted,
            bump: ctx.bumps.bond,
            reserved: [0; 134],
        });
        emit_cpi!(InitBondEvent {
            bond: ctx.accounts.bond.key(),
            config: ctx.accounts.bond.config,
            vote_account: ctx.accounts.bond.vote_account,
            validator_identity,
            authority: ctx.accounts.bond.authority,
            cpmpe: ctx.accounts.bond.cpmpe,
            max_stake_wanted: ctx.accounts.bond.max_stake_wanted,
        });

        Ok(())
    }
}

pub fn verify_max_stake_wanted(
    max_stake_wanted: u64,
    min_bond_max_stake_wanted: u64,
) -> Result<()> {
    // considering the max stake wanted as "unset" when it is 0
    // when it is set, it must be greater than the minimum
    if max_stake_wanted != 0_u64 {
        require_gte!(
            max_stake_wanted,
            min_bond_max_stake_wanted,
            ErrorCode::MaxStakeWantedTooLow
        );
    }
    Ok(())
}
