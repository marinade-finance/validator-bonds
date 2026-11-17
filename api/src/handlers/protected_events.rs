use crate::context::WrappedContext;
use crate::error::{ApiError, AppError, BadRequest};
use crate::handlers::MAX_EPOCH;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::header;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {
    /// Report epochs from this one on, inclusive. Omitted, the whole history is reported.
    #[param(maximum = 2147483647)]
    pub from_epoch: Option<u64>,
}

fn check_from_epoch(from_epoch: Option<u64>) -> Result<Option<u64>, BadRequest> {
    match from_epoch {
        Some(epoch) if epoch > MAX_EPOCH => Err(BadRequest {
            message: format!("from_epoch {epoch} is out of range"),
        }),
        _ => Ok(from_epoch),
    }
}

fn json_response(body: Bytes) -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/json")], body)
}

#[utoipa::path(
    get,
    tag = "Protected Events",
    operation_id = "List Bid PSR (protected events)",
    path = "/protected-events",
    params(QueryParams),
    responses(
        (status = 200, description = "DEPRECATED: SAM bidding PSR only. Please use /v1/protected-events instead, which also covers the institutional bond and direct staking, split by product.", body = LegacyProtectedEventsResponse),
        (status = 400, description = "`from_epoch` is not a non-negative integer, or is past the largest storable epoch."),
        (status = 500, description = "No settlements have been read from BigQuery yet. Deliberately not an empty list, which would read as 'no validator owes a protected event'."),
    )
)]
#[deprecated]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(query_params): Query<QueryParams>,
) -> Result<impl IntoResponse, ApiError> {
    let from_epoch = check_from_epoch(query_params.from_epoch)?;
    let context = context.read().await;
    let cache = context.protected_events_records.read().await;
    let protected_events = cache.as_ref().ok_or_else(|| AppError {
        message: "No protected events loaded from BigQuery yet".to_string(),
    })?;
    Ok(json_response(protected_events.legacy.window(from_epoch)))
}

#[utoipa::path(
    get,
    tag = "Protected Events",
    operation_id = "List PSR (protected events) per bond type and product",
    path = "/v1/protected-events",
    params(QueryParams),
    responses(
        (status = 200, description = "Settlements from both bond configs. One row per `bond_type` (bidding | institutional) and `product` (sam | select | single-validator), so `(epoch, vote_account, meta, reason)` is no longer unique.", body = ProtectedEventsResponse),
        (status = 400, description = "`from_epoch` is not a non-negative integer, or is past the largest storable epoch."),
        (status = 500, description = "No settlements have been read from BigQuery yet. Deliberately not an empty list, which would read as 'no validator owes a protected event'."),
    )
)]
pub async fn handler_v1(
    State(context): State<WrappedContext>,
    Query(query_params): Query<QueryParams>,
) -> Result<impl IntoResponse, ApiError> {
    let from_epoch = check_from_epoch(query_params.from_epoch)?;
    let context = context.read().await;
    let cache = context.protected_events_records.read().await;
    let protected_events = cache.as_ref().ok_or_else(|| AppError {
        message: "No protected events loaded from BigQuery yet".to_string(),
    })?;
    Ok(json_response(protected_events.v1.window(from_epoch)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_epoch_is_bounded_like_the_other_epoch_parameters() {
        assert_eq!(check_from_epoch(None).unwrap(), None);
        assert_eq!(check_from_epoch(Some(MAX_EPOCH)).unwrap(), Some(MAX_EPOCH));
        let error = check_from_epoch(Some(MAX_EPOCH + 1)).unwrap_err();
        assert!(error.message.contains("out of range"), "{}", error.message);
    }
}
