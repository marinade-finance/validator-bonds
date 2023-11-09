use crate::error::ErrorCode;
use crate::events::{config::ConfigureConfigEvent, PubkeyValueChange, U64ValueChange};
use crate::state::config::Config;
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureConfigArgs {
    pub admin_authority: Option<Pubkey>,
    pub operator_authority: Option<Pubkey>,
    pub epochs_to_claim_settlement: Option<u64>,
    pub withdraw_lockup_epochs: Option<u64>,
}

/// Configures bond program with the config root account params
#[derive(Accounts)]
pub struct ConfigureConfig<'info> {
    /// config root account that will be configured
    #[account(
        mut,
        has_one = admin_authority @ ErrorCode::InvalidAdminAuthority,
    )]
    config: Account<'info, Config>,

    /// only the admin authority can change the config params
    #[account()]
    admin_authority: Signer<'info>,
}

impl<'info> ConfigureConfig<'info> {
    pub fn process(
        &mut self,
        ConfigureConfigArgs {
            admin_authority,
            operator_authority,
            epochs_to_claim_settlement,
            withdraw_lockup_epochs,
        }: ConfigureConfigArgs,
    ) -> Result<()> {
        let admin_authority_change = admin_authority.map(|admin| {
            let old = self.config.admin_authority;
            self.config.admin_authority = admin;
            PubkeyValueChange { old, new: admin }
        });

        let operator_authority_change = operator_authority.map(|operator| {
            let old = self.config.operator_authority;
            self.config.operator_authority = operator;
            PubkeyValueChange { old, new: operator }
        });

        let epochs_to_claim_settlement_change =
            epochs_to_claim_settlement.map(|claim_settlement| {
                let old = self.config.epochs_to_claim_settlement;
                self.config.epochs_to_claim_settlement = claim_settlement;
                U64ValueChange {
                    old,
                    new: claim_settlement,
                }
            });

        let withdraw_lockup_epochs_change = withdraw_lockup_epochs.map(|withdraw_lockup| {
            let old = self.config.withdraw_lockup_epochs;
            self.config.withdraw_lockup_epochs = withdraw_lockup;
            U64ValueChange {
                old,
                new: withdraw_lockup,
            }
        });

        emit!(ConfigureConfigEvent {
            admin_authority: admin_authority_change,
            operator_authority: operator_authority_change,
            epochs_to_claim_settlement: epochs_to_claim_settlement_change,
            withdraw_lockup_epochs: withdraw_lockup_epochs_change,
        });

        Ok(())
    }
}
