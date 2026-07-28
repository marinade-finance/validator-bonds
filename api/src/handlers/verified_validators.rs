use crate::context::WrappedContext;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)] // referenced only in the `value_type` schema attribute below
use solana_sdk::pubkey::Pubkey;
use warp::reply::{json, Reply};

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
    _query_params: QueryParams,
    context: WrappedContext,
) -> Result<impl Reply, warp::Rejection> {
    let verified_validators = context.read().await.verified_validators.clone();
    Ok(json(&VerifiedValidatorsResponse {
        verified_validators,
    }))
}
