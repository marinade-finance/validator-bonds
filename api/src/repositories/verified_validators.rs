use serde::Deserialize;
use settlement_common::utils::read_from_yaml_file;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
pub struct VerifiedValidatorsConfig {
    pub verified_validators: Vec<String>,
}

pub fn load_verified_validators(path: &str) -> anyhow::Result<Vec<String>> {
    let config: VerifiedValidatorsConfig = read_from_yaml_file(&path)?;
    Ok(validate(config))
}

// Keeps only entries that parse as a valid pubkey; invalid ones are logged and dropped so a
// single typo in the config cannot take the endpoint down.
fn validate(config: VerifiedValidatorsConfig) -> Vec<String> {
    let mut verified = vec![];
    let mut skipped = 0usize;
    for entry in config.verified_validators {
        match Pubkey::from_str(&entry) {
            Ok(pubkey) => verified.push(pubkey.to_string()),
            Err(err) => {
                skipped += 1;
                log::error!("Skipping invalid verified validator vote account '{entry}': {err}");
            }
        }
    }
    if skipped > 0 {
        log::warn!("Skipped {skipped} invalid verified validator vote account(s)");
    }
    verified
}
