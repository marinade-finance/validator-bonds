use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_postgres::Client;

use crate::dto::ProtectedEventRecord;

pub struct Context {
    pub psql_client: Client,
    pub protected_events_records: Arc<RwLock<Vec<ProtectedEventRecord>>>,
    pub verified_validators: Vec<String>,
}

impl Context {
    pub fn new(
        psql_client: Client,
        protected_events_records: Arc<RwLock<Vec<ProtectedEventRecord>>>,
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
