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

/// solana-security-txt for Validator Bonds program by Marinade.Finance
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
    auditors: "TODO",
    source_revision: default_env!("GIT_REV", "GIT_REV_MISSING"),
    source_release: default_env!("GIT_REV_NAME", "GIT_REV_NAME_MISSING")
}

declare_id!("vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4");

// TODO: General TODOs:
//       - recheck all 'mut' definitions if they matches to what we need
//       - readme with table of what stake_authority/withdraw_authority are at which stages
//       - verify that really every input account is checked for owner program!
//       - consider use the map_or_else to return the error
//       - fund_settlement is now operator based, consider if it should be permission-less
//       - consider https://www.soldev.app/course/duplicate-mutable-accounts to check on #[account(constraint = user_a.key() != user_b.key())]
//       - recheck CPI program calls https://www.soldev.app/course/arbitrary-cpi

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

    pub fn fund_bond(ctx: Context<FundBond>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn init_withdraw_request(
        ctx: Context<InitWithdrawRequest>,
        create_withdraw_request_args: InitWithdrawRequestArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts
            .process(create_withdraw_request_args, ctx.bumps.withdraw_request)
    }

    pub fn cancel_withdraw_request(ctx: Context<CancelWithdrawRequest>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.process()
    }

    pub fn claim_withdraw_request(ctx: Context<ClaimWithdrawRequest>) -> Result<()> {
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

    pub fn fund_settlement(ctx: Context<FundSettlement>) -> Result<()> {
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

    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.pause()
    }

    pub fn emergency_resume(ctx: Context<EmergencyPause>) -> Result<()> {
        check_context(&ctx)?;
        ctx.accounts.resume()
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
