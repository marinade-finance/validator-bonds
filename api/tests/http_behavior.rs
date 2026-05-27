//! Black-box HTTP characterization of the API route/middleware stack.
//!
//! These tests pin the framework-level behavior preserved across the
//! warp→axum migration (§4): routing, rate-limit 429s, CORS headers (incl. on
//! 429), gzip negotiation, and the internal metrics/health endpoints. Only the
//! no-DB routes (`/`, `/docs.json`, `/docs`) are exercised — they need no
//! `Context`/Postgres, and the middleware stack they ride is shared (via the
//! `api::routes` building blocks) with the DB-backed routes. DB-backed routes
//! and `readyz`'s DB check are covered by the manual smoke test in
//! `api/README.md`.

use std::net::SocketAddr;
use std::time::Duration;

use api::routes::{meta_routes, with_global_middleware, with_public_rate_limit};

/// Build the no-DB routes with the same public-tier rate limit + global
/// middleware as `routes::build_app`, bind an ephemeral port, spawn the
/// server, and return its base URL. The DB-backed routes are excluded (they
/// need a live Postgres `Context`); the middleware stack under test is shared
/// with production via the `api::routes` building blocks.
async fn spawn_test_server() -> String {
    let app = with_global_middleware(with_public_rate_limit(meta_routes()));

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    // Give the spawned server a moment to start accepting connections.
    tokio::time::sleep(Duration::from_millis(50)).await;
    format!("http://{addr}")
}

/// Spawn the state-free subset of the internal server (`/metrics`, `/healthz`).
/// `readyz` needs a live DB `Context` and is exercised by the manual smoke test.
async fn spawn_internal_server() -> String {
    let app = axum::Router::new()
        .route(
            "/metrics",
            axum::routing::get(api::metrics::metrics_handler),
        )
        .route("/healthz", axum::routing::get(api::metrics::healthz));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .await
            .unwrap();
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    format!("http://{addr}")
}

/// reqwest client with redirects/compression off so raw headers are observable.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

#[tokio::test]
async fn top_level_route_returns_greeting() {
    let base = spawn_test_server().await;
    let resp = client().get(&base).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "API for Validator Bonds 2.0");
}

#[tokio::test]
async fn docs_json_returns_openapi() {
    let base = spawn_test_server().await;
    let resp = client()
        .get(format!("{base}/docs.json"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let ct = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(ct.contains("application/json"), "content-type was {ct}");
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body.get("openapi").is_some(), "must be an OpenAPI document");
}

#[tokio::test]
async fn docs_html_returns_redoc_page() {
    let base = spawn_test_server().await;
    let resp = client().get(format!("{base}/docs")).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let ct = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(ct.contains("text/html"), "content-type was {ct}");
    assert!(resp.text().await.unwrap().contains("redoc"));
}

#[tokio::test]
async fn unknown_path_is_404() {
    let base = spawn_test_server().await;
    let resp = client()
        .get(format!("{base}/does-not-exist"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn cors_header_present_on_get_with_origin() {
    let base = spawn_test_server().await;
    let resp = client()
        .get(&base)
        .header("origin", "https://app.marinade.finance")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(
        resp.headers().contains_key("access-control-allow-origin"),
        "CORS allow-origin header must be present on GET responses",
    );
}

#[tokio::test]
async fn gzip_is_applied_only_when_requested() {
    // Use /docs.json (large OpenAPI body): tower-http's CompressionLayer skips
    // bodies under ~32 bytes, so a realistic payload is needed to assert gzip.
    let base = spawn_test_server().await;

    let with_gzip = client()
        .get(format!("{base}/docs.json"))
        .header("accept-encoding", "gzip")
        .send()
        .await
        .unwrap();
    assert_eq!(
        with_gzip
            .headers()
            .get("content-encoding")
            .map(|v| v.to_str().unwrap().to_string()),
        Some("gzip".to_string()),
        "Accept-Encoding: gzip must yield a gzip-compressed response",
    );

    let without = spawn_test_server().await;
    let no_gzip = client()
        .get(format!("{without}/docs.json"))
        .send()
        .await
        .unwrap();
    assert!(
        no_gzip.headers().get("content-encoding").is_none(),
        "no Accept-Encoding → uncompressed response",
    );
}

#[tokio::test]
async fn internal_healthz_returns_200() {
    let base = spawn_internal_server().await;
    let c = client();
    assert_eq!(
        c.get(format!("{base}/healthz"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
}

#[tokio::test]
async fn metrics_endpoint_exposes_recorded_http_metrics() {
    // Drive a public request so the metrics middleware records into the
    // process-wide Prometheus registry, then scrape it on the internal server.
    let public = spawn_test_server().await;
    let c = client();
    c.get(&public).send().await.unwrap();

    let internal = spawn_internal_server().await;
    let resp = c.get(format!("{internal}/metrics")).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("validator_bonds_api_http_requests_total"),
        "metrics exposition must include the HTTP request counter; got:\n{body}",
    );
    assert!(
        body.contains("path=\"/\""),
        "the matched-route path label must be populated (not 'unknown'); got:\n{body}",
    );
}

#[tokio::test]
async fn rate_limit_trips_429_and_429_carries_cors_headers() {
    let base = spawn_test_server().await;
    let c = client();
    // Public tier = 30 rps burst; same client IP via cf-connecting-ip.
    let mut last = None;
    for _ in 0..40 {
        let resp = c
            .get(&base)
            .header("cf-connecting-ip", "7.7.7.7")
            .header("origin", "https://app.marinade.finance")
            .send()
            .await
            .unwrap();
        let status = resp.status();
        if status == 429 {
            assert!(
                resp.headers().contains_key("access-control-allow-origin"),
                "a 429 from the limiter must still carry CORS headers",
            );
            last = Some(status);
            break;
        }
    }
    assert_eq!(
        last,
        Some(reqwest::StatusCode::TOO_MANY_REQUESTS),
        "exceeding the public burst (30) from one IP must yield a 429",
    );
}
