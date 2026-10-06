use crate::repositories::common::{http_transient, CommonStoreOptions};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use validator_bonds_common::directory::Directory;
use validator_bonds_common::dto::CollectedStakeRecord;

/// Marinade stake in lamports, keyed by vote account.
pub type MarinadeStakeByVoteAccount = HashMap<String, u64>;

/// One collection run, and the document at `/bonds/stake/{epoch}`: every record shares the epoch,
/// slot and timestamp the collector stamped, since the store replaces a whole epoch at once.
#[derive(Debug, Serialize, Deserialize)]
pub struct CollectedStakeSnapshot {
    pub epoch: u64,
    pub slot: u64,
    pub updated_at: DateTime<Utc>,
    pub records: Vec<CollectedStakeRecord>,
}

impl CollectedStakeSnapshot {
    /// Summed across every configured authority, `activating` included: the bond has to cover the
    /// validator's whole Marinade stake, whichever product routed it, and it has to cover stake
    /// already routed there before that stake goes live. `deactivating` is a subset of `effective`.
    pub fn stake_to_cover_by_vote_account(&self) -> MarinadeStakeByVoteAccount {
        let mut to_cover = MarinadeStakeByVoteAccount::new();
        for record in &self.records {
            *to_cover.entry(record.vote_account.clone()).or_default() +=
                record.effective + record.activating;
        }
        to_cover
    }
}

/// `None` when nothing has ever been collected. Callers must fail loudly rather than treat that as
/// "no validator has stake", which reduces `/protected` to its bond floor for everyone.
pub async fn get_collected_stake(
    directory: &Directory,
) -> anyhow::Result<Option<CollectedStakeSnapshot>> {
    Ok(directory
        .get::<CollectedStakeSnapshot>("/bonds/stake/@last")
        .await?
        .map(|document| document.body))
}

pub async fn store_collected_stake(options: CommonStoreOptions) -> anyhow::Result<()> {
    let input = std::fs::File::open(&options.input_path)?;
    let records: Vec<CollectedStakeRecord> = serde_yaml::from_reader(input)?;
    let snapshot = collected_stake(records)?;
    let path = format!("/bonds/stake/{}", snapshot.epoch);

    let directory = Directory::new(&options.directory_url, &options.directory_token);
    directory
        .put_or_replace(&path, &snapshot)
        .await
        .map_err(http_transient)?;

    log::info!(
        "Stored {} collected stake records at {path}",
        snapshot.records.len()
    );
    Ok(())
}

fn collected_stake(records: Vec<CollectedStakeRecord>) -> anyhow::Result<CollectedStakeSnapshot> {
    let Some(first) = records.first() else {
        anyhow::bail!("No collected stake records to store");
    };
    let epoch = first.epoch;
    let slot = first.slot;
    let updated_at = first.updated_at;

    anyhow::ensure!(
        records.iter().all(|record| record.epoch == epoch),
        "Collected stake records span multiple epochs, expected only {epoch}",
    );
    anyhow::ensure!(
        records.iter().all(|record| record.slot == slot),
        "Collected stake records span multiple slots, expected only {slot}",
    );
    anyhow::ensure!(
        records.iter().all(|record| record.updated_at == updated_at),
        "Collected stake records span multiple timestamps, expected only {updated_at}",
    );

    Ok(CollectedStakeSnapshot {
        epoch,
        slot,
        updated_at,
        records,
    })
}

#[cfg(test)]
#[path = "collected_stake_test.rs"]
mod collected_stake_test;
