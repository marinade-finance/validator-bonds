use crate::{
    context::WrappedContext,
    dto::{legacy_projection, LegacyProtectedEventRecord, ProtectedEventRecord},
    error::AppError,
};
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct ProtectedEventsResponse {
    protected_events: Vec<ProtectedEventRecord>,
}

#[derive(Serialize, Debug, utoipa::ToSchema)]
#[schema(deprecated)]
pub struct LegacyProtectedEventsResponse {
    protected_events: Vec<LegacyProtectedEventRecord>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

#[utoipa::path(
    get,
    tag = "Protected Events",
    operation_id = "List Bid PSR (protected events)",
    path = "/protected-events",
    responses(
        (status = 200, description = "DEPRECATED: SAM bidding PSR only. Please use /v1/protected-events instead, which also covers the institutional bond and direct staking, split by product.", body = LegacyProtectedEventsResponse),
        (status = 500, description = "No settlements have been read from BigQuery yet. Deliberately not an empty list, which would read as 'no validator owes a protected event'."),
    )
)]
#[deprecated]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<LegacyProtectedEventsResponse>, AppError> {
    let protected_events = legacy_projection(
        context
            .read()
            .await
            .protected_events_records
            .read()
            .await
            .as_deref()
            .ok_or_else(|| AppError {
                message: "No protected events loaded from BigQuery yet".to_string(),
            })?,
    );
    Ok(Json(LegacyProtectedEventsResponse { protected_events }))
}

#[utoipa::path(
    get,
    tag = "Protected Events",
    operation_id = "List PSR (protected events) per bond type and product",
    path = "/v1/protected-events",
    responses(
        (status = 200, description = "Settlements from both bond configs. One row per `bond_type` (bidding | institutional) and `product` (sam | select | single-validator), so `(epoch, vote_account, meta, reason)` is no longer unique.", body = ProtectedEventsResponse),
        (status = 500, description = "No settlements have been read from BigQuery yet. Deliberately not an empty list, which would read as 'no validator owes a protected event'."),
    )
)]
pub async fn handler_v1(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<ProtectedEventsResponse>, AppError> {
    let protected_events = context
        .read()
        .await
        .protected_events_records
        .read()
        .await
        .clone()
        .ok_or_else(|| AppError {
            message: "No protected events loaded from BigQuery yet".to_string(),
        })?;
    Ok(Json(ProtectedEventsResponse { protected_events }))
}
