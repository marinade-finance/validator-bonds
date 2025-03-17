use crate::context::WrappedContext;
use crate::repositories::bond::get_bonds_by_type;
use serde::{Deserialize, Serialize};
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};
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
    path = "/bonds",
    responses(
        (status = 200, description = "DEPRECATED: Please use /bonds/bidding instead", body = BondsResponse),
    )
)]
pub async fn handler(
    query_params: QueryParams,
    context: WrappedContext,
) -> Result<impl Reply, warp::Rejection> {
    tracing::warn!("Deprecated /bonds endpoint used, redirect to /bonds/bidding");
    handler_bidding(query_params, context).await
}

#[utoipa::path(
    get,
    tag = "Bonds",
    operation_id = "List institutional validator bonds",
    path = "/bonds/institutional",
    responses(
        (status = 200, body = BondsResponse),
    )
)]
pub async fn handler_institutional(
    _query_params: QueryParams,
    context: WrappedContext,
) -> Result<impl Reply, warp::Rejection> {
    match get_bonds_by_type(&context.read().await.psql_client, BondType::Institutional).await {
        Ok(bonds) => Ok(json(&BondsResponse { bonds })),
        Err(error) => Err(warp::reject::custom(CustomError {
            message: format!("Failed to fetch bonds. Error: {:?}", error),
        })),
    }
}

#[utoipa::path(
    get,
    tag = "Bonds",
    operation_id = "List bidding validator bonds",
    path = "/bonds/bidding",
    responses(
        (status = 200, body = BondsResponse),
    )
)]
pub async fn handler_bidding(
    _query_params: QueryParams,
    context: WrappedContext,
) -> Result<impl Reply, warp::Rejection> {
    match get_bonds_by_type(&context.read().await.psql_client, BondType::Bidding).await {
        Ok(bonds) => Ok(json(&BondsResponse { bonds })),
        Err(error) => Err(warp::reject::custom(CustomError {
            message: format!("Failed to fetch bonds. Error: {:?}", error),
        })),
    }
}
