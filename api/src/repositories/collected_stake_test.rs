use crate::repositories::collected_stake::{
    collected_stake, filter_snapshots, CollectedStakeQuery, CollectedStakeSnapshot,
};
use chrono::{DateTime, TimeZone, Utc};
use validator_bonds_common::dto::CollectedStakeRecord;

fn stamp(seconds: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 10, 12, 0, seconds)
        .single()
        .expect("a fixed valid timestamp")
}

fn record(epoch: u64) -> CollectedStakeRecord {
    CollectedStakeRecord {
        epoch,
        slot: 438413520,
        label: "native".to_owned(),
        stake_authority: "stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq".to_owned(),
        vote_account: "We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb".to_owned(),
        effective: 1,
        activating: 0,
        deactivating: 0,
        stake_accounts: 1,
        updated_at: stamp(0),
    }
}

fn snapshot(records: Vec<CollectedStakeRecord>) -> CollectedStakeSnapshot {
    CollectedStakeSnapshot {
        epoch: 1014,
        slot: 438413520,
        updated_at: stamp(0),
        records,
    }
}

fn stake_record(
    vote_account: &str,
    label: &str,
    effective: u64,
    activating: u64,
    deactivating: u64,
) -> CollectedStakeRecord {
    CollectedStakeRecord {
        vote_account: vote_account.to_owned(),
        label: label.to_owned(),
        stake_authority: format!("{label}-authority"),
        effective,
        activating,
        deactivating,
        ..record(1014)
    }
}

fn query(labels: &[&str], vote_accounts: &[&str]) -> CollectedStakeQuery {
    CollectedStakeQuery {
        labels: labels.iter().map(|label| label.to_string()).collect(),
        vote_accounts: vote_accounts
            .iter()
            .map(|vote_account| vote_account.to_string())
            .collect(),
    }
}

fn labelled(snapshots: &[CollectedStakeSnapshot]) -> Vec<(u64, Vec<(String, String)>)> {
    snapshots
        .iter()
        .map(|snapshot| {
            (
                snapshot.epoch,
                snapshot
                    .records
                    .iter()
                    .map(|record| (record.label.clone(), record.vote_account.clone()))
                    .collect(),
            )
        })
        .collect()
}

#[test]
fn activating_stake_counts_towards_the_amount_to_cover() {
    let to_cover = snapshot(vec![stake_record(
        "voteActivating",
        "direct",
        0,
        101_000,
        0,
    )])
    .stake_to_cover_by_vote_account();
    assert_eq!(to_cover.get("voteActivating"), Some(&101_000));
}

// Deactivating stake is still effective for the epoch -> only effective + activating is covered.
#[test]
fn deactivating_stake_is_not_added_on_top_of_effective() {
    let to_cover = snapshot(vec![stake_record(
        "voteDeactivating",
        "native",
        500,
        0,
        500,
    )])
    .stake_to_cover_by_vote_account();
    assert_eq!(to_cover.get("voteDeactivating"), Some(&500));
}

#[test]
fn every_authority_of_a_vote_account_is_summed() {
    let to_cover = snapshot(vec![
        stake_record("voteMulti", "native", 10, 1, 0),
        stake_record("voteMulti", "select", 20, 2, 0),
        stake_record("voteMulti", "direct", 0, 4, 0),
        stake_record("voteOther", "native", 7, 0, 0),
    ])
    .stake_to_cover_by_vote_account();
    assert_eq!(to_cover.get("voteMulti"), Some(&37));
    assert_eq!(to_cover.get("voteOther"), Some(&7));
}

#[test]
fn one_epoch_is_accepted() {
    let snapshot =
        collected_stake(vec![record(1014), record(1014)]).expect("one epoch is storable");
    assert_eq!((snapshot.epoch, snapshot.records.len()), (1014, 2));
}

#[test]
fn an_empty_collection_is_rejected() {
    collected_stake(vec![]).expect_err("an empty file must not empty the epoch");
}

#[test]
fn mixed_epochs_are_rejected() {
    let err = collected_stake(vec![record(1014), record(1013)]).expect_err("two epochs");
    assert!(err.to_string().contains("multiple epochs"));
}

#[test]
fn mixed_slots_are_rejected() {
    let mut second = record(1014);
    second.slot += 1;
    let err = collected_stake(vec![record(1014), second]).expect_err("two slots");
    assert!(err.to_string().contains("multiple slots"));
}

#[test]
fn mixed_timestamps_are_rejected() {
    let mut second = record(1014);
    second.updated_at = stamp(1);
    let err = collected_stake(vec![record(1014), second]).expect_err("two timestamps");
    assert!(err.to_string().contains("multiple timestamps"));
}

fn window() -> Vec<CollectedStakeSnapshot> {
    let mut older = snapshot(vec![
        stake_record("voteDirect", "direct", 10, 0, 0),
        stake_record("voteDirect", "direct-exit", 20, 0, 0),
        stake_record("voteNative", "native", 30, 0, 0),
    ]);
    older.epoch = 1013;
    vec![
        snapshot(vec![stake_record("voteNative", "native", 30, 0, 0)]),
        older,
    ]
}

#[test]
fn no_filter_keeps_every_record_of_every_epoch() {
    let kept = filter_snapshots(window(), &query(&[], &[]));
    assert_eq!(
        kept.iter()
            .map(|snapshot| (snapshot.epoch, snapshot.records.len()))
            .collect::<Vec<_>>(),
        vec![(1014, 1), (1013, 3)]
    );
}

#[test]
fn a_label_filter_keeps_its_rows_and_drops_an_epoch_without_any() {
    let kept = filter_snapshots(window(), &query(&["direct", "direct-exit"], &[]));
    assert_eq!(
        labelled(&kept),
        vec![(
            1013,
            vec![
                ("direct".to_owned(), "voteDirect".to_owned()),
                ("direct-exit".to_owned(), "voteDirect".to_owned()),
            ]
        )]
    );
}

#[test]
fn a_vote_account_filter_keeps_that_validator_in_every_epoch() {
    let kept = filter_snapshots(window(), &query(&[], &["voteNative"]));
    assert_eq!(
        labelled(&kept),
        vec![
            (1014, vec![("native".to_owned(), "voteNative".to_owned())]),
            (1013, vec![("native".to_owned(), "voteNative".to_owned())]),
        ]
    );
}

// The two filters intersect, they do not union.
#[test]
fn the_filters_intersect() {
    assert!(filter_snapshots(window(), &query(&["direct"], &["voteNative"])).is_empty());
}

#[test]
fn a_label_no_epoch_carries_matches_nothing() {
    assert!(filter_snapshots(window(), &query(&["dyrect"], &[])).is_empty());
}
