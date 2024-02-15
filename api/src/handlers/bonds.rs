use crate::{context::WrappedContext, dto::ValidatorBondRecord, repositories::bond::get_bonds};
use serde::{Deserialize, Serialize};
use warp::{
    reject::Reject,
    reply::{json, Reply},
};

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct BondsResponse {
    bonds: Vec<ValidatorBondRecord>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

struct CustomError {
    message: String,
}

impl Reject for CustomError {}

impl std::fmt::Debug for CustomError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CustomError: {}", self.message)
    }
}

#[utoipa::path(
    get,
    tag = "Bonds",
    operation_id = "List validator bonds",
    path = "/v1/bonds",
    responses(
        (status = 200, body = BondsResponse),
    )
)]
pub async fn handler(
    _query_params: QueryParams,
    context: WrappedContext,
) -> Result<impl Reply, warp::Rejection> {
    match get_bonds(&context.read().await.psql_client).await {
        Ok(bonds) => Ok(json(&BondsResponse { bonds })),
        Err(error) => Err(warp::reject::custom(CustomError {
            message: format!("Failed to fetch bonds. Error: {:?}", error),
        })),
    }
}
