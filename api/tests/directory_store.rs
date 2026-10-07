//! The store round-trips: what the CLI writes is what the API serves.
//!
//! Each test owns a marinade-directory of its own (see `common`), drives the real
//! store commands, and reads the result back over HTTP from the production router.

mod common;

use api::repositories::bond::store_bonds;
use api::repositories::collected_stake::{get_collected_stake, store_collected_stake};
use api::repositories::direct_staking_allocation::{
    store_direct_staking_allocation, ALLOCATION_PATH,
};
use chrono::{TimeZone, Utc};
use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use validator_bonds_common::allocation::{
    AllocationReport, DroppedValidator, ReportTotals, RoutedValidator,
};
use validator_bonds_common::directory::Precondition;
use validator_bonds_common::dto::{BondType, CollectedStakeRecord, ValidatorBondRecord};

fn sol(amount: u64) -> u64 {
    amount * 1_000_000_000
}

fn bond(
    vote_account: &str,
    epoch: u64,
    bond_type: BondType,
    effective_lamports: u64,
) -> ValidatorBondRecord {
    ValidatorBondRecord {
        pubkey: format!("{vote_account}-bond-{epoch}"),
        vote_account: vote_account.to_owned(),
        authority: format!("{vote_account}-authority"),
        cpmpe: Decimal::ZERO,
        max_stake_wanted: Decimal::ZERO,
        epoch,
        funded_amount: Decimal::from(effective_lamports),
        effective_amount: Decimal::from(effective_lamports),
        remaining_witdraw_request_amount: Decimal::ZERO,
        remainining_settlement_claim_amount: Decimal::ZERO,
        updated_at: Utc
            .with_ymd_and_hms(2026, 8, 10, 12, 0, 0)
            .single()
            .expect("a fixed valid timestamp"),
        bond_type,
        inflation_commission_bps: None,
        mev_commission_bps: None,
        block_commission_bps: None,
    }
}

fn stake(vote_account: &str, epoch: u64, effective: u64) -> CollectedStakeRecord {
    CollectedStakeRecord {
        epoch,
        slot: 438413520,
        label: "native".to_owned(),
        stake_authority: "stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq".to_owned(),
        vote_account: vote_account.to_owned(),
        effective,
        activating: 0,
        deactivating: 0,
        stake_accounts: 1,
        updated_at: Utc
            .with_ymd_and_hms(2026, 8, 10, 12, 0, 0)
            .single()
            .expect("a fixed valid timestamp"),
    }
}

fn labelled_stake(
    vote_account: &str,
    epoch: u64,
    label: &str,
    effective: u64,
) -> CollectedStakeRecord {
    CollectedStakeRecord {
        label: label.to_owned(),
        stake_authority: format!("{label}-authority"),
        ..stake(vote_account, epoch, effective)
    }
}

fn allocation_report(
    epoch: u64,
    routed: Vec<RoutedValidator>,
    dropped: Vec<DroppedValidator>,
) -> AllocationReport {
    AllocationReport {
        epoch,
        slot: epoch * 1000,
        totals: ReportTotals {
            settlements_in: 0,
            claims_amount_in: 0,
            bidding_settlements: 0,
            bidding_claims_amount: 0,
            institutional_settlements: 0,
            institutional_claims_amount: 0,
            dropped_settlements: 0,
            dropped_claims_amount: 0,
        },
        routed,
        dropped_no_usable_bond: dropped,
        exposure_warnings: vec![],
        bidding_bonds_epoch: Some(epoch),
        institutional_bonds_epoch: None,
    }
}

fn routed_validator(vote_account: &str) -> RoutedValidator {
    RoutedValidator {
        vote_account: vote_account.to_owned(),
        bond_type: "bidding".to_owned(),
        settlements: 2,
        claims_amount: 37_316_490,
        effective_amount: "5000000000".to_owned(),
        exposure_bps: 75,
    }
}

fn dropped_validator(vote_account: &str) -> DroppedValidator {
    DroppedValidator {
        vote_account: vote_account.to_owned(),
        settlements: 1,
        claims_amount: 1_000,
        bidding_effective_amount: "0".to_owned(),
        institutional_effective_amount: "0".to_owned(),
    }
}

fn epochs_of(response: &serde_json::Value) -> Vec<u64> {
    response["epochs"]
        .as_array()
        .expect("an array of epochs")
        .iter()
        .map(|epoch| epoch["epoch"].as_u64().expect("an epoch number"))
        .collect()
}

fn allocation_rows(response: &serde_json::Value) -> Vec<(u64, String, String)> {
    response["allocation"]
        .as_array()
        .expect("an array of allocation rows")
        .iter()
        .map(|row| {
            (
                row["epoch"].as_u64().expect("an epoch number"),
                row["vote_account"].as_str().unwrap_or_default().to_owned(),
                row["outcome"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect()
}

// A stored set is served as written; a re-run replaces it, so a bond closed since is gone and
// the other bond type has not moved.
#[tokio::test]
async fn stored_bonds_are_what_the_route_serves() {
    let Some(store) = common::start_store().await else {
        return;
    };
    let base = common::spawn_api(common::context(common::directory(&store))).await;

    let one = common::write_yaml("bonds-750", &vec![bond("voteA", 750, BondType::Bidding, 1)]);
    store_bonds(common::store_options(&store, one))
        .await
        .expect("the first run creates the epoch");

    let served = common::get_json(&format!("{base}/bonds/bidding")).await;
    assert_eq!(served["bonds"].as_array().map(Vec::len), Some(1));
    assert_eq!(served["bonds"][0]["vote_account"], "voteA");
    assert_eq!(served["bonds"][0]["epoch"], 750);

    let two = common::write_yaml(
        "bonds-750-rerun",
        &vec![
            bond("voteB", 750, BondType::Bidding, 1),
            bond("voteC", 750, BondType::Bidding, 1),
        ],
    );
    store_bonds(common::store_options(&store, two))
        .await
        .expect("a re-run of the same epoch replaces it");

    let replaced = common::get_json(&format!("{base}/bonds/bidding")).await;
    let vote_accounts: Vec<&str> = replaced["bonds"]
        .as_array()
        .expect("an array of bonds")
        .iter()
        .map(|bond| bond["vote_account"].as_str().unwrap_or_default())
        .collect();
    assert_eq!(vote_accounts, vec!["voteB", "voteC"]);

    let next = common::write_yaml("bonds-751", &vec![bond("voteD", 751, BondType::Bidding, 1)]);
    store_bonds(common::store_options(&store, next))
        .await
        .expect("the next epoch is a new document");

    let latest = common::get_json(&format!("{base}/bonds/bidding")).await;
    assert_eq!(latest["bonds"].as_array().map(Vec::len), Some(1));
    assert_eq!(latest["bonds"][0]["epoch"], 751, "@last must move on");

    let institutional = common::get_json(&format!("{base}/bonds/institutional")).await;
    assert_eq!(institutional["bonds"].as_array().map(Vec::len), Some(0));
}

// Bidding stored through 751 (emptied), institutional only through 750 -> protected is summed at
// 750; each type at its own newest epoch would take the emptied 751 bond.
#[tokio::test]
async fn protected_pins_both_types_to_the_older_newest_epoch() {
    let Some(store) = common::start_store().await else {
        return;
    };
    let base = common::spawn_api(common::context(common::directory(&store))).await;

    let stakes = common::write_yaml(
        "protected-stake",
        &vec![stake("votePinned", 750, sol(2000))],
    );
    store_collected_stake(common::store_options(&store, stakes))
        .await
        .expect("the stake of the epoch is stored");

    let bidding_750 = common::write_yaml(
        "protected-bidding-750",
        &vec![bond("votePinned", 750, BondType::Bidding, sol(1))],
    );
    store_bonds(common::store_options(&store, bidding_750))
        .await
        .expect("the bidding bonds of 750 are stored");
    let bidding_751 = common::write_yaml(
        "protected-bidding-751",
        &vec![bond("votePinned", 751, BondType::Bidding, 0)],
    );
    store_bonds(common::store_options(&store, bidding_751))
        .await
        .expect("the bidding pipeline moves on to 751");
    let institutional_750 = common::write_yaml(
        "protected-institutional-750",
        &vec![bond("voteOther", 750, BondType::Institutional, 0)],
    );
    store_bonds(common::store_options(&store, institutional_750))
        .await
        .expect("the institutional pipeline is still at 750");

    let protected = common::get_json(&format!("{base}/v1/validators/protected")).await;
    assert_eq!(
        protected["protected_validators"]
            .as_array()
            .expect("an array of vote accounts"),
        &vec![serde_json::json!("votePinned")],
    );
}

// A re-run drops the record of a validator that unstaked in between; a mixed file -> refused.
#[tokio::test]
async fn stored_stake_replaces_its_epoch_and_a_mixed_file_is_refused() {
    let Some(store) = common::start_store().await else {
        return;
    };
    let base = common::spawn_api(common::context(common::directory(&store))).await;

    let mixed = common::write_yaml(
        "stake-mixed",
        &vec![stake("voteA", 750, sol(1)), stake("voteB", 751, sol(1))],
    );
    store_collected_stake(common::store_options(&store, mixed))
        .await
        .expect_err("a file spanning two epochs has no one document to be");
    assert!(
        get_collected_stake(&common::directory(&store))
            .await
            .expect("the store answers")
            .is_none(),
        "the refusal must come before anything is written",
    );

    let both = common::write_yaml(
        "stake-750",
        &vec![stake("voteA", 750, sol(1)), stake("voteB", 750, sol(2))],
    );
    store_collected_stake(common::store_options(&store, both))
        .await
        .expect("the epoch is stored");
    let served = common::get_json(&format!("{base}/v1/validators/stake")).await;
    assert_eq!(
        served["epochs"][0]["validators"].as_array().map(Vec::len),
        Some(2)
    );

    let one = common::write_yaml("stake-750-rerun", &vec![stake("voteA", 750, sol(1))]);
    store_collected_stake(common::store_options(&store, one))
        .await
        .expect("a re-run replaces the epoch");
    let replaced = common::get_json(&format!("{base}/v1/validators/stake")).await;
    assert_eq!(epochs_of(&replaced), vec![750]);
    assert_eq!(
        replaced["epochs"][0]["validators"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(
        replaced["epochs"][0]["validators"][0]["vote_account"],
        "voteA"
    );
}

// Epochs 750 and 752 stored, 751 never collected -> a window over all three serves two, newest
// first; the filters narrow rows, an epoch none of whose rows match is left out, and a label no
// configured authority nor stored row carries is refused.
#[tokio::test]
async fn the_stake_window_serves_stored_epochs_newest_first_and_filters_their_rows() {
    let Some(store) = common::start_store().await else {
        return;
    };
    let base = common::spawn_api(common::context(common::directory(&store))).await;
    let direct = Pubkey::new_unique().to_string();
    let native = Pubkey::new_unique().to_string();

    let older = common::write_yaml(
        "stake-window-750",
        &vec![
            labelled_stake(&native, 750, "native", sol(3)),
            labelled_stake(&direct, 750, "direct", sol(1)),
            labelled_stake(&direct, 750, "direct-exit", sol(2)),
        ],
    );
    store_collected_stake(common::store_options(&store, older))
        .await
        .expect("epoch 750 is stored");
    let newer = common::write_yaml(
        "stake-window-752",
        &vec![labelled_stake(&native, 752, "native", sol(3))],
    );
    store_collected_stake(common::store_options(&store, newer))
        .await
        .expect("epoch 752 is stored");

    let route = format!("{base}/v1/validators/stake");
    let latest = common::get_json(&route).await;
    assert_eq!(
        epochs_of(&latest),
        vec![752],
        "no parameters -> the latest epoch alone"
    );

    let window = common::get_json(&format!("{route}?from_epoch=740&to_epoch=760")).await;
    assert_eq!(
        epochs_of(&window),
        vec![752, 750],
        "751 was never collected"
    );

    let exits = common::get_json(&format!(
        "{route}?from_epoch=750&to_epoch=752&label=direct,direct-exit"
    ))
    .await;
    assert_eq!(epochs_of(&exits), vec![750], "752 has no direct row");
    let validators = exits["epochs"][0]["validators"]
        .as_array()
        .expect("an array of validators");
    assert_eq!(validators.len(), 1);
    assert_eq!(validators[0]["vote_account"], direct);
    assert_eq!(validators[0]["stake"].as_array().map(Vec::len), Some(2));
    assert_eq!(
        exits["epochs"][0]["totals"].as_array().map(Vec::len),
        Some(2),
        "totals aggregate the filtered rows only"
    );

    let one = common::get_json(&format!(
        "{route}?from_epoch=750&to_epoch=752&vote_account={native}"
    ))
    .await;
    assert_eq!(epochs_of(&one), vec![752, 750]);
    for epoch in one["epochs"].as_array().expect("an array of epochs") {
        assert_eq!(epoch["validators"].as_array().map(Vec::len), Some(1));
        assert_eq!(epoch["validators"][0]["vote_account"], native);
    }

    let both = common::get_json(&format!(
        "{route}?from_epoch=750&to_epoch=752&label=direct&vote_account={native}"
    ))
    .await;
    assert!(
        epochs_of(&both).is_empty(),
        "the two filters intersect, they do not union"
    );

    let typo = reqwest::get(format!("{route}?label=dyrect"))
        .await
        .expect("the API answers");
    assert_eq!(typo.status(), 400);
}

// Nothing stored -> 500; a report creates the document, a later epoch joins it, a re-run replaces
// its epoch, and a report that routed nothing is on record without a row.
#[tokio::test]
async fn stored_allocation_is_what_the_route_serves() {
    let Some(store) = common::start_store().await else {
        return;
    };
    let base = common::spawn_api(common::context(common::directory(&store))).await;
    let route = format!("{base}/v1/protected-events/allocation");

    let unstored = reqwest::get(&route).await.expect("the API answers");
    assert_eq!(
        unstored.status(),
        500,
        "an empty list would read as nobody dropped"
    );

    let first = common::write_json(
        "allocation-1030",
        &allocation_report(
            1030,
            vec![routed_validator("voteR")],
            vec![dropped_validator("voteD")],
        ),
    );
    store_direct_staking_allocation(common::store_options(&store, first))
        .await
        .expect("the first report creates the document");
    let served = common::get_json(&route).await;
    assert_eq!(
        allocation_rows(&served),
        vec![
            (1030, "voteD".to_owned(), "dropped".to_owned()),
            (1030, "voteR".to_owned(), "routed".to_owned()),
        ]
    );
    assert_eq!(served["allocation"][1]["bond_type"], "bidding");
    assert_eq!(served["allocation"][1]["effective_amount"], 5_000_000_000.0);
    assert_eq!(served["allocation"][1]["exposure_bps"], 75);
    assert_eq!(served["allocation"][0]["bidding_effective_amount"], 0.0);
    assert!(served["allocation"][0].get("bond_type").is_none());

    let next = common::write_json(
        "allocation-1031",
        &allocation_report(1031, vec![routed_validator("voteX")], vec![]),
    );
    store_direct_staking_allocation(common::store_options(&store, next))
        .await
        .expect("a later epoch joins the document");
    let windowed = common::get_json(&format!("{route}?from_epoch=1031")).await;
    assert_eq!(
        allocation_rows(&windowed),
        vec![(1031, "voteX".to_owned(), "routed".to_owned())]
    );
    let all = common::get_json(&route).await;
    assert_eq!(
        allocation_rows(&all)
            .iter()
            .map(|(epoch, vote_account, _)| (*epoch, vote_account.as_str()))
            .collect::<Vec<_>>(),
        vec![(1031, "voteX"), (1030, "voteD"), (1030, "voteR")],
        "newest epoch first, vote accounts in order within one"
    );

    let rerun = common::write_json(
        "allocation-1030-rerun",
        &allocation_report(1030, vec![routed_validator("voteR")], vec![]),
    );
    store_direct_staking_allocation(common::store_options(&store, rerun))
        .await
        .expect("a re-run replaces the epoch");
    let replaced = common::get_json(&route).await;
    assert_eq!(
        allocation_rows(&replaced)
            .iter()
            .map(|(epoch, vote_account, _)| (*epoch, vote_account.as_str()))
            .collect::<Vec<_>>(),
        vec![(1031, "voteX"), (1030, "voteR")],
        "voteD is gone after the replace"
    );

    let empty = common::write_json("allocation-1029", &allocation_report(1029, vec![], vec![]));
    store_direct_staking_allocation(common::store_options(&store, empty))
        .await
        .expect("a report that routed nothing is stored");
    let since = common::get_json(&format!("{route}?from_epoch=1029")).await;
    assert_eq!(allocation_rows(&since).len(), 2, "1029 contributes no row");
    let document = common::directory(&store)
        .get::<serde_json::Value>(ALLOCATION_PATH)
        .await
        .expect("the store answers")
        .expect("the document exists");
    assert_eq!(
        document.body["epochs"]["1029"]["records"]
            .as_array()
            .map(Vec::len),
        Some(0),
        "the run is on record even without a row"
    );

    let beyond = common::get_json(&format!("{route}?from_epoch=1032")).await;
    assert!(
        allocation_rows(&beyond).is_empty(),
        "a window past the newest epoch is empty, not an error"
    );
}

// An entry from an earlier epoch, left by a run whose events failed to post -> not served; only
// entries of the epoch `meta` describes are.
#[tokio::test]
async fn the_auction_context_serves_only_the_pinned_epoch() {
    let Some(store) = common::start_store().await else {
        return;
    };
    let base = common::spawn_api(common::context(common::directory(&store))).await;

    let empty = common::get_json(&format!("{base}/bonds/bidding/auction")).await;
    assert_eq!(
        empty["auction_validators"].as_object().map(|v| v.len()),
        Some(0)
    );

    common::directory(&store)
        .put(
            "/bonds/eventing/bidding",
            &serde_json::json!({
                "epoch": 751,
                "meta": { "epoch": 751 },
                "validators": {
                    "voteCurrent": { "epoch": 751, "auction_validator": { "revShare": 1 } },
                    "voteStale": { "epoch": 750, "auction_validator": { "revShare": 2 } },
                    "voteWithoutBlob": { "epoch": 751 },
                },
            }),
            Precondition::Create,
        )
        .await
        .expect("the eventing document is written");

    let context = common::get_json(&format!("{base}/bonds/bidding/auction")).await;
    assert_eq!(context["auction_meta"]["epoch"], 751);
    let validators = context["auction_validators"]
        .as_object()
        .expect("a map of vote accounts");
    assert_eq!(validators.keys().collect::<Vec<_>>(), vec!["voteCurrent"]);
    assert_eq!(validators["voteCurrent"]["revShare"], 1);
}

#[tokio::test]
async fn readyz_answers_200_with_the_store_up() {
    let Some(store) = common::start_store().await else {
        return;
    };
    let base = common::spawn_internal(common::context(common::directory(&store))).await;
    let probe = reqwest::get(format!("{base}/readyz"))
        .await
        .expect("the internal server answers");
    assert_eq!(probe.status(), 200);
}

#[tokio::test]
async fn readyz_answers_503_with_the_store_down() {
    let unreachable = format!("http://127.0.0.1:{}", common::free_port());
    let directory = validator_bonds_common::directory::Directory::new(&unreachable, "unused");
    let base = common::spawn_internal(common::context(directory)).await;
    let probe = reqwest::get(format!("{base}/readyz"))
        .await
        .expect("the internal server answers");
    assert_eq!(probe.status(), 503);
}
