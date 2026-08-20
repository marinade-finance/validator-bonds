use crate::{
    context::WrappedContext,
    dto::{
        legacy_projection, LegacyProtectedEventsResponse, ProtectedEventRecord,
        ProtectedEventsResponse,
    },
    error::AppError,
};
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::header;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {
    pub from_epoch: Option<u64>,
}

fn json_response(body: Bytes) -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/json")], body)
}

fn render(response: &impl Serialize) -> Result<Bytes, AppError> {
    let body = serde_json::to_vec(response).map_err(|err| AppError {
        message: format!("Failed to render the protected events: {err}"),
    })?;
    Ok(Bytes::from(body))
}

fn records_from_epoch(
    records: &[ProtectedEventRecord],
    from_epoch: u64,
) -> Vec<ProtectedEventRecord> {
    records
        .iter()
        .filter(|record| record.epoch >= from_epoch)
        .cloned()
        .collect()
}

#[utoipa::path(
    get,
    tag = "Protected Events",
    operation_id = "List Bid PSR (protected events)",
    path = "/protected-events",
    params(
        ("from_epoch" = Option<u64>, Query, description = "Report epochs from this one on, inclusive. Omitted, the whole history is reported."),
    ),
    responses(
        (status = 200, description = "DEPRECATED: SAM bidding PSR only. Please use /v1/protected-events instead, which also covers the institutional bond and direct staking, split by product.", body = LegacyProtectedEventsResponse),
        (status = 500, description = "No settlements have been read from BigQuery yet. Deliberately not an empty list, which would read as 'no validator owes a protected event'."),
    )
)]
#[deprecated]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(query_params): Query<QueryParams>,
) -> Result<impl IntoResponse, AppError> {
    let context = context.read().await;
    let cache = context.protected_events_records.read().await;
    let protected_events = cache.as_ref().ok_or_else(|| AppError {
        message: "No protected events loaded from BigQuery yet".to_string(),
    })?;
    let body = match query_params.from_epoch {
        None => protected_events.legacy_body.clone(),
        Some(epoch) => render(&LegacyProtectedEventsResponse {
            protected_events: legacy_projection(&records_from_epoch(
                &protected_events.records,
                epoch,
            )),
        })?,
    };
    Ok(json_response(body))
}

#[utoipa::path(
    get,
    tag = "Protected Events",
    operation_id = "List PSR (protected events) per bond type and product",
    path = "/v1/protected-events",
    params(
        ("from_epoch" = Option<u64>, Query, description = "Report epochs from this one on, inclusive. Omitted, the whole history is reported."),
    ),
    responses(
        (status = 200, description = "Settlements from both bond configs. One row per `bond_type` (bidding | institutional) and `product` (sam | select | single-validator), so `(epoch, vote_account, meta, reason)` is no longer unique.", body = ProtectedEventsResponse),
        (status = 500, description = "No settlements have been read from BigQuery yet. Deliberately not an empty list, which would read as 'no validator owes a protected event'."),
    )
)]
pub async fn handler_v1(
    State(context): State<WrappedContext>,
    Query(query_params): Query<QueryParams>,
) -> Result<impl IntoResponse, AppError> {
    let context = context.read().await;
    let cache = context.protected_events_records.read().await;
    let protected_events = cache.as_ref().ok_or_else(|| AppError {
        message: "No protected events loaded from BigQuery yet".to_string(),
    })?;
    let body = match query_params.from_epoch {
        None => protected_events.v1_body.clone(),
        Some(epoch) => render(&ProtectedEventsResponse {
            protected_events: records_from_epoch(&protected_events.records, epoch),
        })?,
    };
    Ok(json_response(body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::ProtectedEvents;
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
        assert_eq!(epochs(&events.v1_body), vec![1017, 1017, 1018, 1018]);
    }

    #[test]
    fn the_rendered_legacy_body_carries_bidding_sam_only() {
        let events = ProtectedEvents::new(records()).unwrap();
        assert_eq!(epochs(&events.legacy_body), vec![1017, 1018]);
    }

    #[test]
    fn the_rendered_legacy_body_publishes_no_new_dimension() {
        let events = ProtectedEvents::new(records()).unwrap();
        let body = String::from_utf8(events.legacy_body.to_vec()).unwrap();
        assert!(!body.contains("bond_type"), "{body}");
        assert!(!body.contains("product"), "{body}");
    }

    #[test]
    fn a_window_reports_the_epoch_it_starts_at() {
        let windowed = records_from_epoch(&records(), 1018);
        assert_eq!(
            windowed
                .iter()
                .map(|record| record.epoch)
                .collect::<Vec<_>>(),
            vec![1018, 1018]
        );
    }

    #[test]
    fn a_window_past_the_last_epoch_reports_nothing() {
        assert!(records_from_epoch(&records(), 1019).is_empty());
    }
}
