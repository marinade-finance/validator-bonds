use crate::context::WrappedContext;
use crate::error::AppError;
use crate::repositories::bond::get_bonds_by_type;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct BondsResponse {
    bonds: Vec<ValidatorBondRecord>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

#[utoipa::path(
    get,
    tag = "Bonds",
    operation_id = "List bidding validator bonds (deprecated)",
    path = "/bonds",
    responses(
        (status = 200, description = "DEPRECATED: Please use /bonds/bidding instead", body = BondsResponse),
    )
)]
#[deprecated]
pub async fn handler(
    state: State<WrappedContext>,
    query: Query<QueryParams>,
) -> Result<Json<BondsResponse>, AppError> {
    tracing::warn!("Deprecated /bonds endpoint used, redirect to /bonds/bidding");
    handler_bidding(state, query).await
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
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<BondsResponse>, AppError> {
    match get_bonds_by_type(&context.read().await.psql_client, BondType::Institutional).await {
        Ok(bonds) => Ok(Json(BondsResponse { bonds })),
        Err(error) => Err(AppError {
            message: format!("Failed to fetch bonds. Error: {error:?}"),
        }),
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
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<BondsResponse>, AppError> {
    match get_bonds_by_type(&context.read().await.psql_client, BondType::Bidding).await {
        Ok(bonds) => Ok(Json(BondsResponse { bonds })),
        Err(error) => Err(AppError {
            message: format!("Failed to fetch bonds. Error: {error:?}"),
        }),
    }
}
