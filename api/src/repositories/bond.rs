use crate::repositories::common::{http_transient, CommonStoreOptions};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use validator_bonds_common::directory::Directory;
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

/// One collector run's whole bond set — the unit the store holds, written to
/// `/bonds/{type}/{epoch}` and read back through `@last`.
#[derive(Debug, Serialize, Deserialize)]
pub struct BondsDocument {
    pub epoch: u64,
    pub updated_at: DateTime<Utc>,
    pub bonds: Vec<ValidatorBondRecord>,
}

/// What a bonds-eventing run leaves behind: the auction it evaluated, and the per-validator
/// state it evaluated against.
#[derive(Deserialize)]
pub struct EventingDocument {
    pub epoch: u64,
    #[serde(default)]
    pub meta: Option<Value>,
    #[serde(default)]
    pub validators: HashMap<String, ValidatorState>,
}

/// ds-sam-calc relay from bonds-eventing. Untyped but for the two fields the API reads —
/// the CLI's ds-sam-calc owns the blob's shape.
#[derive(Deserialize)]
pub struct ValidatorState {
    pub epoch: u64,
    #[serde(default)]
    pub auction_validator: Option<Value>,
}

pub async fn get_eventing_state(
    directory: &Directory,
    bond_type: BondType,
) -> anyhow::Result<Option<EventingDocument>> {
    let path = format!("/bonds/eventing/{bond_type}");
    Ok(directory
        .get::<EventingDocument>(&path)
        .await?
        .map(|document| document.body))
}

pub async fn get_bonds_by_type(
    directory: &Directory,
    bond_type: BondType,
) -> anyhow::Result<Vec<ValidatorBondRecord>> {
    Ok(match get_last_bonds(directory, bond_type).await? {
        Some(document) => document.bonds,
        None => vec![],
    })
}

/// Both configs at one epoch. `/v1/validators/protected` sums their collateral, and each type is
/// stored by its own pipeline run, so the newest of one type can be an epoch the other has yet
/// to reach.
pub async fn get_summable_bonds(directory: &Directory) -> anyhow::Result<Vec<ValidatorBondRecord>> {
    let mut bidding = get_last_bonds(directory, BondType::Bidding).await?;
    let mut institutional = get_last_bonds(directory, BondType::Institutional).await?;

    // Summing at the newer type's epoch would count only that type's collateral, halving a
    // validator's cover until the other pipeline catches up.
    let epochs = (
        bidding.as_ref().map(|document| document.epoch),
        institutional.as_ref().map(|document| document.epoch),
    );
    if let (Some(bidding_epoch), Some(institutional_epoch)) = epochs {
        if bidding_epoch > institutional_epoch {
            bidding = get_bonds_at(directory, BondType::Bidding, institutional_epoch).await?;
        } else if institutional_epoch > bidding_epoch {
            institutional = get_bonds_at(directory, BondType::Institutional, bidding_epoch).await?;
        }
    }

    let mut bonds = Vec::new();
    for document in [bidding, institutional].into_iter().flatten() {
        bonds.extend(document.bonds);
    }
    Ok(bonds)
}

async fn get_last_bonds(
    directory: &Directory,
    bond_type: BondType,
) -> anyhow::Result<Option<BondsDocument>> {
    let path = format!("/bonds/{bond_type}/@last");
    Ok(directory
        .get::<BondsDocument>(&path)
        .await?
        .map(|document| document.body))
}

/// `None` where that type never stored the epoch, which reads as the empty row set the
/// `bond_type IN (…) AND epoch = …` filter used to return.
async fn get_bonds_at(
    directory: &Directory,
    bond_type: BondType,
    epoch: u64,
) -> anyhow::Result<Option<BondsDocument>> {
    let path = format!("/bonds/{bond_type}/{epoch}");
    Ok(directory
        .get::<BondsDocument>(&path)
        .await?
        .map(|document| document.body))
}

pub async fn store_bonds(options: CommonStoreOptions) -> anyhow::Result<()> {
    let input = std::fs::File::open(&options.input_path)?;
    let bonds: Vec<ValidatorBondRecord> = serde_yaml::from_reader(input)?;
    let (path, document) = collected_bonds(bonds)?;

    let directory = Directory::new(&options.directory_url, &options.directory_token);
    directory
        .put_or_replace(&path, &document)
        .await
        .map_err(http_transient)?;

    log::info!("Stored {} bonds at {path}", document.bonds.len());
    Ok(())
}

/// Where the set belongs, and what to write there. One collector run holds one epoch of one
/// bond type, and those two are the path — a file that disagrees with itself has no one path
/// and is refused before anything is written.
fn collected_bonds(bonds: Vec<ValidatorBondRecord>) -> anyhow::Result<(String, BondsDocument)> {
    let Some(first) = bonds.first() else {
        // An empty file must not be allowed to replace a stored set with nothing.
        anyhow::bail!("No bonds to store");
    };
    let epoch = first.epoch;
    let updated_at = first.updated_at;
    let bond_type = first.bond_type.as_str();

    anyhow::ensure!(
        bonds.iter().all(|bond| bond.epoch == epoch),
        "Bonds span multiple epochs, expected only {epoch}",
    );
    anyhow::ensure!(
        bonds
            .iter()
            .all(|bond| bond.bond_type.as_str() == bond_type),
        "Bonds span multiple bond types, expected only {bond_type}",
    );

    Ok((
        format!("/bonds/{bond_type}/{epoch}"),
        BondsDocument {
            epoch,
            updated_at,
            bonds,
        },
    ))
}

#[cfg(test)]
#[path = "bond_test.rs"]
mod bond_test;
