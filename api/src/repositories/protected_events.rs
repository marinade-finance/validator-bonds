use gcp_bigquery_client::model::get_query_results_parameters::GetQueryResultsParameters;
use gcp_bigquery_client::model::query_request::QueryRequest;
use gcp_bigquery_client::model::query_response::ResultSet;
use solana_sdk::pubkey::Pubkey;
use std::{str::FromStr, time::Duration};
use tokio::time::sleep;
use validator_bonds_common::dto::BondType;

use crate::context::{ProtectedEvents, ProtectedEventsCache};
use crate::dto::ProtectedEventRecord;

const CACHE_UPDATE_INTERVAL: Duration = Duration::from_secs(3600);
const CACHE_PURGE_INTERVAL: Duration = Duration::from_secs(24 * 3600);

async fn get_protected_events(
    gcp_sa_key: &str,
    project_id: &str,
    from_epoch: u64,
) -> anyhow::Result<Vec<ProtectedEventRecord>> {
    log::info!("Fetching protected events from epoch {from_epoch}...");
    let client = gcp_bigquery_client::Client::from_service_account_key_file(gcp_sa_key).await?;

    let mut rs = client
        .job()
        .query(
            project_id,
            QueryRequest::new(format!(
                "select epoch, vote_account, sum(amount) amount, meta, reason, bond_type, product from ( \
                   select epoch, vote_account, amount, meta, reason, 'bidding' bond_type, product from `mainnet_beta_stakes.psr_settlements` where epoch >= {from_epoch} \
                   union all \
                   select epoch, vote_account, amount, meta, reason, 'institutional' bond_type, product from `mainnet_beta_stakes.institutional_settlements` where epoch >= {from_epoch} \
                 ) group by epoch, vote_account, meta, reason, bond_type, product order by epoch desc;"
            )),
        )
        .await?;

    let mut protected_events = vec![];
    loop {
        // Fail the whole fetch, never a row: a dropped row reads as "this validator owes nothing".
        while rs.next_row() {
            protected_events.push(parse_row(&rs)?);
        }
        let Some(page_token) = rs.query_response().page_token.clone() else {
            break;
        };
        let job = rs
            .query_response()
            .job_reference
            .clone()
            .ok_or_else(|| anyhow::anyhow!("BigQuery paged the results but named no job"))?;
        let job_id = job
            .job_id
            .ok_or_else(|| anyhow::anyhow!("BigQuery job reference carries no job id"))?;
        let results = client
            .job()
            .get_query_results(
                project_id,
                &job_id,
                GetQueryResultsParameters {
                    page_token: Some(page_token),
                    // mandatory outside US and EU, and the queried dataset is europe-central2
                    location: job.location,
                    ..Default::default()
                },
            )
            .await?;
        rs = ResultSet::new(results.into());
    }
    ensure_all_rows_loaded(&rs, protected_events.len())?;

    Ok(protected_events)
}

// `jobs.query` answers with one page and stops; a short read reads as "no validator owes anything".
fn ensure_all_rows_loaded(rs: &ResultSet, loaded: usize) -> anyhow::Result<()> {
    let response = rs.query_response();
    anyhow::ensure!(
        response.job_complete.unwrap_or(false),
        "BigQuery job has not completed, {loaded} rows read so far"
    );
    let total_rows: usize = response
        .total_rows
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("BigQuery reported no total row count"))?
        .parse()?;
    anyhow::ensure!(
        loaded == total_rows,
        "Read {loaded} of {total_rows} rows BigQuery reports"
    );
    Ok(())
}

fn parse_row(rs: &ResultSet) -> anyhow::Result<ProtectedEventRecord> {
    Ok(ProtectedEventRecord {
        epoch: rs
            .get_i64_by_name("epoch")?
            .ok_or_else(|| anyhow::anyhow!("missing epoch"))?
            .try_into()?,
        amount: rs
            .get_i64_by_name("amount")?
            .ok_or_else(|| anyhow::anyhow!("missing amount"))?
            .try_into()?,
        vote_account: Pubkey::from_str(
            &rs.get_string_by_name("vote_account")?
                .ok_or_else(|| anyhow::anyhow!("missing vote_account"))?,
        )?,
        meta: serde_json::from_str(
            &rs.get_string_by_name("meta")?
                .ok_or_else(|| anyhow::anyhow!("missing meta"))?,
        )?,
        reason: serde_json::from_str(
            &rs.get_string_by_name("reason")?
                .ok_or_else(|| anyhow::anyhow!("missing reason"))?,
        )?,
        bond_type: BondType::parse_from_str(
            &rs.get_string_by_name("bond_type")?
                .ok_or_else(|| anyhow::anyhow!("missing bond_type"))?,
        )?,
        // Hard requirement, not a default: stakes-etl stamps every loaded row, so a null here means
        // the column was never backfilled and guessing one would misattribute the settlement.
        product: rs
            .get_string_by_name("product")?
            .ok_or_else(|| anyhow::anyhow!("missing product"))?,
    })
}

pub async fn spawn_protected_events_cache(
    gcp_sa_key: String,
    project_id: String,
    protected_events: ProtectedEventsCache,
) {
    spawn_protected_events_cache_purger(
        gcp_sa_key.clone(),
        project_id.clone(),
        protected_events.clone(),
    );
    spawn_protected_events_cache_updater(
        gcp_sa_key.clone(),
        project_id.clone(),
        protected_events.clone(),
    );
}
pub fn spawn_protected_events_cache_purger(
    gcp_sa_key: String,
    project_id: String,
    protected_events: ProtectedEventsCache,
) {
    tokio::spawn(async move {
        loop {
            sleep(CACHE_PURGE_INTERVAL).await;

            match get_protected_events(&gcp_sa_key, &project_id, 0).await {
                Ok(updated_protected_events) => {
                    log::info!(
                        "Successfully fetched the protected events ({})",
                        updated_protected_events.len()
                    );
                    match ProtectedEvents::new(updated_protected_events) {
                        Ok(events) => {
                            *protected_events.write().await = Some(events);
                            log::info!("Protected Events completely updated");
                        }
                        Err(err) => {
                            log::error!("Failed to render the protected events: {err}")
                        }
                    }
                }
                Err(err) => log::error!("Failed to get the protected events: {err}"),
            };
        }
    });
}
pub fn spawn_protected_events_cache_updater(
    gcp_sa_key: String,
    project_id: String,
    protected_events: ProtectedEventsCache,
) {
    tokio::spawn(async move {
        loop {
            let max_loaded_epoch = protected_events
                .read()
                .await
                .iter()
                .flat_map(|events| &events.records)
                .fold(0, |max_loaded_epoch, protected_event| {
                    protected_event.epoch.max(max_loaded_epoch)
                });

            match get_protected_events(&gcp_sa_key, &project_id, max_loaded_epoch).await {
                Ok(updated_protected_events) => {
                    log::info!(
                        "Successfully fetched the protected events ({}) from epoch: {max_loaded_epoch}",
                        updated_protected_events.len()
                    );

                    let merged_protected_events: Vec<_> = protected_events
                        .read()
                        .await
                        .iter()
                        .flat_map(|events| &events.records)
                        .filter(|protected_event| protected_event.epoch < max_loaded_epoch)
                        .chain(updated_protected_events.iter())
                        .cloned()
                        .collect();

                    match ProtectedEvents::new(merged_protected_events) {
                        Ok(events) => {
                            *protected_events.write().await = Some(events);
                            log::info!("Successfully extended the protected events");
                        }
                        Err(err) => {
                            log::error!("Failed to render the protected events: {err}")
                        }
                    }
                }
                Err(err) => log::error!("Failed to get the protected events: {err}"),
            };

            sleep(CACHE_UPDATE_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use gcp_bigquery_client::model::{
        query_response::{QueryResponse, ResultSet},
        table_cell::TableCell,
        table_field_schema::TableFieldSchema,
        table_row::TableRow,
        table_schema::TableSchema,
    };
    use settlement_common::settlement_collection::{
        SettlementFunder, SettlementMeta, SettlementReason,
    };

    const VOTE_ACCOUNT: &str = "We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb";

    // BigQuery hands every cell over as a JSON string, nulls included, so the fixture does too.
    fn result_set(overrides: &[(&str, Option<&str>)]) -> ResultSet {
        let meta = serde_json::to_string(&SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        })
        .unwrap();
        let reason = serde_json::to_string(&SettlementReason::Bidding).unwrap();
        let mut cells: Vec<(&str, Option<String>)> = vec![
            ("epoch", Some("1013".to_string())),
            ("vote_account", Some(VOTE_ACCOUNT.to_string())),
            ("amount", Some("37316490".to_string())),
            ("meta", Some(meta)),
            ("reason", Some(reason)),
            ("bond_type", Some("bidding".to_string())),
            ("product", Some("single-validator".to_string())),
        ];
        for (name, value) in overrides {
            let cell = cells
                .iter_mut()
                .find(|(cell_name, _)| cell_name == name)
                .unwrap_or_else(|| panic!("{name} is not a column of the fixture"));
            cell.1 = value.map(str::to_string);
        }

        let mut rs = ResultSet::new(QueryResponse {
            job_complete: Some(true),
            total_rows: Some(cells.len().to_string()),
            schema: Some(TableSchema::new(
                cells
                    .iter()
                    .map(|(name, _)| TableFieldSchema::string(name))
                    .collect(),
            )),
            rows: Some(vec![TableRow {
                columns: Some(
                    cells
                        .iter()
                        .map(|(_, value)| TableCell {
                            value: value.as_ref().map(|v| serde_json::Value::String(v.clone())),
                        })
                        .collect(),
                ),
            }]),
            ..Default::default()
        });
        assert!(rs.next_row(), "fixture must hold exactly one row");
        rs
    }

    #[test]
    fn a_complete_row_carries_both_settlement_dimensions() {
        let record = parse_row(&result_set(&[])).unwrap();
        assert_eq!(record.epoch, 1013);
        assert_eq!(record.amount, 37316490);
        assert_eq!(record.bond_type.as_str(), "bidding");
        assert_eq!(record.product, "single-validator");
    }

    #[test]
    fn a_row_without_a_product_is_rejected() {
        let err = parse_row(&result_set(&[("product", None)])).unwrap_err();
        assert!(err.to_string().contains("missing product"));
    }

    #[test]
    fn a_row_with_an_unknown_bond_type_is_rejected() {
        let err = parse_row(&result_set(&[("bond_type", Some("direct"))])).unwrap_err();
        assert!(err.to_string().contains("Unknown bond type"));
    }

    fn last_page(job_complete: Option<bool>, total_rows: Option<&str>) -> ResultSet {
        ResultSet::new(QueryResponse {
            job_complete,
            total_rows: total_rows.map(str::to_string),
            schema: Some(TableSchema::new(vec![TableFieldSchema::string("epoch")])),
            rows: Some(vec![]),
            ..Default::default()
        })
    }

    #[test]
    fn reading_every_row_bigquery_reports_is_accepted() {
        ensure_all_rows_loaded(&last_page(Some(true), Some("63917")), 63917).unwrap();
    }

    #[test]
    fn an_empty_result_is_accepted() {
        ensure_all_rows_loaded(&last_page(Some(true), Some("0")), 0).unwrap();
    }

    #[test]
    fn a_truncated_read_is_rejected() {
        let err = ensure_all_rows_loaded(&last_page(Some(true), Some("63917")), 50000).unwrap_err();
        assert_eq!(err.to_string(), "Read 50000 of 63917 rows BigQuery reports");
    }

    #[test]
    fn an_unfinished_job_is_rejected() {
        let err = ensure_all_rows_loaded(&last_page(Some(false), None), 0).unwrap_err();
        assert_eq!(
            err.to_string(),
            "BigQuery job has not completed, 0 rows read so far"
        );
    }

    #[test]
    fn a_result_without_a_completion_flag_is_rejected() {
        let err = ensure_all_rows_loaded(&last_page(None, Some("1")), 1).unwrap_err();
        assert_eq!(
            err.to_string(),
            "BigQuery job has not completed, 1 rows read so far"
        );
    }

    #[test]
    fn a_result_without_a_total_row_count_is_rejected() {
        let err = ensure_all_rows_loaded(&last_page(Some(true), None), 10).unwrap_err();
        assert_eq!(err.to_string(), "BigQuery reported no total row count");
    }
}
