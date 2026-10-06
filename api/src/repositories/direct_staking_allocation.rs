use crate::repositories::common::{http_transient, read_json_input, CommonStoreOptions};

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::str::FromStr;
use validator_bonds_common::allocation::AllocationReport;
use validator_bonds_common::cli_result::CliError;
use validator_bonds_common::directory::{Directory, Precondition};
use validator_bonds_common::dto::{AllocationOutcome, BondType, DirectStakingAllocationRecord};

/// The one document at `/bonds/direct-staking-allocation`: every allocator run, keyed by epoch.
/// One document for the whole history rather than one per epoch because the route serves the
/// whole history and the store lists nothing, so which epochs ever ran is knowable only from a
/// place that holds them all. A run replaces its epoch wholesale.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AllocationDocument {
    pub epochs: BTreeMap<u64, AllocationRun>,
}

/// One run's rows. Empty `records` is a run that routed nothing, which still says it ran —
/// epoch 1020, the first direct-staking run, had no claims to allocate.
#[derive(Debug, Serialize, Deserialize)]
pub struct AllocationRun {
    pub slot: u64,
    pub updated_at: DateTime<Utc>,
    pub records: Vec<DirectStakingAllocationRecord>,
}

pub const ALLOCATION_PATH: &str = "/bonds/direct-staking-allocation";

/// The report quotes its amounts as decimal strings so BigQuery ingests them into NUMERIC exactly.
/// An unparsable one is a corrupted report, never a zero: defaulting would publish a validator as
/// having no bond when it has one.
fn parse_amount(raw: &str, vote_account: &str, field: &str) -> anyhow::Result<Decimal> {
    Decimal::from_str(raw).map_err(|error| {
        anyhow::anyhow!("{field} '{raw}' of vote account {vote_account} is not a decimal: {error}")
    })
}

/// The report's per-epoch header is stamped onto every row, and `updated_at` is the store's own —
/// the report carries no timestamp. `exposure_bps` of `u64::MAX` is the allocator's sentinel for
/// an empty bond, which routing never selects: a report carrying it broke that invariant and
/// must not be stored quietly.
fn report_records(
    report: &AllocationReport,
    updated_at: DateTime<Utc>,
) -> anyhow::Result<Vec<DirectStakingAllocationRecord>> {
    let mut records = Vec::with_capacity(report.routed.len() + report.dropped_no_usable_bond.len());

    for routed in &report.routed {
        anyhow::ensure!(
            routed.exposure_bps != u64::MAX,
            "exposure_bps of vote account {} is the empty-bond sentinel, yet the validator was routed",
            routed.vote_account
        );
        records.push(DirectStakingAllocationRecord {
            epoch: report.epoch,
            slot: report.slot,
            vote_account: routed.vote_account.clone(),
            settlements: u32::try_from(routed.settlements)?,
            claims_amount: routed.claims_amount,
            bidding_bonds_epoch: report.bidding_bonds_epoch,
            institutional_bonds_epoch: report.institutional_bonds_epoch,
            outcome: AllocationOutcome::Routed {
                bond_type: BondType::parse_from_str(&routed.bond_type)?,
                effective_amount: parse_amount(
                    &routed.effective_amount,
                    &routed.vote_account,
                    "effective_amount",
                )?,
                exposure_bps: routed.exposure_bps,
            },
            updated_at,
        });
    }

    for dropped in &report.dropped_no_usable_bond {
        records.push(DirectStakingAllocationRecord {
            epoch: report.epoch,
            slot: report.slot,
            vote_account: dropped.vote_account.clone(),
            settlements: u32::try_from(dropped.settlements)?,
            claims_amount: dropped.claims_amount,
            bidding_bonds_epoch: report.bidding_bonds_epoch,
            institutional_bonds_epoch: report.institutional_bonds_epoch,
            outcome: AllocationOutcome::Dropped {
                bidding_effective_amount: parse_amount(
                    &dropped.bidding_effective_amount,
                    &dropped.vote_account,
                    "bidding_effective_amount",
                )?,
                institutional_effective_amount: parse_amount(
                    &dropped.institutional_effective_amount,
                    &dropped.vote_account,
                    "institutional_effective_amount",
                )?,
            },
            updated_at,
        });
    }

    Ok(records)
}

/// Newest epoch first, vote accounts in order within one; with `from_epoch`, that epoch on. `None`
/// when no report has ever been stored: callers answer that loudly, never as an empty list, which
/// reads as "nobody was left unprotected". An empty list is a stored history with no row in the
/// window.
pub async fn get_direct_staking_allocation(
    directory: &Directory,
    from_epoch: Option<u64>,
) -> anyhow::Result<Option<Vec<DirectStakingAllocationRecord>>> {
    let Some(document) = directory.get::<AllocationDocument>(ALLOCATION_PATH).await? else {
        return Ok(None);
    };
    Ok(Some(allocation_since(document.body, from_epoch)))
}

fn allocation_since(
    document: AllocationDocument,
    from_epoch: Option<u64>,
) -> Vec<DirectStakingAllocationRecord> {
    let from_epoch = from_epoch.unwrap_or(0);
    let mut records = Vec::new();
    for (epoch, mut run) in document.epochs.into_iter().rev() {
        if epoch < from_epoch {
            break;
        }
        run.records
            .sort_by(|a, b| a.vote_account.cmp(&b.vote_account));
        records.extend(run.records);
    }
    records
}

pub async fn store_direct_staking_allocation(options: CommonStoreOptions) -> anyhow::Result<()> {
    let report: AllocationReport = read_json_input(&options.input_path)?;
    let updated_at = Utc::now();
    // Validated before the store is touched, so a corrupted report cannot clobber a good epoch
    // on its way to failing.
    let records = report_records(&report, updated_at).map_err(CliError::critical)?;
    let stored_rows = records.len();

    let directory = Directory::new(&options.directory_url, &options.directory_token);
    let current = directory
        .get::<AllocationDocument>(ALLOCATION_PATH)
        .await
        .map_err(http_transient)?;
    let (mut document, precondition) = match current {
        Some(current) => (current.body, Precondition::IfMatch(current.etag)),
        None => (AllocationDocument::default(), Precondition::Create),
    };
    document.epochs.insert(
        report.epoch,
        AllocationRun {
            slot: report.slot,
            updated_at,
            records,
        },
    );
    directory
        .put(ALLOCATION_PATH, &document, precondition)
        .await
        .map_err(http_transient)?;

    log::info!(
        "Stored {stored_rows} direct staking allocation records for epoch {} at {ALLOCATION_PATH}",
        report.epoch
    );
    Ok(())
}

#[cfg(test)]
#[path = "direct_staking_allocation_test.rs"]
mod direct_staking_allocation_test;
