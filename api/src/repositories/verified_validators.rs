use anyhow::Context;
use serde::Deserialize;
use settlement_common::utils::read_from_yaml_file;
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeSet;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
pub struct VerifiedValidatorsConfig {
    pub verified_validators: Vec<String>,
}

pub fn load_verified_validators(path: &str) -> anyhow::Result<Vec<String>> {
    let config: VerifiedValidatorsConfig = read_from_yaml_file(&path)?;
    validate(config)
}

// Fails on any invalid pubkey so a single typo aborts startup rather than silently emptying the
// endpoint. Entries are deduplicated and sorted for a stable response.
fn validate(config: VerifiedValidatorsConfig) -> anyhow::Result<Vec<String>> {
    let mut verified = BTreeSet::new();
    for entry in config.verified_validators {
        let pubkey = Pubkey::from_str(&entry)
            .with_context(|| format!("Invalid verified validator vote account '{entry}'"))?;
        verified.insert(pubkey.to_string());
    }
    Ok(verified.into_iter().collect())
}
