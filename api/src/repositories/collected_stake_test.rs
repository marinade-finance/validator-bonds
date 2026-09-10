use crate::repositories::collected_stake::collected_stake;
use chrono::{DateTime, TimeZone, Utc};
use validator_bonds_common::dto::CollectedStakeRecord;

// Fixed, not `Utc::now()`: two records of one run carry the very same stamp, and the check
// under test is what rejects them when they do not.
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
