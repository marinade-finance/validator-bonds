use crate::context::WrappedContext;
use crate::error::AppError;
use crate::repositories::bond::get_summable_bonds;
use crate::repositories::collected_stake::{
    get_collected_stake, CollectedStakeSnapshot, MarinadeStakeByVoteAccount,
};
use axum::extract::{Query, State};
use axum::Json;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)] // referenced only in the `value_type` schema attribute below
use solana_sdk::pubkey::Pubkey;
use std::collections::{BTreeSet, HashMap};
use validator_bonds_common::dto::ValidatorBondRecord;

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct ProtectedValidatorsResponse {
    #[schema(value_type = Vec<Pubkey>)]
    protected_validators: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {}

/// Also what rules out a validator with no Marinade stake, whom the ratio alone would pass at zero.
const MIN_PROTECTED_BOND_LAMPORTS: u64 = 1_000_000_000;

/// Select's ratio, applied to SAM stake too, so one rule replaces SAM's per-epoch PMPE sizing.
const ALLOWED_STAKE_PER_BOND_RATIO: u64 = 2000;

fn required_bond_lamports(marinade_stake_lamports: u64) -> Decimal {
    Decimal::from(
        marinade_stake_lamports
            .div_ceil(ALLOWED_STAKE_PER_BOND_RATIO)
            .max(MIN_PROTECTED_BOND_LAMPORTS),
    )
}

/// Both configs' bonds are summed against the whole Marinade stake: the badge is per validator,
/// while collateral and stake each split per product.
fn protected_vote_accounts(
    bonds: &[ValidatorBondRecord],
    marinade_stake: &MarinadeStakeByVoteAccount,
) -> BTreeSet<String> {
    let mut effective_amounts: HashMap<&str, Decimal> = HashMap::new();
    for bond in bonds {
        // Effective, not funded: a settlement reservation or a withdraw request cannot pay a claim.
        *effective_amounts
            .entry(bond.vote_account.as_str())
            .or_default() += bond.effective_amount;
    }

    effective_amounts
        .into_iter()
        .filter(|(vote_account, effective_amount)| {
            let stake = marinade_stake.get(*vote_account).copied().unwrap_or(0);
            *effective_amount >= required_bond_lamports(stake)
        })
        .map(|(vote_account, _)| vote_account.to_string())
        .collect()
}

// The handler must keep routing through here: the tests cover this fold, never `handler` itself.
fn protected_from_snapshot(
    bonds: &[ValidatorBondRecord],
    snapshot: &CollectedStakeSnapshot,
) -> BTreeSet<String> {
    protected_vote_accounts(bonds, &snapshot.stake_to_cover_by_vote_account())
}

#[utoipa::path(
    get,
    tag = "Validators",
    operation_id = "List validators whose stakers are PSR protected",
    path = "/v1/validators/protected",
    responses(
        (status = 200, description = "Effective bond under the bidding and the institutional config, summed, covers at least 1/2000 of the validator's Marinade stake including the stake still activating, and is at least 1 SOL.", body = ProtectedValidatorsResponse),
        (status = 500, description = "No stake has been collected yet, or bonds could not be read. Deliberately not an empty list, which would read as 'no validator is protected'."),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(_query_params): Query<QueryParams>,
) -> Result<Json<ProtectedValidatorsResponse>, AppError> {
    let context = context.read().await;

    // Without stake data every validator reads as zero stake, so the floor alone would protect a
    // whale's dust bond.
    let snapshot = get_collected_stake(&context.psql_client)
        .await
        .map_err(|error| AppError {
            message: format!("Failed to fetch collected stake. Error: {error:?}"),
        })?
        .ok_or_else(|| AppError {
            message: "No collected stake stored yet".to_string(),
        })?;

    let bonds = get_summable_bonds(&context.psql_client)
        .await
        .map_err(|error| AppError {
            message: format!("Failed to fetch bonds. Error: {error:?}"),
        })?;

    // Separate pipeline steps write these, so a skew either way must surface rather than move the list.
    if let Some(bonds_epoch) = bonds.iter().map(|bond| bond.epoch).max() {
        if snapshot.epoch != bonds_epoch {
            tracing::warn!(
                "Collected stake is from epoch {} while bonds are from epoch {bonds_epoch}",
                snapshot.epoch
            );
        }
    }

    Ok(Json(ProtectedValidatorsResponse {
        protected_validators: protected_from_snapshot(&bonds, &snapshot)
            .into_iter()
            .collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use validator_bonds_common::dto::{BondType, CollectedStakeRecord};

    fn sol(amount: u64) -> u64 {
        amount * 1_000_000_000
    }

    fn bond(
        vote_account: &str,
        effective_lamports: u64,
        bond_type: BondType,
    ) -> ValidatorBondRecord {
        ValidatorBondRecord {
            pubkey: format!("{vote_account}-bond"),
            vote_account: vote_account.to_string(),
            authority: format!("{vote_account}-authority"),
            cpmpe: Decimal::ZERO,
            max_stake_wanted: Decimal::ZERO,
            epoch: 980,
            // Max on every fixture: an excluded bond must stay excluded despite it.
            funded_amount: Decimal::from(u64::MAX),
            effective_amount: Decimal::from(effective_lamports),
            remaining_witdraw_request_amount: Decimal::ZERO,
            remainining_settlement_claim_amount: Decimal::ZERO,
            updated_at: Utc::now(),
            bond_type,
            inflation_commission_bps: None,
            mev_commission_bps: None,
            block_commission_bps: None,
        }
    }

    fn bidding(vote_account: &str, effective_lamports: u64) -> ValidatorBondRecord {
        bond(vote_account, effective_lamports, BondType::Bidding)
    }

    fn stake(entries: &[(&str, u64)]) -> MarinadeStakeByVoteAccount {
        entries
            .iter()
            .map(|(vote_account, stake_lamports)| (vote_account.to_string(), *stake_lamports))
            .collect()
    }

    fn protected(
        bonds: Vec<ValidatorBondRecord>,
        marinade_stake: &MarinadeStakeByVoteAccount,
    ) -> Vec<String> {
        protected_vote_accounts(&bonds, marinade_stake)
            .into_iter()
            .collect()
    }

    fn protected_snapshot(
        bonds: Vec<ValidatorBondRecord>,
        snapshot: &CollectedStakeSnapshot,
    ) -> Vec<String> {
        protected_from_snapshot(&bonds, snapshot)
            .into_iter()
            .collect()
    }

    fn collected(entries: &[(&str, u64, u64)]) -> CollectedStakeSnapshot {
        CollectedStakeSnapshot {
            epoch: 1027,
            slot: 443_966_005,
            updated_at: Utc::now(),
            records: entries
                .iter()
                .map(
                    |(vote_account, effective, activating)| CollectedStakeRecord {
                        epoch: 1027,
                        slot: 443_966_005,
                        label: "direct".to_string(),
                        stake_authority: "psrStL2hNx4c7hLUUks8SmDngeYriB8pF7uyHFhM8ir".to_string(),
                        vote_account: vote_account.to_string(),
                        effective: *effective,
                        activating: *activating,
                        deactivating: 0,
                        stake_accounts: 2,
                        updated_at: Utc::now(),
                    },
                )
                .collect(),
        }
    }

    #[test]
    fn the_bond_must_cover_one_two_thousandth_of_the_marinade_stake() {
        let listed = protected(
            vec![
                bidding("voteAtRatio", sol(25)),
                bidding("voteBelowRatio", sol(25) - 1),
                bidding("voteAboveRatio", sol(25) + 1),
            ],
            &stake(&[
                ("voteAtRatio", sol(50_000)),
                ("voteBelowRatio", sol(50_000)),
                ("voteAboveRatio", sol(50_000)),
            ]),
        );
        assert_eq!(
            listed,
            vec!["voteAboveRatio".to_string(), "voteAtRatio".to_string()]
        );
    }

    #[test]
    fn a_bond_below_the_floor_is_not_protected() {
        // Without the floor the ratio alone would protect a dust bond of a small stake.
        let listed = protected(
            vec![
                bidding("voteAtFloor", MIN_PROTECTED_BOND_LAMPORTS),
                bidding("voteBelowFloor", MIN_PROTECTED_BOND_LAMPORTS - 1),
                bidding("voteZero", 0),
            ],
            &stake(&[
                ("voteAtFloor", sol(100)),
                ("voteBelowFloor", sol(100)),
                ("voteZero", sol(100)),
            ]),
        );
        assert_eq!(listed, vec!["voteAtFloor".to_string()]);
    }

    #[test]
    fn without_marinade_stake_the_floor_alone_decides() {
        // A zero-stake validator is not excluded outright: the badge tells a staker whether routing
        // stake there would be covered, and the floor covers the first 2000 SOL.
        let listed = protected(
            vec![
                bidding("voteNoStakeAtFloor", MIN_PROTECTED_BOND_LAMPORTS),
                bidding("voteNoStakeBelowFloor", MIN_PROTECTED_BOND_LAMPORTS - 1),
                bidding("voteUncollectedAtFloor", MIN_PROTECTED_BOND_LAMPORTS),
                bidding("voteUncollectedBelowFloor", MIN_PROTECTED_BOND_LAMPORTS - 1),
            ],
            // The two `voteUncollected*` accounts are absent, which must read as zero stake.
            &stake(&[("voteNoStakeAtFloor", 0), ("voteNoStakeBelowFloor", 0)]),
        );
        assert_eq!(
            listed,
            vec![
                "voteNoStakeAtFloor".to_string(),
                "voteUncollectedAtFloor".to_string()
            ]
        );
    }

    #[test]
    fn bonds_of_both_configs_are_summed() {
        let listed = protected(
            vec![
                bidding("voteBoth", sol(13)),
                bond("voteBoth", sol(12), BondType::Institutional),
            ],
            &stake(&[("voteBoth", sol(50_000))]),
        );
        assert_eq!(listed, vec!["voteBoth".to_string()]);
    }

    #[test]
    fn a_vote_account_appearing_twice_is_listed_once() {
        let listed = protected(
            vec![
                bidding("voteTwice", sol(25)),
                bidding("voteTwice", sol(500)),
            ],
            &stake(&[("voteTwice", sol(50_000))]),
        );
        assert_eq!(listed, vec!["voteTwice".to_string()]);
    }

    #[test]
    fn stake_still_activating_is_already_covered_by_the_bond() {
        // A bond sized only once the stake goes live leaves the first epoch of it unprotected.
        let listed = protected_snapshot(
            vec![
                bidding("voteActivatingCovered", sol(51)),
                bidding("voteActivatingShort", sol(12)),
            ],
            &collected(&[
                ("voteActivatingCovered", 0, sol(101_000)),
                ("voteActivatingShort", 0, sol(101_000)),
            ]),
        );
        assert_eq!(listed, vec!["voteActivatingCovered".to_string()]);
    }

    #[test]
    fn activating_stake_adds_to_the_effective_stake_of_the_same_validator() {
        let listed = protected_snapshot(
            vec![
                bidding("voteSumCovered", sol(25)),
                bidding("voteSumShort", sol(25) - 1),
            ],
            &collected(&[
                ("voteSumCovered", sol(30_000), sol(20_000)),
                ("voteSumShort", sol(30_000), sol(20_000)),
            ]),
        );
        assert_eq!(listed, vec!["voteSumCovered".to_string()]);
    }
}
