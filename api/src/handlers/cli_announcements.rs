use crate::context::WrappedContext;
use crate::error::CustomError;
use crate::repositories::cli_announcement::{
    get_active_announcements, record_cli_usage, AnnouncementQueryParams, CliAnnouncementRecord,
    CliType, CliUsageParams,
};
use log::warn;
use serde::{Deserialize, Serialize};
use warp::reply::{json, Reply};

/// Contains a list of announcements from the latest group to be displayed in CLI
#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct CliAnnouncementsResponse {
    announcements: Vec<CliAnnouncementRecord>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {
    /// Account address (bond account or vote account)
    pub account: Option<String>,
    /// CLI operation name (e.g., "configure-bond", "fund-bond", "show-bond")
    pub operation: Option<String>,
    pub cli_version: Option<String>,
    /// CLI type: "sam" or "institutional"
    #[serde(rename = "type")]
    pub cli_type: Option<CliType>,
}

#[utoipa::path(
    get,
    tag = "CLI Announcements",
    operation_id = "Get CLI announcements",
    path = "/v1/announcements",
    params(QueryParams),
    responses(
        (status = 200, description = "Active announcements from the latest group", body = CliAnnouncementsResponse),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn handler(
    query_params: QueryParams,
    context: WrappedContext,
) -> Result<impl Reply, warp::Rejection> {
    let announcement_params = AnnouncementQueryParams {
        account: query_params.account.clone(),
        operation: query_params.operation.clone(),
        cli_type: query_params.cli_type.clone(),
    };

    let ctx = context.read().await;

    // Record CLI usage (fire-and-forget, don't block the response)
    let usage_params = CliUsageParams {
        account: query_params.account,
        operation: query_params.operation,
        cli_version: query_params.cli_version,
        cli_type: query_params.cli_type,
    };
    if let Err(e) = record_cli_usage(&ctx.psql_client, usage_params).await {
        warn!("Failed to record CLI usage: {e:?}");
    }

    match get_active_announcements(&ctx.psql_client, announcement_params).await {
        Ok(announcements) => Ok(json(&CliAnnouncementsResponse { announcements })),
        Err(error) => Err(warp::reject::custom(CustomError {
            message: format!("Failed to fetch announcements. Error: {error:?}"),
        })),
    }
}
