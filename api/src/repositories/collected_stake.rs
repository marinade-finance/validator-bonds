use crate::repositories::common::{http_transient, read_yaml_input, CommonStoreOptions};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use validator_bonds_common::cli_result::CliError;
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

/// Optional filters over a window. Empty filter vectors mean "no filter", not "match nothing".
pub struct CollectedStakeQuery {
    pub labels: Vec<String>,
    pub vote_accounts: Vec<String>,
}

impl CollectedStakeQuery {
    fn matches(&self, record: &CollectedStakeRecord) -> bool {
        (self.labels.is_empty() || self.labels.contains(&record.label))
            && (self.vote_accounts.is_empty() || self.vote_accounts.contains(&record.vote_account))
    }
}

/// The records both filters keep, epoch by epoch. An epoch none of whose records match is left
/// out altogether, the same as one that was never collected.
pub fn filter_snapshots(
    snapshots: Vec<CollectedStakeSnapshot>,
    query: &CollectedStakeQuery,
) -> Vec<CollectedStakeSnapshot> {
    let mut kept = Vec::with_capacity(snapshots.len());
    for mut snapshot in snapshots {
        snapshot.records.retain(|record| query.matches(record));
        if !snapshot.records.is_empty() {
            kept.push(snapshot);
        }
    }
    kept
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

/// The epoch `@last` resolves to; `None` when nothing has ever been collected.
pub async fn get_latest_collected_epoch(directory: &Directory) -> anyhow::Result<Option<u64>> {
    Ok(get_collected_stake(directory)
        .await?
        .map(|snapshot| snapshot.epoch))
}

/// The epochs of `from_epoch..=to_epoch` the store holds, newest first — one read per epoch, so
/// the caller bounds the window. An epoch the store does not hold is skipped, never interpolated.
pub async fn get_collected_stake_window(
    directory: &Directory,
    from_epoch: u64,
    to_epoch: u64,
) -> anyhow::Result<Vec<CollectedStakeSnapshot>> {
    let mut snapshots = Vec::new();
    for epoch in (from_epoch..=to_epoch).rev() {
        let path = format!("/bonds/stake/{epoch}");
        if let Some(document) = directory.get::<CollectedStakeSnapshot>(&path).await? {
            snapshots.push(document.body);
        }
    }
    Ok(snapshots)
}

pub async fn store_collected_stake(options: CommonStoreOptions) -> anyhow::Result<()> {
    let records: Vec<CollectedStakeRecord> = read_yaml_input(&options.input_path)?;
    let snapshot = collected_stake(records).map_err(CliError::critical)?;
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
