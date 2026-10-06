//! Exercises the `collected_stake` SQL against a real Postgres, which the unit tests in
//! `api/src/repositories/collected_stake.rs` cannot do — parameter binding, the `cardinality`
//! filter guards and `ORDER BY epoch DESC` only fail at the server.
//!
//! Skipped unless `TEST_POSTGRES_URL` is set. To run it, follow "Starting Develoment PostgreSQL
//! with Docker" in `api/README.md`, then:
//!
//! TEST_POSTGRES_URL="postgresql://validator-bonds:validator-bonds@localhost:5444/validator-bonds" \
//!   cargo test -p api --test collected_stake_queries -- --nocapture

use api::repositories::collected_stake::{
    get_collected_stake, get_collected_stake_range, get_distinct_labels,
    get_latest_collected_epoch, CollectedStakeQuery,
};
use chrono::{DateTime, TimeZone, Utc};
use tokio_postgres::{Client, NoTls};

/// Far above any real epoch, so a run against a populated database cannot disturb it.
const FIRST: i32 = 900_001;
const LAST: i32 = 900_004;

fn stamp(epoch: i32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, (epoch - FIRST) as u32)
        .unwrap()
}

fn query(from_epoch: u64, to_epoch: u64) -> CollectedStakeQuery {
    CollectedStakeQuery {
        from_epoch,
        to_epoch,
        labels: vec![],
        vote_accounts: vec![],
    }
}

async fn insert(client: &Client, epoch: i32, label: &str, vote_account: &str, effective: i64) {
    client
        .execute(
            "INSERT INTO collected_stake (epoch, slot, label, stake_authority, vote_account,
                                          effective, activating, deactivating, stake_accounts, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 1, $7)",
            &[
                &epoch,
                &(i64::from(epoch) * 1000),
                &label,
                &format!("{label}-authority"),
                &vote_account,
                &effective,
                &stamp(epoch),
            ],
        )
        .await
        .unwrap();
}

async fn seed(client: &Client) {
    client
        .execute(
            "DELETE FROM collected_stake WHERE epoch BETWEEN $1 AND $2",
            &[&FIRST, &LAST],
        )
        .await
        .unwrap();

    // 900_003 is deliberately absent: a gap must be reported as a gap.
    for epoch in [FIRST, FIRST + 1, LAST] {
        insert(client, epoch, "direct", "voteDirect", 10).await;
        insert(client, epoch, "direct-exit", "voteDirect", 20).await;
        insert(client, epoch, "native", "voteNative", 30).await;
    }
}

#[tokio::test]
async fn collected_stake_queries_run_against_postgres() {
    let Ok(url) = std::env::var("TEST_POSTGRES_URL") else {
        eprintln!("TEST_POSTGRES_URL not set, skipping");
        return;
    };

    let (client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
    tokio::spawn(async move { connection.await.unwrap() });

    seed(&client).await;

    let latest = get_latest_collected_epoch(&client).await.unwrap();
    assert_eq!(
        latest,
        Some(LAST as u64),
        "MAX(epoch) must see the fixtures"
    );

    let range = get_collected_stake_range(&client, &query(FIRST as u64, LAST as u64))
        .await
        .unwrap();
    assert_eq!(
        range
            .iter()
            .map(|snapshot| (snapshot.epoch, snapshot.records.len()))
            .collect::<Vec<_>>(),
        vec![(LAST as u64, 3), ((FIRST + 1) as u64, 3), (FIRST as u64, 3)],
        "epoch-descending, and the missing epoch stays missing"
    );

    let single = get_collected_stake_range(&client, &query(LAST as u64, LAST as u64))
        .await
        .unwrap();
    assert_eq!(single.len(), 1);
    assert_eq!(single[0].epoch, LAST as u64);

    let pinned = get_collected_stake(&client).await.unwrap().unwrap();
    assert_eq!(
        (pinned.epoch, pinned.records.len()),
        (single[0].epoch, single[0].records.len()),
        "the MAX(epoch) pin and a one-epoch range must agree"
    );

    let labelled = get_collected_stake_range(
        &client,
        &CollectedStakeQuery {
            labels: vec!["direct".to_string(), "direct-exit".to_string()],
            ..query(FIRST as u64, LAST as u64)
        },
    )
    .await
    .unwrap();
    assert_eq!(labelled.len(), 3);
    for snapshot in &labelled {
        let mut labels = snapshot
            .records
            .iter()
            .map(|record| record.label.as_str())
            .collect::<Vec<_>>();
        labels.sort_unstable();
        assert_eq!(labels, vec!["direct", "direct-exit"]);
    }

    let by_vote = get_collected_stake_range(
        &client,
        &CollectedStakeQuery {
            vote_accounts: vec!["voteNative".to_string()],
            ..query(FIRST as u64, LAST as u64)
        },
    )
    .await
    .unwrap();
    assert_eq!(
        by_vote
            .iter()
            .map(|snapshot| snapshot.records.len())
            .collect::<Vec<_>>(),
        vec![1, 1, 1]
    );

    let both = get_collected_stake_range(
        &client,
        &CollectedStakeQuery {
            labels: vec!["direct".to_string()],
            vote_accounts: vec!["voteNative".to_string()],
            ..query(FIRST as u64, LAST as u64)
        },
    )
    .await
    .unwrap();
    assert!(
        both.is_empty(),
        "the two filters intersect, they do not union"
    );

    let unknown = get_collected_stake_range(
        &client,
        &CollectedStakeQuery {
            labels: vec!["dyrect".to_string()],
            ..query(FIRST as u64, LAST as u64)
        },
    )
    .await
    .unwrap();
    assert!(unknown.is_empty());

    let outside = get_collected_stake_range(&client, &query(1, 2))
        .await
        .unwrap();
    assert!(outside.is_empty(), "an empty window is empty, not an error");

    let labels = get_distinct_labels(&client).await.unwrap();
    for expected in ["direct", "direct-exit", "native"] {
        assert!(labels.iter().any(|label| label == expected), "{expected}");
    }

    client
        .execute(
            "DELETE FROM collected_stake WHERE epoch BETWEEN $1 AND $2",
            &[&FIRST, &LAST],
        )
        .await
        .unwrap();
}
