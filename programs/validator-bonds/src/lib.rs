pub mod checks;
pub mod constants;
pub mod error;
pub mod events;
pub mod utils;

pub mod instructions;
pub mod state;

use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use anchor_lang::Bumps;
use instructions::*;

/// solana-security-txt for Validator Bonds program by Marinade.finance
#[cfg(not(feature = "no-entrypoint"))]
use {default_env::default_env, solana_security_txt::security_txt};
#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Validator Bonds",
    project_url: "https://marinade.finance",
    contacts: "link:https://docs.marinade.finance/marinade-dao,link:https://discord.com/invite/6EtUf4Euu6",
    policy: "https://docs.marinade.finance/marinade-protocol/security",
    preferred_languages: "en",
    source_code: "https://github.com/marinade-finance/validator-bonds",
    source_release: "v1.0",
    auditors: "TODO",
    source_revision: default_env!("GIT_REV", "GIT_REV_MISSING"),
    source_release: default_env!("GIT_REV_NAME", "GIT_REV_NAME_MISSING")
}

// TODO: need to grind an address
declare_id!("vbondsKbsC4QSLQQnn6ngZvkqfywn6KgEeQbkGSpk1V");

// TODO: General TODOs:
//       - verify that errors are used and error codes matches
//       - recheck all 'mut' definitions if they matches to what we need
//       - consider utility of zero_copy, if it can be used, what are benefits?
//       - consider using only PDA hash and not has_one at anchor constraints

fn check_context<T: Bumps>(ctx: &Context<T>) -> Result<()> {
    if !check_id(ctx.program_id) {
        return err!(ErrorCode::InvalidProgramId);
    }
    // make sure there are no extra accounts
    if !ctx.remaining_accounts.is_empty() {
        return err!(ErrorCode::UnexpectedRemainingAccounts);
    }

    Ok(())
}
#[program]
pub mod validator_bonds {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, init_config_args: InitConfigArgs) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process(init_config_args)
    }

    pub fn configure_config(
        ctx: Context<ConfigureConfig>,
        configure_config_args: ConfigureConfigArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process(configure_config_args)
    }

    pub fn init_bond(ctx: Context<InitBond>, init_bond_args: InitBondArgs) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process(init_bond_args, ctx.bumps.bond)
    }

    pub fn configure_bond(
        ctx: Context<ConfigureBond>,
        configure_bond_args: ConfigureBondArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process(configure_bond_args)
    }

    pub fn deposit_bond(ctx: Context<DepositBond>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn create_withdraw_request(
        ctx: Context<CreateWithdrawRequest>,
        create_withdraw_request_args: CreateWithdrawRequestArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts
            .process(create_withdraw_request_args, ctx.bumps.withdraw_request)
    }

    pub fn cancel_withdraw_request(ctx: Context<CancelWithdrawRequest>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn withdraw_deposit(ctx: Context<WithdrawDeposit>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn init_settlement(
        ctx: Context<InitSettlement>,
        init_settlement_args: InitSettlementArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts
            .process(init_settlement_args, ctx.bumps.settlement)
    }

    pub fn close_settlement(ctx: Context<CloseSettlement>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn fund_settlement(ctx: Context<ResetStake>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn close_settlement_claim(ctx: Context<CloseSettlementClaim>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn claim_settlement(
        ctx: Context<ClaimSettlement>,
        claim_settlement_args: ClaimSettlementArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts
            .process(claim_settlement_args, ctx.bumps.settlement_claim)
    }

    pub fn merge(ctx: Context<Merge>, merge_args: MergeArgs) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process(merge_args)
    }

    pub fn reset(ctx: Context<ResetStake>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use constants::PROGRAM_ID;
    use std::str::FromStr;

    #[test]
    fn program_ids_match() {
        assert_eq!(ID, Pubkey::from_str(PROGRAM_ID).unwrap());
    }
}
