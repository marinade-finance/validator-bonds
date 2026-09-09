use super::common::{pg_transient, CommonStoreOptions};

use chrono::{DateTime, Utc};
use openssl::ssl::{SslConnector, SslMethod};
use postgres_openssl::MakeTlsConnector;
use rust_decimal::Decimal;
use std::str::FromStr;
use tokio_postgres::{types::ToSql, Client, Row, Transaction};
use validator_bonds_common::allocation::AllocationReport;
use validator_bonds_common::cli_result::CliError;
use validator_bonds_common::dto::{AllocationOutcome, BondType, DirectStakingAllocationRecord};

const OUTCOME_ROUTED: &str = "routed";
const OUTCOME_DROPPED: &str = "dropped";

/// The report quotes its amounts as decimal strings so BigQuery ingests them into NUMERIC exactly.
/// An unparsable one is a corrupted report, never a zero: defaulting would publish a validator as
/// having no bond when it has one.
fn parse_amount(raw: &str, vote_account: &str, field: &str) -> anyhow::Result<Decimal> {
    Decimal::from_str(raw).map_err(|error| {
        anyhow::anyhow!("{field} '{raw}' of vote account {vote_account} is not a decimal: {error}")
    })
}

/// The report's per-epoch header is stamped onto every row, and `updated_at` is the store's own —
/// the report carries no timestamp.
fn report_records(
    report: &AllocationReport,
    updated_at: DateTime<Utc>,
) -> anyhow::Result<Vec<DirectStakingAllocationRecord>> {
    let mut records = Vec::with_capacity(report.routed.len() + report.dropped_no_usable_bond.len());

    for routed in &report.routed {
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

/// `exposure_bps` is a `u64` that the allocator sets to `u64::MAX` when the bond is empty, which no
/// `BIGINT` can hold. Routing never selects an empty bond, so this converts rather than clamps —
/// a failure here means the report broke that invariant and must not be stored quietly.
fn sql_params(
    record: &DirectStakingAllocationRecord,
) -> anyhow::Result<Vec<Box<dyn ToSql + Sync + Send>>> {
    let (outcome, bond_type, effective, exposure, bidding, institutional) = match &record.outcome {
        AllocationOutcome::Routed {
            bond_type,
            effective_amount,
            exposure_bps,
        } => (
            OUTCOME_ROUTED,
            Some(bond_type.as_str().to_string()),
            Some(*effective_amount),
            Some(i64::try_from(*exposure_bps)?),
            None,
            None,
        ),
        AllocationOutcome::Dropped {
            bidding_effective_amount,
            institutional_effective_amount,
        } => (
            OUTCOME_DROPPED,
            None,
            None,
            None,
            Some(*bidding_effective_amount),
            Some(*institutional_effective_amount),
        ),
    };

    Ok(vec![
        Box::new(i32::try_from(record.epoch)?),
        Box::new(i64::try_from(record.slot)?),
        Box::new(record.vote_account.clone()),
        Box::new(outcome.to_string()),
        Box::new(bond_type),
        Box::new(i32::try_from(record.settlements)?),
        Box::new(i64::try_from(record.claims_amount)?),
        Box::new(effective),
        Box::new(exposure),
        Box::new(bidding),
        Box::new(institutional),
        Box::new(record.bidding_bonds_epoch.map(i32::try_from).transpose()?),
        Box::new(
            record
                .institutional_bonds_epoch
                .map(i32::try_from)
                .transpose()?,
        ),
        Box::new(record.updated_at),
    ])
}

/// Rebuilt through `AllocationOutcome`, so a row whose nullable columns disagree with its `outcome`
/// fails the request instead of being published as a half-filled record. The table's CHECK
/// constraints enforce the same invariant on the way in.
fn map_allocation_row(row: Row) -> anyhow::Result<DirectStakingAllocationRecord> {
    let vote_account: String = row.get("vote_account");
    let outcome: String = row.get("outcome");

    let missing = |column: &str| {
        anyhow::anyhow!("{outcome} row of vote account {vote_account} has no {column}")
    };

    let outcome = match outcome.as_str() {
        OUTCOME_ROUTED => AllocationOutcome::Routed {
            bond_type: BondType::parse_from_str(
                &row.get::<_, Option<String>>("bond_type")
                    .ok_or_else(|| missing("bond_type"))?,
            )?,
            effective_amount: row
                .get::<_, Option<Decimal>>("effective_amount")
                .ok_or_else(|| missing("effective_amount"))?,
            exposure_bps: row
                .get::<_, Option<i64>>("exposure_bps")
                .ok_or_else(|| missing("exposure_bps"))?
                .try_into()?,
        },
        OUTCOME_DROPPED => {
            anyhow::ensure!(
                row.get::<_, Option<String>>("bond_type").is_none(),
                "dropped row of vote account {vote_account} carries a bond type"
            );
            AllocationOutcome::Dropped {
                bidding_effective_amount: row
                    .get::<_, Option<Decimal>>("bidding_effective_amount")
                    .ok_or_else(|| missing("bidding_effective_amount"))?,
                institutional_effective_amount: row
                    .get::<_, Option<Decimal>>("institutional_effective_amount")
                    .ok_or_else(|| missing("institutional_effective_amount"))?,
            }
        }
        unknown => anyhow::bail!("Unknown allocation outcome: {unknown}"),
    };

    Ok(DirectStakingAllocationRecord {
        epoch: row.get::<_, i32>("epoch").try_into()?,
        slot: row.get::<_, i64>("slot").try_into()?,
        vote_account,
        settlements: row.get::<_, i32>("settlements").try_into()?,
        claims_amount: row.get::<_, i64>("claims_amount").try_into()?,
        bidding_bonds_epoch: row
            .get::<_, Option<i32>>("bidding_bonds_epoch")
            .map(u64::try_from)
            .transpose()?,
        institutional_bonds_epoch: row
            .get::<_, Option<i32>>("institutional_bonds_epoch")
            .map(u64::try_from)
            .transpose()?,
        outcome,
        updated_at: row.get("updated_at"),
    })
}

/// `from_epoch` only, matching `/v1/protected-events`: one row per validator per epoch does not
/// justify a window cap.
pub async fn get_direct_staking_allocation(
    psql_client: &Client,
    from_epoch: Option<u64>,
) -> anyhow::Result<Vec<DirectStakingAllocationRecord>> {
    let from_epoch = from_epoch.map(i32::try_from).transpose()?.unwrap_or(0);
    let rows = psql_client
        .query(
            "SELECT epoch, slot, vote_account, outcome, bond_type, settlements, claims_amount,
                    effective_amount, exposure_bps, bidding_effective_amount,
                    institutional_effective_amount, bidding_bonds_epoch, institutional_bonds_epoch,
                    updated_at
             FROM direct_staking_allocation
             WHERE epoch >= $1
             ORDER BY epoch DESC, vote_account",
            &[&from_epoch],
        )
        .await?;

    rows.into_iter().map(map_allocation_row).collect()
}

/// Distinguishes "no report has ever been stored" from "the requested window is empty". The first
/// must not answer with an empty list, which reads as "nobody was left unprotected".
pub async fn get_latest_allocation_epoch(psql_client: &Client) -> anyhow::Result<Option<u64>> {
    let row = psql_client
        .query_one(
            "SELECT MAX(epoch) AS epoch FROM direct_staking_allocation",
            &[],
        )
        .await?;
    row.get::<_, Option<i32>>("epoch")
        .map(|epoch| Ok(u64::try_from(epoch)?))
        .transpose()
}

/// Errors are raised as `CliError`, because `CliResult` logs only what downcasts to one — a bare
/// `anyhow::Error` exits 1 with nothing printed, leaving Buildkite showing a failure with no reason.
/// Critical, not retry-able: re-reading a corrupted report cannot fix it.
fn read_report(input_path: &str) -> anyhow::Result<AllocationReport> {
    let input = std::fs::File::open(input_path).map_err(|error| {
        CliError::critical(anyhow::anyhow!(
            "Failed to open allocation report {input_path}: {error}"
        ))
    })?;
    serde_json::from_reader(input).map_err(|error| {
        CliError::critical(anyhow::anyhow!(
            "Failed to parse allocation report {input_path}: {error}"
        ))
        .into()
    })
}

/// The whole epoch is replaced in one transaction, so a re-run stays idempotent and cannot leave a
/// validator the allocator no longer reports. Separated from the connection setup so the SQL itself
/// is reachable from `api/tests/direct_staking_allocation_queries.rs` without TLS.
pub async fn replace_epoch_allocation(
    tx: &Transaction<'_>,
    epoch: i32,
    records: &[DirectStakingAllocationRecord],
) -> anyhow::Result<()> {
    const CHUNK_SIZE: usize = 512;
    const PARAMS_PER_INSERT: usize = 14;

    tx.execute(
        "DELETE FROM direct_staking_allocation WHERE epoch = $1",
        &[&epoch],
    )
    .await
    .map_err(pg_transient)?;

    for chunk in records.chunks(CHUNK_SIZE) {
        let mut param_index = 1;
        let mut params: Vec<Box<dyn ToSql + Sync + Send>> = Vec::new();
        let mut insert_values = String::new();

        for record in chunk {
            let placeholders = (param_index..param_index + PARAMS_PER_INSERT)
                .map(|index| format!("${index}"))
                .collect::<Vec<_>>()
                .join(", ");
            insert_values.push_str(&format!("({placeholders}),"));
            param_index += PARAMS_PER_INSERT;

            params.extend(sql_params(record)?);
        }

        insert_values.pop();

        let query = format!(
            "
            INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, bond_type, settlements, claims_amount, effective_amount, exposure_bps, bidding_effective_amount, institutional_effective_amount, bidding_bonds_epoch, institutional_bonds_epoch, updated_at)
            VALUES {insert_values}
            "
        );

        let params = params
            .iter()
            .map(|param| param.as_ref() as &(dyn ToSql + Sync))
            .collect::<Vec<_>>();
        tx.query(&query, &params).await.map_err(pg_transient)?;
    }

    Ok(())
}

pub async fn store_direct_staking_allocation(options: CommonStoreOptions) -> anyhow::Result<()> {
    let report = read_report(&options.input_path)?;
    let epoch = i32::try_from(report.epoch).map_err(CliError::critical)?;
    // Deliberately not rejected the way an empty collected-stake file is: epoch 1020 was the first
    // direct-staking run and routed nothing at all. The report's presence in GCS is the record that
    // it ran, so zero rows for the epoch is a legitimate outcome. Validated before connecting, so a
    // corrupted report cannot delete a good epoch on its way to failing.
    let records = report_records(&report, Utc::now()).map_err(CliError::critical)?;

    let mut builder = SslConnector::builder(SslMethod::tls())?;
    builder.set_ca_file(&options.postgres_ssl_root_cert)?;
    let connector = MakeTlsConnector::new(builder.build());

    let (mut psql_client, psql_conn) = tokio_postgres::connect(&options.postgres_url, connector)
        .await
        .map_err(pg_transient)?;
    tokio::spawn(async move {
        if let Err(err) = psql_conn.await {
            log::error!("PSQL connection terminated: {err}");
        }
    });

    let tx = psql_client.transaction().await.map_err(pg_transient)?;
    replace_epoch_allocation(&tx, epoch, &records).await?;
    tx.commit().await.map_err(pg_transient)?;

    log::info!(
        "Stored {} direct staking allocation records for epoch {epoch}",
        records.len()
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use validator_bonds_common::allocation::{DroppedValidator, ReportTotals, RoutedValidator};

    fn stamp() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 8, 12, 0, 0).unwrap()
    }

    fn totals() -> ReportTotals {
        ReportTotals {
            settlements_in: 0,
            claims_amount_in: 0,
            bidding_settlements: 0,
            bidding_claims_amount: 0,
            institutional_settlements: 0,
            institutional_claims_amount: 0,
            dropped_settlements: 0,
            dropped_claims_amount: 0,
        }
    }

    fn report(routed: Vec<RoutedValidator>, dropped: Vec<DroppedValidator>) -> AllocationReport {
        AllocationReport {
            epoch: 1030,
            slot: 445_356_003,
            totals: totals(),
            routed,
            dropped_no_usable_bond: dropped,
            exposure_warnings: vec![],
            bidding_bonds_epoch: Some(1030),
            institutional_bonds_epoch: None,
        }
    }

    fn routed(effective_amount: &str) -> RoutedValidator {
        RoutedValidator {
            vote_account: "voteR".to_string(),
            bond_type: "bidding".to_string(),
            settlements: 2,
            claims_amount: 37_316_490,
            effective_amount: effective_amount.to_string(),
            exposure_bps: 75,
        }
    }

    fn dropped(bidding: &str, institutional: &str) -> DroppedValidator {
        DroppedValidator {
            vote_account: "voteD".to_string(),
            settlements: 1,
            claims_amount: 1_000,
            bidding_effective_amount: bidding.to_string(),
            institutional_effective_amount: institutional.to_string(),
        }
    }

    #[test]
    fn a_routed_validator_keeps_its_bond_and_the_report_header() {
        let records = report_records(&report(vec![routed("5000000000")], vec![]), stamp()).unwrap();
        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(
            (
                record.epoch,
                record.slot,
                record.settlements,
                record.claims_amount,
                record.bidding_bonds_epoch,
                record.institutional_bonds_epoch,
                record.updated_at,
            ),
            (1030, 445_356_003, 2, 37_316_490, Some(1030), None, stamp())
        );
        match &record.outcome {
            AllocationOutcome::Routed {
                bond_type,
                effective_amount,
                exposure_bps,
            } => {
                assert_eq!(bond_type.as_str(), "bidding");
                assert_eq!(*effective_amount, Decimal::from(5_000_000_000u64));
                assert_eq!(*exposure_bps, 75);
            }
            other => panic!("expected a routed outcome, got {other:?}"),
        }
    }

    #[test]
    fn a_dropped_validator_carries_both_amounts_and_no_bond() {
        let records = report_records(&report(vec![], vec![dropped("0", "0")]), stamp()).unwrap();
        assert_eq!(records.len(), 1);
        match &records[0].outcome {
            AllocationOutcome::Dropped {
                bidding_effective_amount,
                institutional_effective_amount,
            } => {
                assert_eq!(*bidding_effective_amount, Decimal::ZERO);
                assert_eq!(*institutional_effective_amount, Decimal::ZERO);
            }
            other => panic!("expected a dropped outcome, got {other:?}"),
        }
    }

    #[test]
    fn both_buckets_become_rows() {
        let records =
            report_records(&report(vec![routed("1")], vec![dropped("0", "0")]), stamp()).unwrap();
        assert_eq!(
            records
                .iter()
                .map(|record| record.vote_account.as_str())
                .collect::<Vec<_>>(),
            vec!["voteR", "voteD"]
        );
    }

    #[test]
    fn a_report_that_routed_nothing_stores_nothing() {
        assert!(report_records(&report(vec![], vec![]), stamp())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_fractional_amount_keeps_its_precision() {
        let records =
            report_records(&report(vec![routed("0.000000001")], vec![]), stamp()).unwrap();
        match &records[0].outcome {
            AllocationOutcome::Routed {
                effective_amount, ..
            } => assert_eq!(effective_amount.to_string(), "0.000000001"),
            other => panic!("expected a routed outcome, got {other:?}"),
        }
    }

    #[test]
    fn an_unparsable_amount_is_rejected_not_defaulted() {
        let error = report_records(&report(vec![routed("not-a-number")], vec![]), stamp())
            .unwrap_err()
            .to_string();
        assert!(error.contains("effective_amount"), "{error}");
        assert!(error.contains("voteR"), "{error}");
    }

    #[test]
    fn an_unparsable_dropped_amount_is_rejected_too() {
        let error = report_records(&report(vec![], vec![dropped("0", "junk")]), stamp())
            .unwrap_err()
            .to_string();
        assert!(error.contains("institutional_effective_amount"), "{error}");
    }

    #[test]
    fn an_unknown_bond_type_is_rejected() {
        let mut broken = routed("1");
        broken.bond_type = "sideways".to_string();
        let error = report_records(&report(vec![broken], vec![]), stamp())
            .unwrap_err()
            .to_string();
        assert!(error.contains("Unknown bond type"), "{error}");
    }

    #[test]
    fn every_row_binds_exactly_the_documented_column_count() {
        let records =
            report_records(&report(vec![routed("1")], vec![dropped("0", "0")]), stamp()).unwrap();
        for record in &records {
            assert_eq!(sql_params(record).unwrap().len(), 14);
        }
    }

    // The allocator's sentinel for an empty bond. Routing cannot select one, so reaching the store
    // means the report broke that invariant, and a silent wrap into BIGINT would hide it.
    #[test]
    fn an_impossible_exposure_is_rejected_rather_than_wrapped() {
        let mut impossible = routed("1");
        impossible.exposure_bps = u64::MAX;
        let records = report_records(&report(vec![impossible], vec![]), stamp()).unwrap();
        sql_params(&records[0]).unwrap_err();
    }

    #[test]
    fn a_missing_report_is_reported_as_critical() {
        let error = read_report("/nonexistent/allocation-report.json").unwrap_err();
        assert!(error.to_string().contains("Failed to open"), "{error}");
        assert!(
            matches!(
                error.downcast_ref::<CliError>(),
                Some(CliError::Critical(_))
            ),
            "a bare anyhow error would exit 1 with nothing logged",
        );
    }

    #[test]
    fn a_malformed_report_is_reported_as_critical() {
        let path = std::env::temp_dir().join("validator-bonds-malformed-allocation.json");
        std::fs::write(&path, b"{ not json").unwrap();
        let error = read_report(path.to_str().unwrap()).unwrap_err();
        std::fs::remove_file(&path).unwrap();
        assert!(error.to_string().contains("Failed to parse"), "{error}");
        assert!(
            matches!(
                error.downcast_ref::<CliError>(),
                Some(CliError::Critical(_))
            ),
            "a corrupted report must be logged, and must not be retried",
        );
    }
}
