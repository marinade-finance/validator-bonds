use crate::context::WrappedContext;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)] // referenced only in the `value_type` schema attribute below
use solana_sdk::pubkey::Pubkey;

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct VerifiedValidatorsResponse {
    #[schema(value_type = Vec<Pubkey>)]
    verified_validators: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

#[utoipa::path(
    get,
    tag = "Validators",
    operation_id = "List verified validators",
    path = "/validators/verified",
    responses(
        (status = 200, body = VerifiedValidatorsResponse),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Json<VerifiedValidatorsResponse> {
    let verified_validators = context.read().await.verified_validators.clone();
    Json(VerifiedValidatorsResponse {
        verified_validators,
    })
}
