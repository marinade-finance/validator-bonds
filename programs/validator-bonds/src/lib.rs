// Stops Rust Analyzer complaining about missing configs
// See https://solana.stackexchange.com/questions/17777
#![allow(unexpected_cfgs)]
// Fix warning: use of deprecated method `anchor_lang::prelude::AccountInfo::<'a>::realloc`: Use AccountInfo::resize() instead
// See https://solana.stackexchange.com/questions/22979
#![allow(deprecated)]
use anchor_lang::prelude::*;

pub mod checks;
pub mod constants;
pub mod error;
pub mod events;
pub mod utils;

pub mod instructions;
pub mod state;

use crate::error::ErrorCode;
use anchor_lang::Bumps;
use instructions::*;

/// solana-security-txt for Validator Bonds program by Marinade.Finance
#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;
#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Validator Bonds",
    project_url: "https://marinade.finance",
    contacts: "link:https://docs.marinade.finance",
    policy: "https://docs.marinade.finance/marinade-protocol/security",
    preferred_languages: "en",
    source_code: "https://github.com/marinade-finance/validator-bonds",
    auditors: "Neodyme",
    source_revision: env!("GIT_REV"),
    source_release: env!("GIT_REV_NAME")
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

    pub fn init_bond_product(
        ctx: Context<InitBondProduct>,
        init_bond_product_args: InitBondProductArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        InitBondProduct::process(ctx, init_bond_product_args)
    }

    pub fn configure_bond_product(
        ctx: Context<ConfigureBondProduct>,
        configure_bond_product_args: ConfigureBondProductArgs,
    ) -> Result<()> {
        check_context(&ctx)?;
        ConfigureBondProduct::process(ctx, configure_bond_product_args)
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

    pub fn upsize_settlement_claims(ctx: Context<UpsizeSettlementClaims>) -> Result<()> {
        check_context(&ctx)?;
        UpsizeSettlementClaims::process(ctx)
    }

    pub fn cancel_settlement(ctx: Context<CancelSettlement>) -> Result<()> {
        check_context(&ctx)?;
        CancelSettlement::process(ctx)
    }

    pub fn fund_settlement(ctx: Context<FundSettlement>) -> Result<()> {
        check_context(&ctx)?;
        FundSettlement::process(ctx)
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

    pub fn close_settlement_v2(ctx: Context<CloseSettlementV2>) -> Result<()> {
        check_context(&ctx)?;
        CloseSettlementV2::process(ctx)
    }

    pub fn claim_settlement_v2(
        ctx: Context<ClaimSettlementV2>,
        claim_settlement_args: ClaimSettlementV2Args,
    ) -> Result<()> {
        check_context(&ctx)?;
        ClaimSettlementV2::process(ctx, claim_settlement_args)
    }

    // // Enable to force IDL to include ClaimSettlementV1
    // // Per Anchor changes (0.31.0) the account is included in the IDL only if used in the program code
    // pub fn claim_settlement_v1(ctx: Context<ClaimSettlementV1>) -> Result<()> {
    //     check_context(&ctx)?;
    //     Ok(())
    // }
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
