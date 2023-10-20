pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

/// solana-security-txt for Validator Bonds program by Marinade.finance
use solana_security_txt::security_txt;
#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Validator Bonds",
    project_url: "https://github.com/marinade-finance/validator-bonds",
    contacts: "link:https://docs.marinade.finance/marinade-dao,link:https://discord.com/invite/6EtUf4Euu6",
    policy: "https://docs.marinade.finance/marinade-protocol/security",
    preferred_languages: "en",
    source_code: "https://github.com/marinade-finance/validator-bonds",
    auditors: "TODO"
}

declare_id!("vbondsKbsC4QSLQQnn6ngZvkqfywn6KgEeQbkGSpk1V");

#[program]
pub mod validator_bonds {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, init_config: InitConfigArgs) -> Result<()> {
        ctx.accounts.process(init_config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use constants::PROGRAM_ID;
    use std::str::FromStr;

    #[test]
    fn program_ids_match() {
        assert_eq!(crate::ID, Pubkey::from_str(PROGRAM_ID).unwrap());
    }
}
