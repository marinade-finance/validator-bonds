use anyhow::Context;
use serde::Deserialize;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
pub struct CollectorConfig {
    pub collect_stake_authorities: Vec<StakeAuthorityEntry>,
}

#[derive(Debug, Deserialize)]
pub struct StakeAuthorityEntry {
    pub label: String,
    pub stake_authority: String,
}

#[derive(Debug, Clone)]
pub struct StakeAuthority {
    pub label: String,
    pub stake_authority: Pubkey,
}

pub fn load_collector_config(path: &str) -> anyhow::Result<Vec<StakeAuthority>> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open collector config '{path}'"))?;
    let config: CollectorConfig = serde_yaml::from_reader(file)
        .with_context(|| format!("Failed to parse collector config '{path}'"))?;
    validate(config)
}

// Everything fails at load rather than mid-run: a dropped authority silently understates the stake
// routed through Marinade, which would over-report bond coverage downstream.
fn validate(config: CollectorConfig) -> anyhow::Result<Vec<StakeAuthority>> {
    anyhow::ensure!(
        !config.collect_stake_authorities.is_empty(),
        "collect_stake_authorities must not be empty"
    );

    let mut labels = HashSet::new();
    let mut authorities = HashSet::new();
    let mut collected = vec![];
    for entry in config.collect_stake_authorities {
        let stake_authority = Pubkey::from_str(&entry.stake_authority).with_context(|| {
            format!(
                "Invalid stake authority '{}' of '{}'",
                entry.stake_authority, entry.label
            )
        })?;
        anyhow::ensure!(
            labels.insert(entry.label.clone()),
            "Duplicate label '{}'",
            entry.label
        );
        anyhow::ensure!(
            authorities.insert(stake_authority),
            "Duplicate stake authority '{stake_authority}'"
        );
        collected.push(StakeAuthority {
            label: entry.label,
            stake_authority,
        });
    }

    Ok(collected)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq";
    const B: &str = "4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk";

    fn config(entries: &[(&str, &str)]) -> CollectorConfig {
        CollectorConfig {
            collect_stake_authorities: entries
                .iter()
                .map(|(label, stake_authority)| StakeAuthorityEntry {
                    label: label.to_string(),
                    stake_authority: stake_authority.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn entries_keep_their_order_and_labels() {
        let loaded = validate(config(&[("native", A), ("liquid", B)])).unwrap();
        assert_eq!(
            loaded
                .iter()
                .map(|entry| (entry.label.as_str(), entry.stake_authority.to_string()))
                .collect::<Vec<_>>(),
            vec![("native", A.to_string()), ("liquid", B.to_string())]
        );
    }

    #[test]
    fn an_invalid_pubkey_errors_with_its_label() {
        let err = validate(config(&[("native", "not-a-pubkey")])).unwrap_err();
        assert!(err.to_string().contains("not-a-pubkey"));
        assert!(err.to_string().contains("native"));
    }

    #[test]
    fn an_empty_list_errors() {
        validate(config(&[])).unwrap_err();
    }

    #[test]
    fn a_duplicate_label_errors() {
        let err = validate(config(&[("native", A), ("native", B)])).unwrap_err();
        assert!(err.to_string().contains("Duplicate label"));
    }

    #[test]
    fn a_duplicate_stake_authority_errors() {
        let err = validate(config(&[("native", A), ("native-again", A)])).unwrap_err();
        assert!(err.to_string().contains("Duplicate stake authority"));
    }

    #[test]
    fn a_missing_key_errors() {
        serde_yaml::from_str::<CollectorConfig>("other: value").unwrap_err();
    }
}
