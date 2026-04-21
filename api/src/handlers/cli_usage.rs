use crate::context::WrappedContext;
use crate::error::CustomError;
use crate::repositories::cli_usage::{record_cli_usage, CliType, CliUsageParams};
use log::error;
use serde::{Deserialize, Serialize};
use warp::http::StatusCode;
use warp::reply::{Reply, Response};

/// Max number of characters accepted for the free-form TEXT fields
/// (account, operation, cli_version). Enforced at the handler only; the
/// DB column is unbounded `TEXT` so ad-hoc writes (backfills, manual
/// fixes) aren't blocked by an overly strict schema constraint.
const MAX_FIELD_CHARS: usize = 512;

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {
    /// Best-effort capture of the command's first positional pubkey argument.
    /// May be absent when the command's target is passed as an option, and the
    /// account type varies by command (bond, vote, stake, config, etc.).
    pub account: Option<String>,
    /// CLI operation name (e.g., "configure-bond", "fund-bond", "show-bond")
    pub operation: Option<String>,
    pub cli_version: Option<String>,
    /// CLI type: "sam" or "institutional"
    #[serde(rename = "type")]
    pub cli_type: Option<CliType>,
}

#[utoipa::path(
    post,
    tag = "CLI Usage",
    operation_id = "Record CLI invocation",
    path = "/v1/cli-usage",
    params(QueryParams),
    responses(
        (status = 204, description = "CLI usage recorded"),
        (status = 400, description = "Invalid input (field too long)"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn handler(
    query_params: QueryParams,
    context: WrappedContext,
) -> Result<Response, warp::Rejection> {
    let too_long = |v: &Option<String>| {
        v.as_deref()
            .is_some_and(|s| s.chars().count() > MAX_FIELD_CHARS)
    };
    if too_long(&query_params.account)
        || too_long(&query_params.operation)
        || too_long(&query_params.cli_version)
    {
        return Ok(warp::reply::with_status(
            format!("Field exceeds {MAX_FIELD_CHARS} characters"),
            StatusCode::BAD_REQUEST,
        )
        .into_response());
    }

    let usage_params = CliUsageParams {
        account: query_params.account,
        operation: query_params.operation,
        cli_version: query_params.cli_version,
        cli_type: query_params.cli_type,
    };

    let ctx = context.read().await;
    match record_cli_usage(&ctx.psql_client, usage_params).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT.into_response()),
        Err(err) => {
            // Log the underlying DB error for diagnostics; do not echo it back
            // to the client (may contain schema/constraint detail).
            error!("Failed to record CLI usage: {err:?}");
            Err(warp::reject::custom(CustomError {
                message: "Failed to record CLI usage".to_string(),
            }))
        }
    }
}
