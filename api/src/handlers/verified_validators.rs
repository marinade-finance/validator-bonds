use crate::context::WrappedContext;
use serde::{Deserialize, Serialize};
use warp::reply::{json, Reply};

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct VerifiedValidatorsResponse {
    #[schema(value_type = Vec<solana_sdk::pubkey::Pubkey>)]
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
