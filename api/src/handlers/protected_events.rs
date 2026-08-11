use crate::{context::WrappedContext, dto::ProtectedEventRecord};
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct ProtectedEventsResponse {
    protected_events: Vec<ProtectedEventRecord>,
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
        (status = 200, description = "Settlements from both bond configs. Filter on `bond_type` (bidding | institutional) and `product` (sam | select | single-validator) to narrow the set.", body = ProtectedEventsResponse),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Json<ProtectedEventsResponse> {
    let protected_events = context
        .read()
        .await
        .protected_events_records
        .read()
        .await
        .clone();
    Json(ProtectedEventsResponse { protected_events })
}
