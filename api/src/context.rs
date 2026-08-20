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
    pub v1_body: Bytes,
    pub legacy_body: Bytes,
}

impl ProtectedEvents {
    pub fn new(records: Vec<ProtectedEventRecord>) -> anyhow::Result<Self> {
        let legacy = LegacyProtectedEventsResponse {
            protected_events: legacy_projection(&records),
        };
        let legacy_body = Bytes::from(serde_json::to_vec(&legacy)?);
        let v1 = ProtectedEventsResponse {
            protected_events: records,
        };
        let v1_body = Bytes::from(serde_json::to_vec(&v1)?);
        Ok(Self {
            records: v1.protected_events,
            v1_body,
            legacy_body,
        })
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
