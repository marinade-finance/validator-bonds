use crate::context::WrappedContext;
use crate::error::{ApiError, AppError, BadRequest};
use crate::repositories::collected_stake::{
    filter_snapshots, get_collected_stake_window, get_latest_collected_epoch, CollectedStakeQuery,
    CollectedStakeSnapshot,
};
use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::LazyLock;

/// Wide enough that `from_epoch` alone behaves like it does on `/v1/protected-events` for any
/// realistic history, while still bounding the response and the reads behind it, one per epoch:
/// one epoch is ~270 rows, so the cap is roughly half of what `/v1/protected-events` already
/// serves unfiltered.
const MAX_EPOCH_WINDOW: u64 = 100;

/// Per-authority amounts, named rather than a `authority -> lamports` map, so a further amount stays
/// an additive change. `deactivating` is a subset of `effective`, not an addend.
#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct AuthorityStake {
    /// The Marinade product that routed this stake. A `-exit` label (`direct-exit`, `native-exit`,
    /// `select-exit`) is stake on its way out: exiting rotates the staker authority to the exit
    /// authority before deactivating, so out-flow is only ever readable under a `-exit` label, and
    /// the in-flow label's own `deactivating` is structurally zero.
    label: String,
    #[schema(value_type = Pubkey)]
    stake_authority: String,
    /// Stake earning rewards at this snapshot, cooling-down stake included.
    effective: u64,
    /// Stake that will start earning next epoch. Not part of `effective` yet.
    activating: u64,
    /// Stake that entered cooldown in this epoch, which need not be the epoch the exit was
    /// initiated in: rotating the staker authority and requesting deactivation are separate
    /// transactions. A subset of `effective`, never an addend, so active-only is
    /// `effective - deactivating`. Visible for the cooldown epoch only; once a position has fully
    /// cooled down it is no longer reported at all.
    deactivating: u64,
    stake_accounts: u32,
}

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct ValidatorStake {
    #[schema(value_type = Pubkey)]
    vote_account: String,
    /// Sum of `effective` over every authority. See `/v1/validators/protected` for bond sizing.
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

#[derive(Serialize, Debug, utoipa::ToSchema)]
pub struct CollectedStakeHistoryResponse {
    epochs: Vec<CollectedStakeResponse>,
}

#[derive(Deserialize, Serialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryParams {
    /// Report epochs from this one on, inclusive. Defaults to `to_epoch`, i.e. the latest epoch only.
    pub from_epoch: Option<u64>,
    /// Report epochs up to this one, inclusive. Defaults to the latest collected epoch.
    pub to_epoch: Option<u64>,
    /// Comma-separated staker labels, e.g. `direct,direct-exit`. All labels when omitted. Not a
    /// repeated parameter.
    pub label: Option<String>,
    /// Comma-separated vote accounts. Every validator when omitted. Not a repeated parameter.
    pub vote_account: Option<String>,
}

#[derive(Deserialize)]
struct CollectorConfig {
    collect_stake_authorities: Vec<CollectorAuthority>,
}

#[derive(Deserialize)]
struct CollectorAuthority {
    label: String,
}

/// The configured labels, not the stored ones: an authority with no non-zero stake anywhere writes
/// no rows at all, so `direct-exit` and `select-exit` are routinely absent from the stored
/// documents while staying perfectly valid filters.
static CONFIGURED_LABELS: LazyLock<Vec<String>> = LazyLock::new(|| {
    let config: CollectorConfig =
        serde_yaml::from_str(include_str!("../../../collector-config.yaml"))
            .expect("collector-config.yaml is compiled in and must parse");
    config
        .collect_stake_authorities
        .into_iter()
        .map(|authority| authority.label)
        .collect()
});

fn parse_csv(raw: Option<&str>) -> Vec<String> {
    raw.into_iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

/// Canonicalised through `Pubkey`, so a filter matches what the collector wrote. A malformed one is
/// rejected rather than dropped: silently ignoring it would answer with another validator's stake.
fn parse_vote_accounts(raw: &[String]) -> Result<Vec<String>, BadRequest> {
    raw.iter()
        .map(|value| {
            Pubkey::from_str(value)
                .map(|pubkey| pubkey.to_string())
                .map_err(|_| BadRequest {
                    message: format!("vote_account '{value}' is not a valid pubkey"),
                })
        })
        .collect()
}

fn unknown_labels(requested: &[String], known: &[String]) -> Vec<String> {
    requested
        .iter()
        .filter(|label| !known.contains(label))
        .cloned()
        .collect()
}

/// A label dropped from the config keeps its historical rows, and those stay queryable: whatever
/// the window's documents carry is known.
fn stored_labels(snapshots: &[CollectedStakeSnapshot]) -> Vec<String> {
    snapshots
        .iter()
        .flat_map(|snapshot| &snapshot.records)
        .map(|record| record.label.clone())
        .collect()
}

fn resolve_window(
    from_epoch: Option<u64>,
    to_epoch: Option<u64>,
    latest: u64,
) -> Result<(u64, u64), BadRequest> {
    let to_epoch = to_epoch.unwrap_or(latest);
    let from_epoch = from_epoch.unwrap_or(to_epoch);

    if from_epoch > to_epoch {
        return Err(BadRequest {
            message: format!("from_epoch {from_epoch} is after to_epoch {to_epoch}"),
        });
    }
    let width = to_epoch - from_epoch;
    if width >= MAX_EPOCH_WINDOW {
        return Err(BadRequest {
            message: format!(
                "epoch window of {} epochs exceeds the maximum of {MAX_EPOCH_WINDOW}",
                width.saturating_add(1)
            ),
        });
    }
    Ok((from_epoch, to_epoch))
}

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
    params(QueryParams),
    responses(
        (status = 200, description = "Stake routed to each validator through the Marinade products the collector tracks, one element per epoch, newest first. With no parameters that is the latest collected epoch alone. An epoch absent from the range was never collected, or none of its rows passed the filters — it does not mean no validator had stake, and nothing is interpolated. `totals` aggregate only the rows the filters returned, so a filtered call carries filtered totals.\n\nOut-flow is read from the `-exit` labels (`label=direct,direct-exit` pairs a product with its exit), and only for the epoch a position is cooling down in: one snapshot per epoch means a missed collection loses that event permanently. Two things are never reported, because neither can be attributed to a validator: stake a staker authority holds without delegating it, and a position that has finished cooling down.", body = CollectedStakeHistoryResponse),
        (status = 400, description = "`from_epoch` is after `to_epoch`, the window is wider than 100 epochs, `vote_account` is not a valid pubkey, or `label` is neither a configured staker label nor one the window's epochs carry."),
        (status = 500, description = "No stake has been collected yet, or it could not be read. Deliberately not an empty list, which would read as 'no validator has stake'."),
    )
)]
pub async fn handler(
    State(context): State<WrappedContext>,
    Query(query_params): Query<QueryParams>,
) -> Result<Json<CollectedStakeHistoryResponse>, ApiError> {
    let context = context.read().await;

    let latest = get_latest_collected_epoch(&context.directory)
        .await
        .map_err(|error| AppError {
            message: format!("Failed to fetch the latest collected epoch. Error: {error:?}"),
        })?
        .ok_or_else(|| AppError {
            message: "No collected stake stored yet".to_string(),
        })?;

    let labels = parse_csv(query_params.label.as_deref());
    let vote_accounts = parse_vote_accounts(&parse_csv(query_params.vote_account.as_deref()))?;
    let (from_epoch, to_epoch) =
        resolve_window(query_params.from_epoch, query_params.to_epoch, latest)?;

    let snapshots = get_collected_stake_window(&context.directory, from_epoch, to_epoch)
        .await
        .map_err(|error| AppError {
            message: format!("Failed to fetch collected stake. Error: {error:?}"),
        })?;

    let unconfigured = unknown_labels(&labels, &CONFIGURED_LABELS);
    if !unconfigured.is_empty() {
        let unknown = unknown_labels(&unconfigured, &stored_labels(&snapshots));
        if !unknown.is_empty() {
            return Err(BadRequest {
                message: format!(
                    "unknown label(s) {}; configured labels are {}",
                    unknown.join(", "),
                    CONFIGURED_LABELS.join(", ")
                ),
            }
            .into());
        }
    }

    let query = CollectedStakeQuery {
        labels,
        vote_accounts,
    };
    Ok(Json(CollectedStakeHistoryResponse {
        epochs: filter_snapshots(snapshots, &query)
            .into_iter()
            .map(build_response)
            .collect(),
    }))
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

    fn snapshot(records: Vec<CollectedStakeRecord>) -> CollectedStakeSnapshot {
        CollectedStakeSnapshot {
            epoch: 1014,
            slot: 438413520,
            updated_at: Utc::now(),
            records,
        }
    }

    fn response(records: Vec<CollectedStakeRecord>) -> CollectedStakeResponse {
        build_response(snapshot(records))
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

    #[test]
    fn csv_is_split_trimmed_and_compacted() {
        assert_eq!(parse_csv(None), Vec::<String>::new());
        assert_eq!(parse_csv(Some("")), Vec::<String>::new());
        assert_eq!(parse_csv(Some(" , ,")), Vec::<String>::new());
        assert_eq!(
            parse_csv(Some(" direct , direct-exit ")),
            vec!["direct".to_string(), "direct-exit".to_string()]
        );
    }

    #[test]
    fn vote_accounts_are_canonicalised() {
        let valid = "We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb".to_string();
        assert_eq!(
            parse_vote_accounts(&[valid.clone()]).unwrap(),
            vec![valid.clone()]
        );
        assert_eq!(parse_vote_accounts(&[]).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn a_malformed_vote_account_is_rejected_not_dropped() {
        let error = parse_vote_accounts(&["notapubkey".to_string()]).unwrap_err();
        assert!(error.message.contains("notapubkey"), "{}", error.message);
    }

    #[test]
    fn no_parameters_resolve_to_the_latest_epoch_alone() {
        assert_eq!(resolve_window(None, None, 1030).unwrap(), (1030, 1030));
    }

    #[test]
    fn from_epoch_alone_runs_to_the_latest_epoch() {
        assert_eq!(
            resolve_window(Some(1020), None, 1030).unwrap(),
            (1020, 1030)
        );
    }

    #[test]
    fn to_epoch_alone_reports_that_epoch_alone() {
        assert_eq!(
            resolve_window(None, Some(1020), 1030).unwrap(),
            (1020, 1020)
        );
    }

    #[test]
    fn an_inverted_window_is_rejected() {
        let error = resolve_window(Some(1030), Some(1020), 1030).unwrap_err();
        assert!(
            error.message.contains("after to_epoch"),
            "{}",
            error.message
        );
    }

    #[test]
    fn the_widest_allowed_window_is_accepted() {
        let from = 1030 - MAX_EPOCH_WINDOW + 1;
        assert_eq!(
            resolve_window(Some(from), Some(1030), 1030).unwrap(),
            (from, 1030)
        );
    }

    #[test]
    fn one_epoch_past_the_cap_is_rejected() {
        let error = resolve_window(Some(1030 - MAX_EPOCH_WINDOW), Some(1030), 1030).unwrap_err();
        assert!(
            error.message.contains("exceeds the maximum"),
            "{}",
            error.message
        );
    }

    // An epoch past the latest is a window the store has nothing for, not an error.
    #[test]
    fn a_window_past_the_latest_epoch_is_accepted() {
        assert_eq!(
            resolve_window(None, Some(u64::MAX), 1030).unwrap(),
            (u64::MAX, u64::MAX)
        );
    }

    // The widest window there is: its size does not fit a u64, and it must be a 400, not a panic.
    #[test]
    fn the_whole_epoch_range_is_rejected_not_overflowed() {
        let error = resolve_window(Some(0), Some(u64::MAX), 1030).unwrap_err();
        assert!(
            error.message.contains("exceeds the maximum"),
            "{}",
            error.message
        );
    }

    // The seven authorities of collector-config.yaml, so a config edit that the API must learn
    // about fails here rather than at a 400 in production.
    #[test]
    fn every_configured_label_is_a_valid_filter() {
        let mut labels = CONFIGURED_LABELS.clone();
        labels.sort();
        assert_eq!(
            labels,
            vec![
                "direct",
                "direct-exit",
                "liquid",
                "native",
                "native-exit",
                "select",
                "select-exit"
            ]
        );
    }

    // The two exit labels have no rows until someone exits, and they are exactly what the exit
    // documentation tells callers to query.
    #[test]
    fn the_exit_labels_are_accepted_though_they_have_no_rows() {
        assert!(unknown_labels(
            &["direct-exit".to_string(), "select-exit".to_string()],
            &CONFIGURED_LABELS
        )
        .is_empty());
    }

    #[test]
    fn a_typo_is_reported_as_unknown() {
        assert_eq!(
            unknown_labels(
                &["direct".to_string(), "dyrect".to_string()],
                &CONFIGURED_LABELS
            ),
            vec!["dyrect".to_string()]
        );
    }

    #[test]
    fn a_label_the_window_carries_is_known_though_unconfigured() {
        let window = vec![snapshot(vec![record("retired", "voteA", 1)])];
        assert_eq!(stored_labels(&window), vec!["retired".to_string()]);
        assert!(unknown_labels(&["retired".to_string()], &stored_labels(&window)).is_empty());
    }
}
