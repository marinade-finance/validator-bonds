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
// endpoint.
fn validate(config: VerifiedValidatorsConfig) -> anyhow::Result<Vec<String>> {
    let mut verified = BTreeSet::new();
    for entry in config.verified_validators {
        let pubkey = Pubkey::from_str(&entry)
            .with_context(|| format!("Invalid verified validator vote account '{entry}'"))?;
        verified.insert(pubkey.to_string());
    }
    Ok(verified.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "DumiCKHVqoCQTinngN5Mdp6L1Dj9nc9UWpXqNMQzf7B";
    const B: &str = "GwHH8ciFhR8vejWCqmg8FWZUCNtubPY2esALvy5tBvGp";

    fn config(entries: &[&str]) -> VerifiedValidatorsConfig {
        VerifiedValidatorsConfig {
            verified_validators: entries.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn invalid_entry_errors() {
        let err = validate(config(&["not-a-pubkey"])).unwrap_err();
        assert!(err.to_string().contains("not-a-pubkey"));
    }

    #[test]
    fn duplicates_deduped() {
        assert_eq!(validate(config(&[A, A])).unwrap(), vec![A.to_string()]);
    }

    #[test]
    fn output_is_sorted() {
        // B before A on input; A sorts first.
        assert_eq!(
            validate(config(&[B, A])).unwrap(),
            vec![A.to_string(), B.to_string()]
        );
    }

    #[test]
    fn empty_is_ok() {
        assert!(validate(config(&[])).unwrap().is_empty());
    }

    #[test]
    fn missing_key_errors() {
        serde_yaml::from_str::<VerifiedValidatorsConfig>("other: value").unwrap_err();
    }
}
