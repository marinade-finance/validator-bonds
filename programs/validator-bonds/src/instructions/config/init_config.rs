use crate::constants::MIN_STAKE_LAMPORTS;
use crate::events::config::InitConfigEvent;
use crate::state::config::{find_bonds_withdrawer_authority, Config};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitConfigArgs {
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub epochs_to_claim_settlement: u64,
    pub withdraw_lockup_epochs: u64,
    pub slots_to_start_settlement_claiming: u64,
}

/// Creates a new config root account that configures the bonds program
#[event_cpi]
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<Config>()
    )]
    pub config: Account<'info, Config>,

    /// rent exempt payer for the config account
    #[account(
        mut,
        owner = system_program.key(),
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitConfig<'info> {
    pub fn process(
        ctx: Context<InitConfig>,
        InitConfigArgs {
            admin_authority,
            operator_authority,
            epochs_to_claim_settlement,
            withdraw_lockup_epochs,
            slots_to_start_settlement_claiming,
        }: InitConfigArgs,
    ) -> Result<()> {
        let (bonds_withdrawer_authority, bonds_withdrawer_authority_bump) =
            find_bonds_withdrawer_authority(&ctx.accounts.config.key());
        ctx.accounts.config.set_inner(Config {
            admin_authority,
            operator_authority,
            epochs_to_claim_settlement,
            withdraw_lockup_epochs,
            minimum_stake_lamports: MIN_STAKE_LAMPORTS,
            bonds_withdrawer_authority_bump,
            pause_authority: admin_authority,
            paused: false,
            slots_to_start_settlement_claiming,
            min_bond_max_stake_wanted: 0,
            reserved: [0; 463],
        });

        emit_cpi!(InitConfigEvent {
            config: ctx.accounts.config.key(),
            admin_authority: ctx.accounts.config.admin_authority,
            operator_authority: ctx.accounts.config.operator_authority,
            epochs_to_claim_settlement: ctx.accounts.config.epochs_to_claim_settlement,
            withdraw_lockup_epochs: ctx.accounts.config.withdraw_lockup_epochs,
            minimum_stake_lamports: ctx.accounts.config.minimum_stake_lamports,
            bonds_withdrawer_authority,
            slots_to_start_settlement_claiming: ctx
                .accounts
                .config
                .slots_to_start_settlement_claiming,
        });

        Ok(())
    }
}
