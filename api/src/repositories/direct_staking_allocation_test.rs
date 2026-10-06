use crate::repositories::direct_staking_allocation::{
    allocation_since, report_records, AllocationDocument, AllocationRun,
};
use chrono::{DateTime, TimeZone, Utc};
use rust_decimal::Decimal;
use validator_bonds_common::allocation::{
    AllocationReport, DroppedValidator, ReportTotals, RoutedValidator,
};
use validator_bonds_common::dto::{AllocationOutcome, DirectStakingAllocationRecord};

fn stamp() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 8, 12, 0, 0)
        .single()
        .expect("a fixed valid timestamp")
}

fn totals() -> ReportTotals {
    ReportTotals {
        settlements_in: 0,
        claims_amount_in: 0,
        bidding_settlements: 0,
        bidding_claims_amount: 0,
        institutional_settlements: 0,
        institutional_claims_amount: 0,
        dropped_settlements: 0,
        dropped_claims_amount: 0,
    }
}

fn report(routed: Vec<RoutedValidator>, dropped: Vec<DroppedValidator>) -> AllocationReport {
    AllocationReport {
        epoch: 1030,
        slot: 445_356_003,
        totals: totals(),
        routed,
        dropped_no_usable_bond: dropped,
        exposure_warnings: vec![],
        bidding_bonds_epoch: Some(1030),
        institutional_bonds_epoch: None,
    }
}

fn routed(effective_amount: &str) -> RoutedValidator {
    RoutedValidator {
        vote_account: "voteR".to_string(),
        bond_type: "bidding".to_string(),
        settlements: 2,
        claims_amount: 37_316_490,
        effective_amount: effective_amount.to_string(),
        exposure_bps: 75,
    }
}

fn dropped(bidding: &str, institutional: &str) -> DroppedValidator {
    DroppedValidator {
        vote_account: "voteD".to_string(),
        settlements: 1,
        claims_amount: 1_000,
        bidding_effective_amount: bidding.to_string(),
        institutional_effective_amount: institutional.to_string(),
    }
}

#[test]
fn a_routed_validator_keeps_its_bond_and_the_report_header() {
    let records = report_records(&report(vec![routed("5000000000")], vec![]), stamp())
        .expect("a routed validator is a row");
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(
        (
            record.epoch,
            record.slot,
            record.settlements,
            record.claims_amount,
            record.bidding_bonds_epoch,
            record.institutional_bonds_epoch,
            record.updated_at,
        ),
        (1030, 445_356_003, 2, 37_316_490, Some(1030), None, stamp())
    );
    match &record.outcome {
        AllocationOutcome::Routed {
            bond_type,
            effective_amount,
            exposure_bps,
        } => {
            assert_eq!(bond_type.as_str(), "bidding");
            assert_eq!(*effective_amount, Decimal::from(5_000_000_000u64));
            assert_eq!(*exposure_bps, 75);
        }
        other => panic!("expected a routed outcome, got {other:?}"),
    }
}

#[test]
fn a_dropped_validator_carries_both_amounts_and_no_bond() {
    let records = report_records(&report(vec![], vec![dropped("0", "0")]), stamp())
        .expect("a dropped validator is a row");
    assert_eq!(records.len(), 1);
    match &records[0].outcome {
        AllocationOutcome::Dropped {
            bidding_effective_amount,
            institutional_effective_amount,
        } => {
            assert_eq!(*bidding_effective_amount, Decimal::ZERO);
            assert_eq!(*institutional_effective_amount, Decimal::ZERO);
        }
        other => panic!("expected a dropped outcome, got {other:?}"),
    }
}

#[test]
fn both_buckets_become_rows() {
    let records = report_records(&report(vec![routed("1")], vec![dropped("0", "0")]), stamp())
        .expect("both buckets are rows");
    assert_eq!(
        records
            .iter()
            .map(|record| record.vote_account.as_str())
            .collect::<Vec<_>>(),
        vec!["voteR", "voteD"]
    );
}

#[test]
fn a_report_that_routed_nothing_has_no_rows() {
    assert!(report_records(&report(vec![], vec![]), stamp())
        .expect("an empty report is legal")
        .is_empty());
}

#[test]
fn a_fractional_amount_keeps_its_precision() {
    let records = report_records(&report(vec![routed("0.000000001")], vec![]), stamp())
        .expect("a fractional amount parses");
    match &records[0].outcome {
        AllocationOutcome::Routed {
            effective_amount, ..
        } => assert_eq!(effective_amount.to_string(), "0.000000001"),
        other => panic!("expected a routed outcome, got {other:?}"),
    }
}

#[test]
fn an_unparsable_amount_is_rejected_not_defaulted() {
    let error = report_records(&report(vec![routed("not-a-number")], vec![]), stamp())
        .expect_err("a non-decimal amount is a corrupted report")
        .to_string();
    assert!(error.contains("effective_amount"), "{error}");
    assert!(error.contains("voteR"), "{error}");
}

#[test]
fn an_unparsable_dropped_amount_is_rejected_too() {
    let error = report_records(&report(vec![], vec![dropped("0", "junk")]), stamp())
        .expect_err("a non-decimal amount is a corrupted report")
        .to_string();
    assert!(error.contains("institutional_effective_amount"), "{error}");
}

#[test]
fn an_unknown_bond_type_is_rejected() {
    let mut broken = routed("1");
    broken.bond_type = "sideways".to_string();
    let error = report_records(&report(vec![broken], vec![]), stamp())
        .expect_err("a bond type the API does not know cannot be routed to")
        .to_string();
    assert!(error.contains("Unknown bond type"), "{error}");
}

// The allocator's sentinel for an empty bond. Routing cannot select one, so a routed row carrying
// it is a broken report, and storing it would publish the breakage as a fact.
#[test]
fn the_empty_bond_sentinel_is_rejected_on_a_routed_row() {
    let mut impossible = routed("1");
    impossible.exposure_bps = u64::MAX;
    let error = report_records(&report(vec![impossible], vec![]), stamp())
        .expect_err("the sentinel cannot be a routed row")
        .to_string();
    assert!(error.contains("empty-bond sentinel"), "{error}");
    assert!(error.contains("voteR"), "{error}");
}

fn run(epoch: u64, routed_vote_accounts: &[&str]) -> AllocationRun {
    let routed = routed_vote_accounts
        .iter()
        .map(|vote_account| RoutedValidator {
            vote_account: vote_account.to_string(),
            ..routed("1")
        })
        .collect();
    let report = AllocationReport {
        epoch,
        ..report(routed, vec![])
    };
    AllocationRun {
        slot: 1,
        updated_at: stamp(),
        records: report_records(&report, stamp()).expect("rows"),
    }
}

fn history() -> AllocationDocument {
    AllocationDocument {
        epochs: [
            (1030, run(1030, &["voteB", "voteA"])),
            (1020, run(1020, &[])),
            (1031, run(1031, &["voteC"])),
        ]
        .into_iter()
        .collect(),
    }
}

fn epochs_and_vote_accounts(records: &[DirectStakingAllocationRecord]) -> Vec<(u64, &str)> {
    records
        .iter()
        .map(|record| (record.epoch, record.vote_account.as_str()))
        .collect()
}

#[test]
fn the_history_is_newest_first_and_ordered_by_vote_account_within_an_epoch() {
    let records = allocation_since(history(), None);
    assert_eq!(
        epochs_and_vote_accounts(&records),
        vec![(1031, "voteC"), (1030, "voteA"), (1030, "voteB")]
    );
}

#[test]
fn from_epoch_keeps_that_epoch_on() {
    let records = allocation_since(history(), Some(1030));
    assert_eq!(
        epochs_and_vote_accounts(&records),
        vec![(1031, "voteC"), (1030, "voteA"), (1030, "voteB")]
    );
    assert_eq!(
        epochs_and_vote_accounts(&allocation_since(history(), Some(1031))),
        vec![(1031, "voteC")]
    );
}

#[test]
fn a_window_past_the_newest_epoch_is_empty_not_an_error() {
    assert!(allocation_since(history(), Some(1032)).is_empty());
}

// An epoch's key survives a JSON round trip as a number, and an empty run survives as a run.
#[test]
fn the_document_reads_back_as_it_was_written() {
    let written = serde_json::to_string(&history()).expect("the document serializes");
    let parsed: AllocationDocument = serde_json::from_str(&written).expect("and parses back");
    assert_eq!(
        parsed.epochs.keys().copied().collect::<Vec<_>>(),
        vec![1020, 1030, 1031]
    );
    assert!(parsed.epochs[&1020].records.is_empty());
    assert_eq!(
        serde_json::to_string(&parsed).expect("the parsed document serializes"),
        written
    );
}
