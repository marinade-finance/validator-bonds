use crate::context::WrappedContext;
use crate::error::AppError;
use crate::repositories::collected_stake::{get_collected_stake, CollectedStakeSnapshot};
use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
#[allow(unused_imports)] // referenced only in the `value_type` schema attribute below
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeMap;

/// Per-authority amounts, named rather than a `authority -> lamports` map, so a further amount stays
/// an additive change. `deactivating` is a subset of `effective`, not an addend.
#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct AuthorityStake {
    label: String,
    #[schema(value_type = Pubkey)]
    stake_authority: String,
    effective: u64,
    activating: u64,
    deactivating: u64,
    stake_accounts: u32,
}

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct ValidatorStake {
    #[schema(value_type = Pubkey)]
    vote_account: String,
    /// Sum of `effective` over every authority — the amount the validator's bond has to cover.
    effective: u64,
    stake: Vec<AuthorityStake>,
}

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct AuthorityTotal {
    label: String,
    #[schema(value_type = Pubkey)]
    stake_authority: String,
    effective: u64,
    activating: u64,
    deactivating: u64,
    validators: u32,
    stake_accounts: u32,
}

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct CollectedStakeResponse {
    epoch: u64,
    slot: u64,
    updated_at: DateTime<Utc>,
    totals: Vec<AuthorityTotal>,
    validators: Vec<ValidatorStake>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

fn build_response(snapshot: CollectedStakeSnapshot) -> CollectedStakeResponse {
    let mut per_validator: BTreeMap<String, Vec<AuthorityStake>> = BTreeMap::new();
    let mut per_authority: BTreeMap<String, AuthorityTotal> = BTreeMap::new();

    for record in snapshot.records {
        let total = per_authority
            .entry(record.stake_authority.clone())
            .or_insert_with(|| AuthorityTotal {
                label: record.label.clone(),
                stake_authority: record.stake_authority.clone(),
                effective: 0,
                activating: 0,
                deactivating: 0,
                validators: 0,
                stake_accounts: 0,
            });
        total.effective += record.effective;
        total.activating += record.activating;
        total.deactivating += record.deactivating;
        total.validators += 1;
        total.stake_accounts += record.stake_accounts;

        per_validator
            .entry(record.vote_account)
            .or_default()
            .push(AuthorityStake {
                label: record.label,
                stake_authority: record.stake_authority,
                effective: record.effective,
                activating: record.activating,
                deactivating: record.deactivating,
                stake_accounts: record.stake_accounts,
            });
    }

    CollectedStakeResponse {
        epoch: snapshot.epoch,
        slot: snapshot.slot,
        updated_at: snapshot.updated_at,
        totals: per_authority.into_values().collect(),
        validators: per_validator
            .into_iter()
            .map(|(vote_account, stake)| ValidatorStake {
                vote_account,
                effective: stake.iter().map(|authority| authority.effective).sum(),
                stake,
            })
            .collect(),
    }
}

#[utoipa::path(
    get,
    tag = "Validators",
    operation_id = "Marinade stake per validator, per staker authority",
    path = "/v1/validators/stake",
    responses(
        (status = 200, description = "Stake routed to each validator through the Marinade products the collector tracks, at the latest collected epoch.", body = CollectedStakeResponse),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<CollectedStakeResponse>, AppError> {
    let context = context.read().await;

    let snapshot = get_collected_stake(&context.psql_client)
        .await
        .map_err(|error| AppError {
            message: format!("Failed to fetch collected stake. Error: {error:?}"),
        })?
        .ok_or_else(|| AppError {
            message: "No collected stake stored yet".to_string(),
        })?;

    Ok(Json(build_response(snapshot)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use validator_bonds_common::dto::CollectedStakeRecord;

    fn record(label: &str, vote_account: &str, effective: u64) -> CollectedStakeRecord {
        CollectedStakeRecord {
            epoch: 1014,
            slot: 438413520,
            label: label.to_string(),
            stake_authority: format!("{label}-authority"),
            vote_account: vote_account.to_string(),
            effective,
            activating: 1,
            deactivating: 2,
            stake_accounts: 3,
            updated_at: Utc::now(),
        }
    }

    fn response(records: Vec<CollectedStakeRecord>) -> CollectedStakeResponse {
        build_response(CollectedStakeSnapshot {
            epoch: 1014,
            slot: 438413520,
            updated_at: Utc::now(),
            records,
        })
    }

    #[test]
    fn a_validator_sums_its_authorities() {
        let built = response(vec![
            record("native", "voteA", 10),
            record("liquid", "voteA", 30),
        ]);
        assert_eq!(built.validators.len(), 1);
        assert_eq!(built.validators[0].effective, 40);
        assert_eq!(built.validators[0].stake.len(), 2);
    }

    #[test]
    fn totals_count_validators_and_accounts_per_authority() {
        let built = response(vec![
            record("native", "voteA", 10),
            record("native", "voteB", 5),
            record("liquid", "voteA", 30),
        ]);
        let native = built
            .totals
            .iter()
            .find(|total| total.label == "native")
            .unwrap();
        assert_eq!(
            (
                native.effective,
                native.validators,
                native.stake_accounts,
                native.activating,
                native.deactivating
            ),
            (15, 2, 6, 2, 4)
        );
    }
}
