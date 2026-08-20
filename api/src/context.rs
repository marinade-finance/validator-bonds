use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_postgres::Client;

use crate::dto::ProtectedEventRecord;

/// `None` until a BigQuery fetch has succeeded once. Distinguishes "never loaded" from an epoch
/// that genuinely settled nothing, which the handlers answer as 500 and 200 respectively.
pub type ProtectedEventsCache = Arc<RwLock<Option<Vec<ProtectedEventRecord>>>>;

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
