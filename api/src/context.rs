use std::sync::Arc;
use tokio::sync::RwLock;
use validator_bonds_common::directory::Directory;

use crate::dto::ProtectedEventRecord;

pub struct Context {
    pub directory: Directory,
    pub protected_events_records: Arc<RwLock<Vec<ProtectedEventRecord>>>,
    pub verified_validators: Vec<String>,
}

impl Context {
    pub fn new(
        directory: Directory,
        protected_events_records: Arc<RwLock<Vec<ProtectedEventRecord>>>,
        verified_validators: Vec<String>,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            directory,
            protected_events_records,
            verified_validators,
        })
    }
}

pub type WrappedContext = Arc<RwLock<Context>>;
