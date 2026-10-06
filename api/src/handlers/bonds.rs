use crate::context::WrappedContext;
use crate::error::AppError;
use crate::repositories::bond::{get_auction_context, get_bonds_by_type};
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct BondsResponse {
    bonds: Vec<ValidatorBondRecord>,
}

// ds-sam-calc relay for the CLI (separate endpoint keeps /bonds/bidding lean). Epoch
// contract: reconcile `auction_meta.epoch` against a bond's `epoch` — separate pipelines.
#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct AuctionContextResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    auction_meta: Option<serde_json::Value>,
    auction_validators: HashMap<String, serde_json::Value>,
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
        (status = 500, description = "Bonds could not be read from the database."),
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
        (status = 500, description = "Bonds could not be read from the database."),
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
    operation_id = "Auction context for bidding validator bonds",
    path = "/bonds/bidding/auction",
    responses(
        (status = 200, body = AuctionContextResponse),
    )
)]
pub async fn handler_bidding_auction(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<AuctionContextResponse>, AppError> {
    // Best-effort: auxiliary CLI hints. Missing eventing tables (migration not yet
    // applied) or empty → empty context, not a 500.
    let auction = get_auction_context(&context.read().await.psql_client, BondType::Bidding)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!("Auction context unavailable: {error:?}");
            Default::default()
        });
    Ok(Json(AuctionContextResponse {
        auction_meta: auction.meta,
        auction_validators: auction.validators,
    }))
}

#[utoipa::path(
    get,
    tag = "Bonds",
    operation_id = "List bidding validator bonds",
    path = "/bonds/bidding",
    responses(
        (status = 200, body = BondsResponse),
        (status = 500, description = "Bonds could not be read from the database."),
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
