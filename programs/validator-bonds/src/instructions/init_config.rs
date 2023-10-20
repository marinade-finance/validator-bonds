use crate::events::config::InitConfigEvent;
use crate::state::config::Config;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;

/// Creates a new config root account that configures the bonds program
#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// config root account that will be created
    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<Config>() + 512
    )]
    pub config: Account<'info, Config>,

    /// rent exempt payer of root config account creation
    #[account(
        mut,
        owner = system_program::ID
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitConfig<'info> {
    pub fn process(&mut self, init_config_args: InitConfigArgs) -> Result<()> {
        // TODO: are there some limitations about values for claim_settlement and withdraw_lockup?
        self.config.set_inner(Config {
            admin_authority: init_config_args.admin_authority,
            operator_authority: init_config_args.operator_authority,
            claim_settlement_after_epochs: init_config_args.claim_settlement_after_epochs,
            withdraw_lockup_epochs: init_config_args.withdraw_lockup_epochs,
        });

        emit!(InitConfigEvent {
            admin_authority: self.config.admin_authority,
            operator_authority: self.config.operator_authority,
            claim_settlement_after_epochs: self.config.claim_settlement_after_epochs,
            withdraw_lockup_epochs: self.config.withdraw_lockup_epochs,
        });
        msg!(
            "Config initialized with admin authority {}",
            self.config.admin_authority
        );

        Ok(())
    }
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitConfigArgs {
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub claim_settlement_after_epochs: u64,
    pub withdraw_lockup_epochs: u64,
}
