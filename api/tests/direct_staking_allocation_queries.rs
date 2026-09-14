//! Exercises `direct_staking_allocation` against a real Postgres: the 14-column insert with its
//! nullable parameters, the CHECK constraints that encode the routed/dropped union, the epoch
//! replace, and the read that rebuilds `AllocationOutcome` from a row. None of that can fail in a
//! unit test — it only fails at the server.
//!
//! Skipped unless `TEST_POSTGRES_URL` is set. To run it, follow "Starting Develoment PostgreSQL
//! with Docker" in `api/README.md`, then:
//!
//! TEST_POSTGRES_URL="postgresql://validator-bonds:validator-bonds@localhost:5444/validator-bonds" \
//!   cargo test -p api --test direct_staking_allocation_queries

use api::repositories::direct_staking_allocation::{
    get_direct_staking_allocation, get_latest_allocation_epoch, replace_epoch_allocation,
};
use chrono::{DateTime, TimeZone, Utc};
use rust_decimal::Decimal;
use tokio_postgres::{Client, NoTls};
use validator_bonds_common::dto::{AllocationOutcome, BondType, DirectStakingAllocationRecord};

/// Far above any real epoch, so a run against a populated database cannot disturb it.
const FIRST: i32 = 900_001;
const LAST: i32 = 900_002;

fn stamp() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 8, 12, 0, 0).unwrap()
}

fn record(
    epoch: i32,
    vote_account: &str,
    outcome: AllocationOutcome,
) -> DirectStakingAllocationRecord {
    DirectStakingAllocationRecord {
        epoch: epoch as u64,
        slot: i64::from(epoch) as u64 * 1000,
        vote_account: vote_account.to_string(),
        settlements: 2,
        claims_amount: 37_316_490,
        bidding_bonds_epoch: Some(epoch as u64),
        institutional_bonds_epoch: None,
        outcome,
        updated_at: stamp(),
    }
}

fn routed(effective_amount: Decimal) -> AllocationOutcome {
    AllocationOutcome::Routed {
        bond_type: BondType::Bidding,
        effective_amount,
        exposure_bps: 75,
    }
}

fn dropped() -> AllocationOutcome {
    AllocationOutcome::Dropped {
        bidding_effective_amount: Decimal::ZERO,
        institutional_effective_amount: Decimal::ZERO,
    }
}

async fn store(client: &mut Client, epoch: i32, records: &[DirectStakingAllocationRecord]) {
    let tx = client.transaction().await.unwrap();
    replace_epoch_allocation(&tx, epoch, records).await.unwrap();
    tx.commit().await.unwrap();
}

async fn clean(client: &Client) {
    client
        .execute(
            "DELETE FROM direct_staking_allocation WHERE epoch BETWEEN $1 AND $2",
            &[&FIRST, &LAST],
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn allocation_queries_run_against_postgres() {
    let Ok(url) = std::env::var("TEST_POSTGRES_URL") else {
        eprintln!("TEST_POSTGRES_URL not set, skipping");
        return;
    };

    let (mut client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
    tokio::spawn(async move { connection.await.unwrap() });

    clean(&client).await;

    // A fractional amount is why the report quotes its decimals: NUMERIC keeps it, a double would not.
    let fractional = Decimal::new(50_000_000_005, 1);
    store(
        &mut client,
        FIRST,
        &[
            record(FIRST, "voteRouted", routed(fractional)),
            record(FIRST, "voteDropped", dropped()),
        ],
    )
    .await;
    store(
        &mut client,
        LAST,
        &[record(LAST, "voteRouted", routed(Decimal::ONE))],
    )
    .await;

    let all = get_direct_staking_allocation(&client, Some(FIRST as u64))
        .await
        .unwrap();
    assert_eq!(
        all.iter()
            .map(|r| (r.epoch, r.vote_account.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (LAST as u64, "voteRouted"),
            (FIRST as u64, "voteDropped"),
            (FIRST as u64, "voteRouted"),
        ],
        "epoch-descending, then by vote account"
    );

    let first_routed = all
        .iter()
        .find(|r| r.epoch == FIRST as u64 && r.vote_account == "voteRouted")
        .unwrap();
    assert_eq!(
        (
            first_routed.slot,
            first_routed.settlements,
            first_routed.claims_amount,
            first_routed.bidding_bonds_epoch,
            first_routed.institutional_bonds_epoch,
            first_routed.updated_at,
        ),
        (
            i64::from(FIRST) as u64 * 1000,
            2,
            37_316_490,
            Some(FIRST as u64),
            None,
            stamp(),
        )
    );
    match &first_routed.outcome {
        AllocationOutcome::Routed {
            bond_type,
            effective_amount,
            exposure_bps,
        } => {
            assert_eq!(bond_type.as_str(), "bidding");
            assert_eq!(*effective_amount, fractional, "NUMERIC kept the fraction");
            assert_eq!(*exposure_bps, 75);
        }
        other => panic!("expected routed, got {other:?}"),
    }

    let first_dropped = all
        .iter()
        .find(|r| r.vote_account == "voteDropped")
        .unwrap();
    assert!(
        matches!(first_dropped.outcome, AllocationOutcome::Dropped { .. }),
        "a dropped row must read back as dropped, never as a half-filled routed one"
    );

    let windowed = get_direct_staking_allocation(&client, Some(LAST as u64))
        .await
        .unwrap();
    assert_eq!(
        windowed.len(),
        1,
        "from_epoch excludes the earlier epoch entirely"
    );

    // Replacing an epoch must drop a validator the allocator no longer reports, which an upsert
    // would leave behind still claiming stake.
    store(
        &mut client,
        FIRST,
        &[record(FIRST, "voteRouted", routed(Decimal::TWO))],
    )
    .await;
    let replaced = get_direct_staking_allocation(&client, Some(FIRST as u64))
        .await
        .unwrap();
    assert_eq!(
        replaced
            .iter()
            .filter(|r| r.epoch == FIRST as u64)
            .map(|r| r.vote_account.as_str())
            .collect::<Vec<_>>(),
        vec!["voteRouted"],
        "voteDropped is gone after the replace"
    );

    // The legitimate epoch-1020 case: the allocator ran and routed nothing.
    store(&mut client, FIRST, &[]).await;
    let emptied = get_direct_staking_allocation(&client, Some(FIRST as u64))
        .await
        .unwrap();
    assert!(emptied.iter().all(|r| r.epoch != FIRST as u64));

    let latest = get_latest_allocation_epoch(&client).await.unwrap();
    assert_eq!(latest, Some(LAST as u64));

    let beyond = get_direct_staking_allocation(&client, Some(LAST as u64 + 1))
        .await
        .unwrap();
    assert!(beyond.is_empty(), "an empty window is empty, not an error");

    assert_constraints_reject_malformed_rows(&client).await;

    clean(&client).await;
}

/// The CHECK constraints are the database half of the `AllocationOutcome` invariant. A row that
/// slipped past them would read back through `map_allocation_row` as an error, so both halves have
/// to hold for the endpoint to be trustworthy.
async fn assert_constraints_reject_malformed_rows(client: &Client) {
    let cases: [(&str, &str); 5] = [
        (
            "unknown outcome",
            "INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, settlements, claims_amount, updated_at)
             VALUES (900001, 1, 'v', 'sideways', 1, 1, now())",
        ),
        (
            "routed without its bond",
            "INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, settlements, claims_amount, updated_at)
             VALUES (900001, 1, 'v', 'routed', 1, 1, now())",
        ),
        (
            "routed without exposure_bps",
            "INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, bond_type, settlements, claims_amount, effective_amount, updated_at)
             VALUES (900001, 1, 'v', 'routed', 'bidding', 1, 1, 5, now())",
        ),
        (
            "dropped carrying a bond_type",
            "INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, bond_type, settlements, claims_amount, bidding_effective_amount, institutional_effective_amount, updated_at)
             VALUES (900001, 1, 'v', 'dropped', 'bidding', 1, 1, 0, 0, now())",
        ),
        (
            "dropped missing one amount",
            "INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, settlements, claims_amount, bidding_effective_amount, updated_at)
             VALUES (900001, 1, 'v', 'dropped', 1, 1, 0, now())",
        ),
    ];

    for (label, statement) in cases {
        let error = client
            .execute(statement, &[])
            .await
            .expect_err(&format!("{label} must be rejected by a CHECK constraint"));
        assert_eq!(
            error.code(),
            Some(&tokio_postgres::error::SqlState::CHECK_VIOLATION),
            "{label} was rejected, but not by a CHECK: {error}",
        );
    }

    client
        .execute(
            "INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, settlements, claims_amount, bidding_effective_amount, institutional_effective_amount, updated_at)
             VALUES (900001, 1, 'vUnique', 'dropped', 1, 1, 0, 0, now())",
            &[],
        )
        .await
        .unwrap();
    let duplicate = client
        .execute(
            "INSERT INTO direct_staking_allocation (epoch, slot, vote_account, outcome, settlements, claims_amount, bidding_effective_amount, institutional_effective_amount, updated_at)
             VALUES (900001, 1, 'vUnique', 'dropped', 1, 1, 0, 0, now())",
            &[],
        )
        .await
        .expect_err("one validator cannot have two outcomes in one epoch");
    assert_eq!(
        duplicate.code(),
        Some(&tokio_postgres::error::SqlState::UNIQUE_VIOLATION),
        "{duplicate}",
    );
}
