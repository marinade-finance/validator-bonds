use crate::constants::MIN_STAKE_LAMPORTS;
use crate::events::config::InitConfigEvent;
use crate::state::config::{find_bonds_withdrawer_authority, Config};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitConfigArgs {
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub epochs_to_claim_settlement: u64,
    pub withdraw_lockup_epochs: u64,
}

/// Creates a new config root account that configures the bonds program
#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// config root account to init
    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<Config>()
    )]
    config: Account<'info, Config>,

    /// rent exempt payer for the config (root) account
    #[account(
        mut,
        owner = system_program::ID
    )]
    rent_payer: Signer<'info>,

    system_program: Program<'info, System>,
}

impl<'info> InitConfig<'info> {
    pub fn process(
        &mut self,
        InitConfigArgs {
            admin_authority,
            operator_authority,
            epochs_to_claim_settlement,
            withdraw_lockup_epochs,
        }: InitConfigArgs,
    ) -> Result<()> {
        let (bonds_withdrawer_authority, bonds_withdrawer_authority_bump) =
            find_bonds_withdrawer_authority(&self.config.key());
        self.config.set_inner(Config {
            admin_authority,
            operator_authority,
            epochs_to_claim_settlement,
            withdraw_lockup_epochs,
            minimum_stake_lamports: MIN_STAKE_LAMPORTS,
            bonds_withdrawer_authority_bump,
            reserved: [0; 512],
        });

        emit!(InitConfigEvent {
            admin_authority: self.config.admin_authority,
            operator_authority: self.config.operator_authority,
            epochs_to_claim_settlement: self.config.epochs_to_claim_settlement,
            withdraw_lockup_epochs: self.config.withdraw_lockup_epochs,
            minimum_stake_lamports: self.config.minimum_stake_lamports,
            bonds_withdrawer_authority_bump: self.config.bonds_withdrawer_authority_bump,
            bonds_withdrawer_authority,
        });

        Ok(())
    }
}
