//! The epoch query parameters of the full router: values past the largest storable epoch are a 400
//! on every endpoint that takes one, and the largest storable epoch is still served.
//!
//! Skipped unless `TEST_POSTGRES_URL` is set (the router needs a database `Context`):
//!
//! TEST_POSTGRES_URL="postgresql://validator-bonds:validator-bonds@localhost:5444/validator-bonds" \
//!   cargo test -p api --test epoch_bounds

use std::net::SocketAddr;
use std::sync::Arc;

use api::context::{Context, ProtectedEvents, WrappedContext};
use api::handlers::MAX_EPOCH;
use api::routes::build_app;
use axum::extract::Request;
use axum::ServiceExt;
use tokio::sync::RwLock;
use tokio_postgres::NoTls;

/// Far above any real epoch, so a run against a populated database cannot disturb it.
const EPOCH: i32 = 900_005;

async fn serve(context: WrappedContext) -> String {
    let app = build_app(context);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            ServiceExt::<Request>::into_make_service_with_connect_info::<SocketAddr>(app),
        )
        .await
        .unwrap();
    });
    format!("http://{addr}")
}

async fn status(base: &str, path_and_query: &str) -> u16 {
    reqwest::get(format!("{base}{path_and_query}"))
        .await
        .unwrap()
        .status()
        .as_u16()
}

#[tokio::test]
async fn epoch_parameters_are_bounded_on_every_endpoint() {
    let Ok(url) = std::env::var("TEST_POSTGRES_URL") else {
        eprintln!("TEST_POSTGRES_URL not set, skipping");
        return;
    };
    let (client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
    tokio::spawn(async move { connection.await.unwrap() });

    // The stake endpoint answers 500 on an empty table before it looks at the window.
    client
        .execute("DELETE FROM collected_stake WHERE epoch = $1", &[&EPOCH])
        .await
        .unwrap();
    client
        .execute(
            "INSERT INTO collected_stake (epoch, slot, label, stake_authority, vote_account,
                                          effective, activating, deactivating, stake_accounts, updated_at)
             VALUES ($1, 1, 'direct', 'authority', 'vote', 1, 0, 0, 1, now())",
            &[&EPOCH],
        )
        .await
        .unwrap();

    let (psql_client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
    tokio::spawn(async move { connection.await.unwrap() });
    let protected_events = Arc::new(RwLock::new(Some(ProtectedEvents::new(vec![]).unwrap())));
    let context = Arc::new(RwLock::new(
        Context::new(psql_client, protected_events, vec![]).unwrap(),
    ));
    let base = serve(context).await;

    let too_big = MAX_EPOCH + 1;
    for path in [
        "/protected-events",
        "/v1/protected-events",
        "/v1/protected-events/allocation",
    ] {
        assert_eq!(
            status(&base, &format!("{path}?from_epoch={too_big}")).await,
            400,
            "{path}"
        );
    }
    assert_eq!(
        status(&base, &format!("/v1/validators/stake?to_epoch={too_big}")).await,
        400
    );
    assert_eq!(
        status(&base, &format!("/v1/validators/stake?from_epoch={too_big}")).await,
        400
    );

    for path in ["/protected-events", "/v1/protected-events"] {
        assert_eq!(
            status(&base, &format!("{path}?from_epoch={MAX_EPOCH}")).await,
            200,
            "{path}"
        );
    }
    assert_eq!(
        status(
            &base,
            &format!("/v1/validators/stake?from_epoch={MAX_EPOCH}&to_epoch={MAX_EPOCH}")
        )
        .await,
        200
    );

    client
        .execute("DELETE FROM collected_stake WHERE epoch = $1", &[&EPOCH])
        .await
        .unwrap();
}
