use axum::body::Bytes;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_postgres::Client;

use crate::dto::{
    legacy_projection, LegacyProtectedEventsResponse, ProtectedEventRecord, ProtectedEventsResponse,
};

/// `None` until a BigQuery fetch has succeeded once. Distinguishes "never loaded" from an epoch
/// that genuinely settled nothing, which the handlers answer as 500 and 200 respectively.
pub type ProtectedEventsCache = Arc<RwLock<Option<ProtectedEvents>>>;

/// Both endpoints answer the whole feed, so the bodies are rendered per refresh instead of per
/// request. `records` stays for the incremental refresh and for the `from_epoch` windows.
pub struct ProtectedEvents {
    pub records: Vec<ProtectedEventRecord>,
    pub min_epoch: Option<u64>,
    pub v1_body: Bytes,
    pub legacy_body: Bytes,
}

impl ProtectedEvents {
    pub fn new(mut records: Vec<ProtectedEventRecord>) -> anyhow::Result<Self> {
        // The refresh appends the fresh block to the older one; unsorted, the feed jumps back up.
        records.sort_by(|left, right| right.epoch.cmp(&left.epoch));
        let legacy = LegacyProtectedEventsResponse {
            protected_events: legacy_projection(&records),
        };
        let legacy_body = Bytes::from(serde_json::to_vec(&legacy)?);
        let min_epoch = records.iter().map(|record| record.epoch).min();
        let v1 = ProtectedEventsResponse {
            protected_events: records,
        };
        let v1_body = Bytes::from(serde_json::to_vec(&v1)?);
        Ok(Self {
            records: v1.protected_events,
            min_epoch,
            v1_body,
            legacy_body,
        })
    }

    /// Whether the window drops a record, so a window reaching the whole feed can answer from the
    /// rendered body.
    pub fn narrows(&self, from_epoch: u64) -> bool {
        self.min_epoch
            .is_some_and(|min_epoch| from_epoch > min_epoch)
    }
}

pub struct Context {
    pub psql_client: Client,
    pub protected_events_records: ProtectedEventsCache,
    pub verified_validators: Vec<String>,
}

impl Context {
    pub fn new(
        psql_client: Client,
        protected_events_records: ProtectedEventsCache,
        verified_validators: Vec<String>,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            psql_client,
            protected_events_records,
            verified_validators,
        })
    }
}

pub type WrappedContext = Arc<RwLock<Context>>;
