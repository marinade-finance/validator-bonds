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
use validator_bonds_common::dto::BondType;

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct PsrProtectedValidatorsResponse {
    #[schema(value_type = Vec<Pubkey>)]
    psr_protected_validators: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

#[utoipa::path(
    get,
    tag = "Validators",
    operation_id = "List validators whose stakers are PSR protected",
    path = "/validators/psr-protected",
    responses(
        (status = 200, body = PsrProtectedValidatorsResponse),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<PsrProtectedValidatorsResponse>, AppError> {
    let psql_client = &context.read().await.psql_client;

    let mut protected = BTreeSet::new();
    for bond_type in [BondType::Bidding, BondType::Institutional] {
        let bonds = get_bonds_by_type(psql_client, bond_type)
            .await
            .map_err(|error| AppError {
                message: format!("Failed to fetch bonds. Error: {error:?}"),
            })?;
        protected.extend(
            bonds
                .into_iter()
                .filter(|bond| bond.effective_amount > Decimal::ZERO)
                .map(|bond| bond.vote_account),
        );
    }

    Ok(Json(PsrProtectedValidatorsResponse {
        psr_protected_validators: protected.into_iter().collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn protected_of(bonds: Vec<(&str, Decimal)>) -> Vec<String> {
        bonds
            .into_iter()
            .filter(|(_, effective_amount)| *effective_amount > Decimal::ZERO)
            .map(|(vote_account, _)| vote_account.to_string())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    // A funded bond whose stake has not settled yet still cannot pay a claim, so the badge must
    // follow effective_amount rather than funded_amount.
    #[test]
    fn only_a_positive_effective_amount_counts_as_protected() {
        let protected = protected_of(vec![
            ("voteUsable", Decimal::from(1)),
            ("voteZero", Decimal::ZERO),
        ]);
        assert_eq!(protected, vec!["voteUsable".to_string()]);
    }

    #[test]
    fn a_validator_bonded_under_both_configs_is_listed_once() {
        let protected = protected_of(vec![
            ("voteBoth", Decimal::from(10)),
            ("voteBoth", Decimal::from(20)),
        ]);
        assert_eq!(protected, vec!["voteBoth".to_string()]);
    }
}
