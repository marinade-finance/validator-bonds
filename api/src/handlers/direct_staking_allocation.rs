use crate::context::WrappedContext;
use crate::error::{ApiError, AppError, BadRequest};
use crate::repositories::direct_staking_allocation::{
    get_direct_staking_allocation, get_latest_allocation_epoch,
};
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use validator_bonds_common::dto::DirectStakingAllocationRecord;

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct DirectStakingAllocationResponse {
    allocation: Vec<DirectStakingAllocationRecord>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {
    /// Report epochs from this one on, inclusive. Omitted, the whole history is reported.
    pub from_epoch: Option<u64>,
}

#[utoipa::path(
    get,
    tag = "Protected Events",
    operation_id = "Direct staking allocation outcome per validator",
    path = "/v1/protected-events/allocation",
    params(QueryParams),
    responses(
        (status = 200, description = "Which bond paid each validator's direct-staking PSR claims, newest epoch first. A `dropped` row is a validator whose direct stakers went unprotected for that epoch: no bond could pay, so no settlement exists and the validator appears nowhere in `/v1/protected-events`. An epoch absent from the response means no report was stored for it — not that nobody was dropped.", body = DirectStakingAllocationResponse),
        (status = 400, description = "`from_epoch` is not a non-negative integer, or is past the largest storable epoch."),
        (status = 500, description = "No allocation report has been stored yet, or it could not be read. Deliberately not an empty list, which would read as 'nobody was left unprotected'."),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(query_params): Query<QueryParams>,
) -> Result<Json<DirectStakingAllocationResponse>, ApiError> {
    let from_epoch = resolve_from_epoch(query_params.from_epoch)?;

    let context = context.read().await;
    let psql_client = &context.psql_client;

    let allocation = get_direct_staking_allocation(psql_client, from_epoch)
        .await
        .map_err(|error| AppError {
            message: format!("Failed to fetch direct staking allocation. Error: {error:?}"),
        })?;

    // An empty answer is ambiguous on its own, so the one extra query separates "the window you
    // asked for is empty" from "nothing has ever been stored".
    if allocation.is_empty()
        && get_latest_allocation_epoch(psql_client)
            .await
            .map_err(|error| AppError {
                message: format!("Failed to fetch the latest allocation epoch. Error: {error:?}"),
            })?
            .is_none()
    {
        return Err(AppError {
            message: "No direct staking allocation stored yet".to_string(),
        }
        .into());
    }

    Ok(Json(DirectStakingAllocationResponse { allocation }))
}

// The column is INTEGER; rejecting here keeps an absurd epoch a 400 rather than a 500 downstream.
fn resolve_from_epoch(from_epoch: Option<u64>) -> Result<Option<u64>, BadRequest> {
    if let Some(epoch) = from_epoch {
        if epoch > i32::MAX as u64 {
            return Err(BadRequest {
                message: format!("from_epoch {epoch} is out of range"),
            });
        }
    }
    Ok(from_epoch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_omitted_from_epoch_is_accepted() {
        assert_eq!(resolve_from_epoch(None).unwrap(), None);
    }

    #[test]
    fn the_largest_storable_epoch_is_accepted() {
        let epoch = i32::MAX as u64;
        assert_eq!(resolve_from_epoch(Some(epoch)).unwrap(), Some(epoch));
    }

    #[test]
    fn one_epoch_past_the_column_is_rejected() {
        let error = resolve_from_epoch(Some(i32::MAX as u64 + 1)).unwrap_err();
        assert!(
            error.message.contains("is out of range"),
            "{}",
            error.message
        );
    }
}
