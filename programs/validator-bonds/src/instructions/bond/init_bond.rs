use crate::checks::{
    check_validator_vote_account_validator_identity, get_validator_vote_account_validator_identity,
};
use crate::error::ErrorCode;
use crate::events::bond::InitBondEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::Reserved150;
use crate::utils::basis_points::HundredthBasisPoint;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_lang::solana_program::vote::program::ID as vote_program_id;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitBondArgs {
    pub bond_authority: Pubkey,
    pub revenue_share: HundredthBasisPoint,
}

/// Creates new validator bond account based on the validator vote address
#[derive(Accounts)]
pub struct InitBond<'info> {
    /// the config root account under which the bond is created
    #[account()]
    config: Account<'info, Config>,

    /// CHECK: deserialization of the vote account in the code
    #[account(
        owner = vote_program_id @ ErrorCode::InvalidVoteAccountProgramId,
    )]
    validator_vote_account: UncheckedAccount<'info>,

    /// when validator identity signs the instruction then configuration arguments are applied
    /// otherwise it's a permission-less operation that uses default init bond setup
    #[account()]
    validator_identity: Option<Signer<'info>>,

    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<Bond>(),
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            validator_vote_account.key().as_ref()
        ],
        bump,
    )]
    bond: Account<'info, Bond>,

    /// rent exempt payer of validator bond account creation
    #[account(
        mut,
        owner = system_program::ID
    )]
    rent_payer: Signer<'info>,

    system_program: Program<'info, System>,
}

impl<'info> InitBond<'info> {
    pub fn process(
        &mut self,
        InitBondArgs {
            bond_authority,
            revenue_share,
        }: InitBondArgs,
        bond_bump: u8,
    ) -> Result<()> {
        let mut revenue_share = revenue_share;
        let mut bond_authority = bond_authority;
        let validator_identity = if let Some(validator_identity_info) = &self.validator_identity {
            // permission-ed: verification of validator identity as a signer, config of bond account possible
            check_validator_vote_account_validator_identity(
                &self.validator_vote_account,
                &validator_identity_info.key(),
            )?;
            validator_identity_info.key()
        } else {
            // permission-less: not possible to configure bond account
            revenue_share = HundredthBasisPoint { hundredth_bps: 0 };
            let validator_identity =
                get_validator_vote_account_validator_identity(&self.validator_vote_account)?;
            bond_authority = validator_identity;
            validator_identity
        };

        self.bond.set_inner(Bond {
            config: self.config.key(),
            validator_vote_account: self.validator_vote_account.key(),
            authority: bond_authority,
            revenue_share: revenue_share.check()?,
            bump: bond_bump,
            reserved: Reserved150::default(),
        });
        emit!(InitBondEvent {
            config_address: self.bond.config,
            validator_vote_account: self.bond.validator_vote_account,
            validator_identity,
            authority: self.bond.authority,
            revenue_share: self.bond.revenue_share,
            bond_bump: self.bond.bump,
        });

        Ok(())
    }
}
