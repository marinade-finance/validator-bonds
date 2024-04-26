use crate::{context::WrappedContext, dto::ProtectedEventRecord};
use serde::{Deserialize, Serialize};
use warp::reply::{json, Reply};

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
    operation_id = "List protected events",
    path = "/protected-events",
    responses(
        (status = 200, body = ProtectedEventsResponse),
    )
)]
pub async fn handler(
    _query_params: QueryParams,
    context: WrappedContext,
) -> Result<impl Reply, warp::Rejection> {
    let protected_events = context
        .read()
        .await
        .protected_events_records
        .read()
        .await
        .clone();
    Ok(json(&ProtectedEventsResponse { protected_events }))
}
