use axum::body::Bytes;
use serde::Serialize;
use std::{cmp::Reverse, sync::Arc};
use tokio::sync::RwLock;
use tokio_postgres::Client;

use crate::dto::{legacy_projection, ProtectedEventRecord};

/// `None` until a BigQuery fetch has succeeded once. Distinguishes "never loaded" from an epoch
/// that genuinely settled nothing, which the handlers answer as 500 and 200 respectively.
pub type ProtectedEventsCache = Arc<RwLock<Option<ProtectedEvents>>>;

// The envelope is written by hand so the epoch offsets can be taken as the records go in;
// `the_bodies_match_the_serde_rendering_of_the_response_dtos` pins it to the documented DTOs.
const BODY_PREFIX: &[u8] = br#"{"protected_events":["#;
const BODY_SUFFIX: &[u8] = b"]}";

/// Both endpoints answer the whole feed, so the bodies are rendered per refresh instead of per
/// request. `records` stays for the incremental refresh.
pub struct ProtectedEvents {
    pub records: Vec<ProtectedEventRecord>,
    pub v1: EpochWindowedBody,
    pub legacy: EpochWindowedBody,
}

/// A rendered feed plus, per epoch, where that epoch's last record ends. Records run
/// epoch-descending, so every `from_epoch` window is a prefix and costs a slice, not a re-render.
pub struct EpochWindowedBody {
    body: Bytes,
    epoch_ends: Vec<(u64, usize)>,
}

impl EpochWindowedBody {
    fn new<T: Serialize>(records: impl IntoIterator<Item = (u64, T)>) -> anyhow::Result<Self> {
        let mut body = BODY_PREFIX.to_vec();
        let mut epoch_ends: Vec<(u64, usize)> = vec![];
        for (epoch, record) in records {
            if body.len() > BODY_PREFIX.len() {
                body.push(b',');
            }
            serde_json::to_writer(&mut body, &record)?;
            match epoch_ends.last_mut() {
                Some((last_epoch, end)) if *last_epoch == epoch => *end = body.len(),
                _ => epoch_ends.push((epoch, body.len())),
            }
        }
        body.extend_from_slice(BODY_SUFFIX);
        Ok(Self {
            body: Bytes::from(body),
            epoch_ends,
        })
    }

    pub fn window(&self, from_epoch: Option<u64>) -> Bytes {
        let Some(from_epoch) = from_epoch else {
            return self.body.clone();
        };
        let kept = self
            .epoch_ends
            .partition_point(|(epoch, _)| *epoch >= from_epoch);
        if kept == self.epoch_ends.len() {
            return self.body.clone();
        }
        let end = match kept.checked_sub(1) {
            Some(last) => self.epoch_ends[last].1,
            None => BODY_PREFIX.len(),
        };
        let mut window = Vec::with_capacity(end + BODY_SUFFIX.len());
        window.extend_from_slice(&self.body[..end]);
        window.extend_from_slice(BODY_SUFFIX);
        Bytes::from(window)
    }
}

impl ProtectedEvents {
    pub fn new(mut records: Vec<ProtectedEventRecord>) -> anyhow::Result<Self> {
        // The refresh appends the fresh block to the older one; unsorted, the feed jumps back up.
        records.sort_by_key(|record| Reverse(record.epoch));
        let legacy = EpochWindowedBody::new(
            legacy_projection(&records)
                .into_iter()
                .map(|record| (record.epoch, record)),
        )?;
        let v1 = EpochWindowedBody::new(records.iter().map(|record| (record.epoch, record)))?;
        Ok(Self {
            records,
            v1,
            legacy,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::{LegacyProtectedEventsResponse, ProtectedEventsResponse};
    use settlement_common::settlement_collection::{
        SettlementFunder, SettlementMeta, SettlementReason,
    };
    use solana_sdk::pubkey::Pubkey;
    use validator_bonds_common::dto::BondType;

    fn record(epoch: u64, bond_type: BondType, product: &str) -> ProtectedEventRecord {
        ProtectedEventRecord {
            epoch,
            amount: epoch,
            vote_account: Pubkey::new_unique(),
            meta: SettlementMeta {
                funder: SettlementFunder::ValidatorBond,
            },
            reason: SettlementReason::Bidding,
            bond_type,
            product: product.to_string(),
        }
    }

    fn records() -> Vec<ProtectedEventRecord> {
        vec![
            record(1017, BondType::Bidding, "sam"),
            record(1017, BondType::Institutional, "select"),
            record(1018, BondType::Bidding, "sam"),
            record(1018, BondType::Bidding, "single-validator"),
        ]
    }

    fn epochs(body: &Bytes) -> Vec<u64> {
        let parsed: serde_json::Value = serde_json::from_slice(body).unwrap();
        parsed["protected_events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|record| record["epoch"].as_u64().unwrap())
            .collect()
    }

    #[test]
    fn the_rendered_v1_body_carries_every_record() {
        let events = ProtectedEvents::new(records()).unwrap();
        assert_eq!(
            epochs(&events.v1.window(None)),
            vec![1018, 1018, 1017, 1017]
        );
    }

    #[test]
    fn the_rendered_legacy_body_carries_bidding_sam_only() {
        let events = ProtectedEvents::new(records()).unwrap();
        assert_eq!(epochs(&events.legacy.window(None)), vec![1018, 1017]);
    }

    // The shape the incremental refresh produces: the retained older block, then the fresh one.
    #[test]
    fn the_rendered_feed_is_epoch_ordered_however_the_refresh_merged_it() {
        let events = ProtectedEvents::new(vec![
            record(1017, BondType::Bidding, "sam"),
            record(1016, BondType::Bidding, "sam"),
            record(1018, BondType::Bidding, "sam"),
        ])
        .unwrap();
        assert_eq!(epochs(&events.v1.window(None)), vec![1018, 1017, 1016]);
        assert_eq!(epochs(&events.legacy.window(None)), vec![1018, 1017, 1016]);
    }

    #[test]
    fn the_rendered_legacy_body_publishes_no_new_dimension() {
        let events = ProtectedEvents::new(records()).unwrap();
        let body = String::from_utf8(events.legacy.window(None).to_vec()).unwrap();
        assert!(!body.contains("bond_type"), "{body}");
        assert!(!body.contains("product"), "{body}");
    }

    // The bodies are written by hand, so nothing but this pins them to the documented DTOs.
    #[test]
    fn the_bodies_match_the_serde_rendering_of_the_response_dtos() {
        let events = ProtectedEvents::new(records()).unwrap();
        let sorted = events.records.clone();
        assert_eq!(
            events.v1.window(None),
            serde_json::to_vec(&ProtectedEventsResponse {
                protected_events: sorted.clone(),
            })
            .unwrap()
        );
        assert_eq!(
            events.legacy.window(None),
            serde_json::to_vec(&LegacyProtectedEventsResponse {
                protected_events: legacy_projection(&sorted),
            })
            .unwrap()
        );
    }

    #[test]
    fn a_window_reaching_the_whole_feed_answers_from_the_rendered_body() {
        let events = ProtectedEvents::new(records()).unwrap();
        for from_epoch in [None, Some(0), Some(1017)] {
            assert_eq!(events.v1.window(from_epoch), events.v1.window(None));
            assert_eq!(events.legacy.window(from_epoch), events.legacy.window(None));
        }
    }

    #[test]
    fn a_window_reports_the_epoch_it_starts_at() {
        let events = ProtectedEvents::new(records()).unwrap();
        assert_eq!(epochs(&events.v1.window(Some(1018))), vec![1018, 1018]);
        assert_eq!(epochs(&events.legacy.window(Some(1018))), vec![1018]);
    }

    #[test]
    fn a_window_matches_the_serde_rendering_of_the_records_it_keeps() {
        let events = ProtectedEvents::new(records()).unwrap();
        let kept: Vec<_> = events
            .records
            .iter()
            .filter(|record| record.epoch >= 1018)
            .cloned()
            .collect();
        assert_eq!(
            events.v1.window(Some(1018)),
            serde_json::to_vec(&ProtectedEventsResponse {
                protected_events: kept.clone(),
            })
            .unwrap()
        );
        assert_eq!(
            events.legacy.window(Some(1018)),
            serde_json::to_vec(&LegacyProtectedEventsResponse {
                protected_events: legacy_projection(&kept),
            })
            .unwrap()
        );
    }

    #[test]
    fn a_window_past_the_last_epoch_reports_an_empty_feed() {
        let events = ProtectedEvents::new(records()).unwrap();
        assert_eq!(
            events.v1.window(Some(1019)),
            Bytes::from(r#"{"protected_events":[]}"#)
        );
        assert_eq!(
            events.legacy.window(Some(1019)),
            Bytes::from(r#"{"protected_events":[]}"#)
        );
    }

    // The legacy projection drops whole epochs, so its offsets are not the v1 ones.
    #[test]
    fn a_window_narrowing_past_an_epoch_the_legacy_feed_dropped_reports_nothing() {
        let events = ProtectedEvents::new(vec![
            record(1017, BondType::Bidding, "sam"),
            record(1018, BondType::Institutional, "select"),
        ])
        .unwrap();
        assert_eq!(epochs(&events.v1.window(Some(1018))), vec![1018]);
        assert_eq!(epochs(&events.legacy.window(Some(1018))), Vec::<u64>::new());
    }

    #[test]
    fn an_empty_feed_answers_every_window_from_the_rendered_body() {
        let events = ProtectedEvents::new(vec![]).unwrap();
        assert_eq!(events.v1.window(Some(1018)), events.v1.window(None));
        assert_eq!(events.legacy.window(Some(1018)), events.legacy.window(None));
    }
}
