use gcp_bigquery_client::model::query_request::QueryRequest;
use solana_sdk::pubkey::Pubkey;
use std::{str::FromStr, sync::Arc, time::Duration};
use tokio::{sync::RwLock, time::sleep};

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
                "select epoch, vote_account, sum(amount) amount, meta, reason from `mainnet_beta_stakes.psr_settlements` where epoch >= {} group by epoch, vote_account, meta, reason order by epoch desc;",
                from_epoch
            )),
        )
        .await?;

    let mut protected_events = vec![];
    while rs.next_row() {
        protected_events.push(ProtectedEventRecord {
            epoch: rs.get_i64_by_name("epoch")?.unwrap().try_into()?,
            amount: rs.get_i64_by_name("amount")?.unwrap().try_into()?,
            vote_account: Pubkey::from_str(&rs.get_string_by_name("vote_account")?.unwrap())?,
            meta: serde_json::from_str(&rs.get_string_by_name("meta")?.unwrap())?,
            reason: serde_json::from_str(&rs.get_string_by_name("reason")?.unwrap())?,
        });
    }

    Ok(protected_events)
}

pub async fn spawn_protected_events_cache(
    gcp_sa_key: String,
    project_id: String,
    protected_events: Arc<RwLock<Vec<ProtectedEventRecord>>>,
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
    protected_events: Arc<RwLock<Vec<ProtectedEventRecord>>>,
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
                    protected_events
                        .write()
                        .await
                        .clone_from(&updated_protected_events);
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
    protected_events: Arc<RwLock<Vec<ProtectedEventRecord>>>,
) {
    tokio::spawn(async move {
        loop {
            let max_loaded_epoch = protected_events
                .read()
                .await
                .iter()
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
                        .filter(|protected_event| protected_event.epoch < max_loaded_epoch)
                        .chain(updated_protected_events.iter())
                        .cloned()
                        .collect();

                    protected_events
                        .write()
                        .await
                        .clone_from(&merged_protected_events);

                    log::info!("Successfully extended the protected events");
                }
                Err(err) => log::error!("Failed to get the protected events: {err}"),
            };

            sleep(CACHE_UPDATE_INTERVAL).await;
        }
    });
}
