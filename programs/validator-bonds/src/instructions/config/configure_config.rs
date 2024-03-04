use crate::error::ErrorCode;
use crate::events::{config::ConfigureConfigEvent, PubkeyValueChange, U64ValueChange};
use crate::state::config::Config;
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureConfigArgs {
    pub admin: Option<Pubkey>,
    pub operator: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
    pub epochs_to_claim_settlement: Option<u64>,
    pub withdraw_lockup_epochs: Option<u64>,
    pub minimum_stake_lamports: Option<u64>,
}

/// Configures bond program with the config root account params
#[derive(Accounts)]
pub struct ConfigureConfig<'info> {
    #[account(
        mut,
        has_one = admin_authority @ ErrorCode::InvalidAdminAuthority,
    )]
    pub config: Account<'info, Config>,

    /// only the admin authority can change the config params
    pub admin_authority: Signer<'info>,
}

impl<'info> ConfigureConfig<'info> {
    pub fn process(
        &mut self,
        ConfigureConfigArgs {
            admin,
            operator,
            pause_authority,
            epochs_to_claim_settlement,
            withdraw_lockup_epochs,
            minimum_stake_lamports,
        }: ConfigureConfigArgs,
    ) -> Result<()> {
        let admin_authority_change = admin.map(|admin| {
            let old = self.config.admin_authority;
            self.config.admin_authority = admin;
            PubkeyValueChange { old, new: admin }
        });

        let operator_authority_change = operator.map(|operator| {
            let old = self.config.operator_authority;
            self.config.operator_authority = operator;
            PubkeyValueChange { old, new: operator }
        });

        let pause_authority_change = pause_authority.map(|pause_authority| {
            let old = self.config.pause_authority;
            self.config.pause_authority = pause_authority;
            PubkeyValueChange {
                old,
                new: pause_authority,
            }
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

        let minimum_stake_lamports_change = minimum_stake_lamports.map(|minimum_stake| {
            let old = self.config.minimum_stake_lamports;
            self.config.minimum_stake_lamports = minimum_stake;
            U64ValueChange {
                old,
                new: minimum_stake,
            }
        });

        emit!(ConfigureConfigEvent {
            admin_authority: admin_authority_change,
            operator_authority: operator_authority_change,
            pause_authority: pause_authority_change,
            epochs_to_claim_settlement: epochs_to_claim_settlement_change,
            withdraw_lockup_epochs: withdraw_lockup_epochs_change,
            minimum_stake_lamports: minimum_stake_lamports_change,
        });

        Ok(())
    }
}
