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
        InitConfig::process(ctx, init_config_args)
    }

    pub fn configure_config(
        ctx: Context<ConfigureConfig>,
        configure_config_args: ConfigureConfigArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ConfigureConfig::process(ctx, configure_config_args)
    }

    pub fn init_bond(ctx: Context<InitBond>, init_bond_args: InitBondArgs) -> Result<()> {
        check_context(&ctx)?;
        InitBond::process(ctx, init_bond_args)
    }

    pub fn configure_bond(
        ctx: Context<ConfigureBond>,
        configure_bond_args: ConfigureBondArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ConfigureBond::process(ctx, configure_bond_args)
    }

    pub fn configure_bond_with_mint(
        ctx: Context<ConfigureBondWithMint>,
        args: ConfigureBondWithMintArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ConfigureBondWithMint::process(ctx, args)
    }

    pub fn mint_bond(ctx: Context<MintBond>) -> Result<()> {
        check_context(&ctx)?;
        MintBond::process(ctx)
    }

    pub fn fund_bond(ctx: Context<FundBond>) -> Result<()> {
        check_context(&ctx)?;
        FundBond::process(ctx)
    }

    pub fn init_withdraw_request(
        ctx: Context<InitWithdrawRequest>,
        create_withdraw_request_args: InitWithdrawRequestArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        InitWithdrawRequest::process(ctx, create_withdraw_request_args)
    }

    pub fn cancel_withdraw_request(ctx: Context<CancelWithdrawRequest>) -> Result<()> {
        check_context(&ctx)?;
        CancelWithdrawRequest::process(ctx)
    }

    pub fn claim_withdraw_request(ctx: Context<ClaimWithdrawRequest>) -> Result<()> {
        check_context(&ctx)?;
        ClaimWithdrawRequest::process(ctx)
    }

    pub fn init_settlement(
        ctx: Context<InitSettlement>,
        init_settlement_args: InitSettlementArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        InitSettlement::process(ctx, init_settlement_args)
    }

    pub fn close_settlement(ctx: Context<CloseSettlement>) -> Result<()> {
        check_context(&ctx)?;
        CloseSettlement::process(ctx)
    }

    pub fn cancel_settlement(ctx: Context<CancelSettlement>) -> Result<()> {
        check_context(&ctx)?;
        CancelSettlement::process(ctx)
    }

    pub fn fund_settlement(ctx: Context<FundSettlement>) -> Result<()> {
        check_context(&ctx)?;
        FundSettlement::process(ctx)
    }

    pub fn close_settlement_claim(ctx: Context<CloseSettlementClaim>) -> Result<()> {
        check_context(&ctx)?;
        CloseSettlementClaim::process(ctx)
    }

    pub fn claim_settlement(
        ctx: Context<ClaimSettlement>,
        claim_settlement_args: ClaimSettlementArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ClaimSettlement::process(ctx, claim_settlement_args)
    }

    pub fn merge_stake(ctx: Context<MergeStake>, merge_args: MergeStakeArgs) -> Result<()> {
        check_context(&ctx)?;
        MergeStake::process(ctx, merge_args)
    }

    pub fn reset_stake(ctx: Context<ResetStake>) -> Result<()> {
        check_context(&ctx)?;
        ResetStake::process(ctx)
    }

    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        check_context(&ctx)?;
        WithdrawStake::process(ctx)
    }

    pub fn emergency_pause(ctx: Context<EmergencyPauseResume>) -> Result<()> {
        check_context(&ctx)?;
        EmergencyPauseResume::pause(ctx)
    }

    pub fn emergency_resume(ctx: Context<EmergencyPauseResume>) -> Result<()> {
        check_context(&ctx)?;
        EmergencyPauseResume::resume(ctx)
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
