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
}

/// Creates new validator bond account based on the validator vote address
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
        &mut self,
        InitBondArgs {
            bond_authority,
            cpmpe,
        }: InitBondArgs,
        bond_bump: u8,
    ) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        let mut cpmpe = cpmpe;
        let mut bond_authority = bond_authority;
        let validator_identity = if let Some(validator_identity_info) = &self.validator_identity {
            // permission-ed: validator identity is signer, configuration is possible
            check_vote_account_validator_identity(
                &self.vote_account,
                &validator_identity_info.key(),
            )?;
            validator_identity_info.key()
        } else {
            // permission-less: not possible to configure bond account
            cpmpe = 0;
            let validator_identity =
                get_validator_vote_account_validator_identity(&self.vote_account)?;
            bond_authority = validator_identity;
            validator_identity
        };

        self.bond.set_inner(Bond {
            config: self.config.key(),
            vote_account: self.vote_account.key(),
            authority: bond_authority,
            cpmpe,
            bump: bond_bump,
            reserved: [0; 142],
        });
        emit!(InitBondEvent {
            bond: self.bond.key(),
            config: self.bond.config,
            vote_account: self.bond.vote_account,
            validator_identity,
            authority: self.bond.authority,
            cpmpe: self.bond.cpmpe,
        });

        Ok(())
    }
}
