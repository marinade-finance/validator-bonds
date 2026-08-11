use gcp_bigquery_client::model::query_request::QueryRequest;
use solana_sdk::pubkey::Pubkey;
use std::{str::FromStr, time::Duration};
use tokio::time::sleep;
use validator_bonds_common::dto::BondType;

use crate::context::ProtectedEventsCache;
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
    let mut skipped = 0usize;
    while rs.next_row() {
        match parse_row(&rs) {
            Ok(record) => protected_events.push(record),
            Err(err) => {
                skipped += 1;
                log::error!("Skipping unparseable protected_events row: {err}");
            }
        }
    }
    if skipped > 0 {
        log::warn!("Skipped {skipped} unparseable protected_events row(s)");
    }

    Ok(protected_events)
}

fn parse_row(
    rs: &gcp_bigquery_client::model::query_response::ResultSet,
) -> anyhow::Result<ProtectedEventRecord> {
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
                    *protected_events.write().await = Some(updated_protected_events);
                    log::info!("Protected Events completely updated");
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
                .flatten()
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
                        .flatten()
                        .filter(|protected_event| protected_event.epoch < max_loaded_epoch)
                        .chain(updated_protected_events.iter())
                        .cloned()
                        .collect();

                    *protected_events.write().await = Some(merged_protected_events);

                    log::info!("Successfully extended the protected events");
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

    // A null would reach the API as a dropped row, not an error, so the parse has to reject it.
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
}
