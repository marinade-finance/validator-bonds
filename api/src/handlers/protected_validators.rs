use crate::context::WrappedContext;
use crate::error::AppError;
use crate::repositories::bond::get_bonds_by_type;
use axum::extract::{Query, State};
use axum::Json;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)] // referenced only in the `value_type` schema attribute below
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeSet;
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct ProtectedValidatorsResponse {
    #[schema(value_type = Vec<Pubkey>)]
    protected_validators: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

const MIN_PROTECTED_BOND_LAMPORTS: u64 = 1_000_000_000;

/// Effective, not funded: a settlement reservation or a filed withdraw request forfeits protection.
fn protected_vote_accounts(bonds: &[ValidatorBondRecord]) -> BTreeSet<String> {
    bonds
        .iter()
        .filter(|bond| bond.effective_amount >= Decimal::from(MIN_PROTECTED_BOND_LAMPORTS))
        .map(|bond| bond.vote_account.clone())
        .collect()
}

#[utoipa::path(
    get,
    tag = "Validators",
    operation_id = "List validators whose stakers are PSR protected",
    path = "/validators/protected",
    responses(
        (status = 200, description = "At least 1 SOL of effective bond under the bidding or the institutional config.", body = ProtectedValidatorsResponse),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<ProtectedValidatorsResponse>, AppError> {
    let psql_client = &context.read().await.psql_client;

    let mut protected = BTreeSet::new();
    for bond_type in [BondType::Bidding, BondType::Institutional] {
        let bonds = get_bonds_by_type(psql_client, bond_type)
            .await
            .map_err(|error| AppError {
                message: format!("Failed to fetch bonds. Error: {error:?}"),
            })?;
        protected.extend(protected_vote_accounts(&bonds));
    }

    Ok(Json(ProtectedValidatorsResponse {
        protected_validators: protected.into_iter().collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn bond(vote_account: &str, effective_amount: Decimal) -> ValidatorBondRecord {
        ValidatorBondRecord {
            pubkey: format!("{vote_account}-bond"),
            vote_account: vote_account.to_string(),
            authority: format!("{vote_account}-authority"),
            cpmpe: Decimal::ZERO,
            max_stake_wanted: Decimal::ZERO,
            epoch: 980,
            // Max on every fixture: a bond excluded below the floor must be excluded despite it.
            funded_amount: Decimal::from(u64::MAX),
            effective_amount,
            remaining_witdraw_request_amount: Decimal::ZERO,
            remainining_settlement_claim_amount: Decimal::ZERO,
            updated_at: Utc::now(),
            bond_type: BondType::Bidding,
            inflation_commission_bps: None,
            mev_commission_bps: None,
            block_commission_bps: None,
        }
    }

    fn protected(bonds: Vec<ValidatorBondRecord>) -> Vec<String> {
        protected_vote_accounts(&bonds).into_iter().collect()
    }

    #[test]
    fn a_bond_below_the_floor_is_not_protected() {
        let listed = protected(vec![
            bond("voteAtFloor", Decimal::from(MIN_PROTECTED_BOND_LAMPORTS)),
            bond(
                "voteBelowFloor",
                Decimal::from(MIN_PROTECTED_BOND_LAMPORTS - 1),
            ),
            bond("voteZero", Decimal::ZERO),
        ]);
        assert_eq!(listed, vec!["voteAtFloor".to_string()]);
    }

    #[test]
    fn a_vote_account_appearing_twice_is_listed_once() {
        let listed = protected(vec![
            bond("voteTwice", Decimal::from(MIN_PROTECTED_BOND_LAMPORTS)),
            bond("voteTwice", Decimal::from(MIN_PROTECTED_BOND_LAMPORTS * 20)),
        ]);
        assert_eq!(listed, vec!["voteTwice".to_string()]);
    }
}
