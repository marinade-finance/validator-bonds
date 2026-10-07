use crate::context::WrappedContext;
use crate::error::AppError;
use crate::repositories::bond::{get_bonds_by_type, get_eventing_state, EventingDocument};
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
        (status = 500, description = "Bonds could not be read from the store."),
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
        (status = 500, description = "Bonds could not be read from the store."),
    )
)]
pub async fn handler_institutional(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<BondsResponse>, AppError> {
    match get_bonds_by_type(&context.read().await.directory, BondType::Institutional).await {
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
        (status = 500, description = "The auction context could not be read from the store."),
    )
)]
pub async fn handler_bidding_auction(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<AuctionContextResponse>, AppError> {
    let Some(state) = get_eventing_state(&context.read().await.directory, BondType::Bidding)
        .await
        .map_err(|error| AppError {
            message: format!("Failed to fetch the auction context. Error: {error:?}"),
        })?
    else {
        return Ok(Json(AuctionContextResponse {
            auction_meta: None,
            auction_validators: HashMap::new(),
        }));
    };

    let EventingDocument {
        epoch,
        meta,
        validators,
    } = state;
    // A validator whose events failed to post keeps an older run's entry; the pin drops it.
    let auction_validators = validators
        .into_iter()
        .filter(|(_, validator)| validator.epoch == epoch)
        .filter_map(|(vote_account, validator)| Some((vote_account, validator.auction_validator?)))
        .collect();

    Ok(Json(AuctionContextResponse {
        auction_meta: meta,
        auction_validators,
    }))
}

#[utoipa::path(
    get,
    tag = "Bonds",
    operation_id = "List bidding validator bonds",
    path = "/bonds/bidding",
    responses(
        (status = 200, body = BondsResponse),
        (status = 500, description = "Bonds could not be read from the store."),
    )
)]
pub async fn handler_bidding(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<BondsResponse>, AppError> {
    match get_bonds_by_type(&context.read().await.directory, BondType::Bidding).await {
        Ok(bonds) => Ok(Json(BondsResponse { bonds })),
        Err(error) => Err(AppError {
            message: format!("Failed to fetch bonds. Error: {error:?}"),
        }),
    }
}
