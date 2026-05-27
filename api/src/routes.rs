//! axum router composition for the public API and the internal metrics server.
//!
//! Split into small public building blocks so both `bin/api.rs` and the HTTP
//! integration tests assemble the *same* middleware stack. Two rate-limit
//! tiers (public reads vs the cli-usage write) are applied to their route
//! groups before the global CORS/compression/metrics layers, so a 429 from
//! the limiter still flows out through CORS (carrying the CORS headers).

use std::time::Duration;

use axum::http::{header, HeaderName, Method};
use axum::routing::{get, post};
use axum::Router;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::api_docs::ApiDoc;
use crate::context::WrappedContext;
use crate::handlers::{bonds, cli_usage, docs, protected_events};
use crate::metrics::{healthz, metrics_handler, readyz, track_metrics};
use crate::rate_limit::CfConnectingIpKeyExtractor;

/// Public read tier: 30 rps per IP.
const PUBLIC_RATE_PER_SEC: u32 = 30;
/// Write tier (`/v1/cli-usage`): 10 rps per IP.
const WRITE_RATE_PER_SEC: u32 = 10;

/// Routes that need no DB `Context` (also the testable middleware surface).
pub fn meta_routes() -> Router {
    Router::new()
        .route("/", get(|| async { "API for Validator Bonds 2.0" }))
        .route(
            "/docs.json",
            get(|| async { axum::Json(<ApiDoc as utoipa::OpenApi>::openapi()) }),
        )
        .route("/docs", get(docs::handler))
}

/// Public read routes backed by the DB/cache.
pub fn public_data_routes(context: WrappedContext) -> Router {
    #[allow(deprecated)] // /bonds is intentionally kept as a deprecated alias
    Router::new()
        .route("/bonds", get(bonds::handler))
        .route("/bonds/bidding", get(bonds::handler_bidding))
        .route("/bonds/institutional", get(bonds::handler_institutional))
        .route("/protected-events", get(protected_events::handler))
        .with_state(context)
}

/// Write route (CLI telemetry), separate rate-limit tier.
pub fn write_routes(context: WrappedContext) -> Router {
    Router::new()
        .route("/v1/cli-usage", post(cli_usage::handler))
        .with_state(context)
}

/// Per-IP (`cf-connecting-ip`) rate limit, burst = rps. Built inline so
/// tower_governor's multi-parameter layer type stays fully inferred against
/// the axum router. `period` is the refill interval (rate⁻¹), not the rate.
pub fn with_public_rate_limit(router: Router) -> Router {
    let config = GovernorConfigBuilder::default()
        .key_extractor(CfConnectingIpKeyExtractor)
        .period(Duration::from_nanos(
            1_000_000_000 / PUBLIC_RATE_PER_SEC as u64,
        ))
        .burst_size(PUBLIC_RATE_PER_SEC)
        .finish()
        .expect("valid public rate-limit config");
    router.layer(GovernorLayer::new(config))
}

pub fn with_write_rate_limit(router: Router) -> Router {
    let config = GovernorConfigBuilder::default()
        .key_extractor(CfConnectingIpKeyExtractor)
        .period(Duration::from_nanos(
            1_000_000_000 / WRITE_RATE_PER_SEC as u64,
        ))
        .burst_size(WRITE_RATE_PER_SEC)
        .finish()
        .expect("valid write rate-limit config");
    router.layer(GovernorLayer::new(config))
}

/// Global outermost middleware: metrics (innermost), gzip, CORS (outermost so
/// rate-limit 429s still carry CORS headers).
pub fn with_global_middleware(router: Router) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::any())
        .allow_methods([Method::GET])
        .allow_headers([
            header::USER_AGENT,
            HeaderName::from_static("sec-fetch-mode"),
            header::REFERER,
            header::CONTENT_TYPE,
            header::ORIGIN,
            header::ACCESS_CONTROL_REQUEST_METHOD,
            header::ACCESS_CONTROL_REQUEST_HEADERS,
        ]);

    router
        .layer(axum::middleware::from_fn(track_metrics))
        .layer(CompressionLayer::new())
        .layer(cors)
}

/// Full public app: meta + data routes (public tier) merged with the write
/// route (write tier), wrapped in the global middleware.
pub fn build_app(context: WrappedContext) -> Router {
    let public = with_public_rate_limit(meta_routes().merge(public_data_routes(context.clone())));
    let write = with_write_rate_limit(write_routes(context));
    with_global_middleware(public.merge(write))
}

/// Internal `:9000` server: Prometheus metrics + liveness/readiness.
/// `readyz` checks DB connectivity, hence the shared `Context` state.
pub fn internal_router(context: WrappedContext) -> Router {
    Router::new()
        .route("/metrics", get(metrics_handler))
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .with_state(context)
}
