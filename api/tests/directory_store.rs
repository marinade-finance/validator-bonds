//! The store round-trips: what the CLI writes is what the API serves.
//!
//! Each test owns a marinade-directory of its own (see `common`), drives the real
//! store commands, and reads the result back over HTTP from the production router.

mod common;

use api::repositories::bond::store_bonds;
use api::repositories::collected_stake::{get_collected_stake, store_collected_stake};
use chrono::{TimeZone, Utc};
use rust_decimal::Decimal;
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
    assert_eq!(served["validators"].as_array().map(Vec::len), Some(2));

    let one = common::write_yaml("stake-750-rerun", &vec![stake("voteA", 750, sol(1))]);
    store_collected_stake(common::store_options(&store, one))
        .await
        .expect("a re-run replaces the epoch");
    let replaced = common::get_json(&format!("{base}/v1/validators/stake")).await;
    assert_eq!(replaced["validators"].as_array().map(Vec::len), Some(1));
    assert_eq!(replaced["validators"][0]["vote_account"], "voteA");
    assert_eq!(replaced["epoch"], 750);
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
