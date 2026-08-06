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

const FULL_COMMISSION_BPS: i64 = 10_000;

/// A bond only backs a downtime claim while it can pay and the validator can produce the event at all.
fn protected_vote_accounts(bonds: &[ValidatorBondRecord]) -> BTreeSet<String> {
    bonds
        .iter()
        .filter(|bond| bond.effective_amount > Decimal::ZERO)
        .filter(|bond| bond.inflation_commission_bps != Some(FULL_COMMISSION_BPS))
        .map(|bond| bond.vote_account.clone())
        .collect()
}

#[utoipa::path(
    get,
    tag = "Validators",
    operation_id = "List validators whose stakers are PSR protected",
    path = "/validators/protected",
    responses(
        (status = 200, body = ProtectedValidatorsResponse),
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

    fn bond(
        vote_account: &str,
        effective_amount: Decimal,
        inflation_commission_bps: Option<i64>,
    ) -> ValidatorBondRecord {
        ValidatorBondRecord {
            pubkey: format!("{vote_account}-bond"),
            vote_account: vote_account.to_string(),
            authority: format!("{vote_account}-authority"),
            cpmpe: Decimal::ZERO,
            max_stake_wanted: Decimal::ZERO,
            epoch: 980,
            funded_amount: Decimal::from(1_000),
            effective_amount,
            remaining_witdraw_request_amount: Decimal::ZERO,
            remainining_settlement_claim_amount: Decimal::ZERO,
            updated_at: Utc::now(),
            bond_type: BondType::Bidding,
            inflation_commission_bps,
            mev_commission_bps: None,
            block_commission_bps: None,
        }
    }

    fn protected(bonds: Vec<ValidatorBondRecord>) -> Vec<String> {
        protected_vote_accounts(&bonds).into_iter().collect()
    }

    // funded_amount can be positive while the bond is fully committed, and then it pays nothing
    #[test]
    fn only_a_positive_effective_amount_counts_as_protected() {
        let listed = protected(vec![
            bond("voteUsable", Decimal::from(1), None),
            bond("voteZero", Decimal::ZERO, None),
        ]);
        assert_eq!(listed, vec!["voteUsable".to_string()]);
    }

    #[test]
    fn a_validator_bonded_under_both_configs_is_listed_once() {
        let listed = protected(vec![
            bond("voteBoth", Decimal::from(10), None),
            bond("voteBoth", Decimal::from(20), None),
        ]);
        assert_eq!(listed, vec!["voteBoth".to_string()]);
    }

    // a 100 % commission validator never produces a downtime event, so a bond cannot back one
    #[test]
    fn a_full_commission_validator_is_not_protected() {
        let listed = protected(vec![
            bond("voteFullCommission", Decimal::from(10), Some(10_000)),
            bond("votePartialCommission", Decimal::from(10), Some(9_999)),
        ]);
        assert_eq!(listed, vec!["votePartialCommission".to_string()]);
    }

    #[test]
    fn an_unknown_commission_is_still_protected() {
        let listed = protected(vec![bond("voteUnknown", Decimal::from(10), None)]);
        assert_eq!(listed, vec!["voteUnknown".to_string()]);
    }
}
