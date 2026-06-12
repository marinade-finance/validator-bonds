//! Prometheus metrics + liveness/readiness for the internal `:9000` server.
//!
//! Scraped via a dedicated metrics `Service` carrying `prometheus.io/scrape` +
//! `prometheus.io/port: "9000"` annotations (path `/metrics`). Mirrors the
//! waypoint convention (public API port + a separate internal metrics/health
//! port).

use std::sync::LazyLock;
use std::time::Instant;

use axum::extract::{MatchedPath, Request};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use prometheus::{register_histogram_vec, register_int_counter_vec, HistogramVec, IntCounterVec};

static HTTP_REQUESTS_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        "validator_bonds_api_http_requests_total",
        "Total HTTP requests handled, by method, matched route and status code.",
        &["method", "path", "status"]
    )
    .expect("metric can be registered")
});

static HTTP_REQUEST_DURATION_SECONDS: LazyLock<HistogramVec> = LazyLock::new(|| {
    register_histogram_vec!(
        "validator_bonds_api_http_request_duration_seconds",
        "HTTP request handling latency in seconds, by method, matched route and status code.",
        &["method", "path", "status"]
    )
    .expect("metric can be registered")
});

/// axum middleware: record request count + latency. Uses the matched route
/// template (e.g. `/bonds/bidding`) as the `path` label to keep cardinality
/// bounded; unmatched requests are bucketed under `unknown`.
pub async fn track_metrics(req: Request, next: Next) -> Response {
    let method = req.method().as_str().to_owned();
    let path = req
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| "unknown".to_owned());

    let start = Instant::now();
    let response = next.run(req).await;
    let elapsed = start.elapsed().as_secs_f64();
    let status = response.status().as_u16().to_string();

    HTTP_REQUESTS_TOTAL
        .with_label_values(&[&method, &path, &status])
        .inc();
    HTTP_REQUEST_DURATION_SECONDS
        .with_label_values(&[&method, &path, &status])
        .observe(elapsed);

    response
}

/// Prometheus text-format exposition of the default registry.
pub async fn metrics_handler() -> (StatusCode, String) {
    use prometheus::{Encoder, TextEncoder};
    let encoder = TextEncoder::new();
    let mut buffer = Vec::new();
    if let Err(err) = encoder.encode(&prometheus::gather(), &mut buffer) {
        log::error!("Failed to encode metrics: {err}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to encode metrics".to_owned(),
        );
    }
    match String::from_utf8(buffer) {
        Ok(body) => (StatusCode::OK, body),
        Err(err) => {
            log::error!("Metrics buffer was not valid UTF-8: {err}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "invalid metrics encoding".to_owned(),
            )
        }
    }
}

/// Liveness: the process is up and serving. No dependency checks.
pub async fn healthz() -> StatusCode {
    StatusCode::OK
}

/// Readiness: the process can serve traffic, gated on DB connectivity (a
/// trivial `SELECT 1`). Returns 503 when the database is unreachable so the
/// pod is pulled from the Service endpoints until Postgres recovers.
pub async fn readyz(
    axum::extract::State(context): axum::extract::State<crate::context::WrappedContext>,
) -> StatusCode {
    match context
        .read()
        .await
        .psql_client
        .simple_query("SELECT 1")
        .await
    {
        Ok(_) => StatusCode::OK,
        Err(err) => {
            log::warn!("readyz DB connectivity check failed: {err}");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}
