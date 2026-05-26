use api::api_docs::ApiDoc;
use api::context::{Context, WrappedContext};
use api::handlers::{bonds, cli_usage, docs, protected_events};
use api::rate_limit::{
    public_routes_limiter, recover_rate_limited, spawn_limiter_gc, with_rate_limit,
    write_routes_limiter,
};
use api::repositories::protected_events::spawn_protected_events_cache;
use env_logger::Env;
use log::{error, info};
use openssl::ssl::{SslConnector, SslMethod};
use postgres_openssl::MakeTlsConnector;
use std::convert::Infallible;
use std::sync::Arc;
use structopt::StructOpt;
use tokio::sync::RwLock;
use warp::Filter;

#[derive(Debug, StructOpt)]
pub struct Params {
    #[structopt(long = "postgres-url")]
    pub postgres_url: String,

    #[structopt(long = "postgres-ssl-root-cert", env = "PG_SSLROOTCERT")]
    pub postgres_ssl_root_cert: String,

    #[structopt(long = "gcp-project-id")]
    pub gcp_project_id: Option<String>,

    #[structopt(long = "gcp-sa-key")]
    pub gcp_sa_key: Option<String>,

    #[structopt(long = "port", default_value = "8000")]
    pub port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::Builder::from_env(Env::default().default_filter_or("info")).init();
    info!("Launching API");

    let params = Params::from_args();

    let mut builder = SslConnector::builder(SslMethod::tls())?;
    builder.set_ca_file(&params.postgres_ssl_root_cert)?;
    let connector = MakeTlsConnector::new(builder.build());

    let (psql_client, psql_conn) = tokio_postgres::connect(&params.postgres_url, connector).await?;
    tokio::spawn(async move {
        if let Err(err) = psql_conn.await {
            error!("PSQL Connection error: {err}");
            std::process::exit(1);
        }
    });

    let protected_event_records = Arc::new(RwLock::new(vec![]));
    let context = Arc::new(RwLock::new(Context::new(
        psql_client,
        protected_event_records.clone(),
    )?));

    match (params.gcp_project_id, params.gcp_sa_key) {
        (Some(gcp_project_id), Some(gcp_sa_key)) => {
            info!("Spawning protected events cache.");
            spawn_protected_events_cache(gcp_sa_key, gcp_project_id, protected_event_records).await;
        }
        (None, None) => {
            error!("GCP parameters not provided, will not populate the protected events.")
        }
        _ => anyhow::bail!("All GCP parameters must be used together."),
    };

    // Only GET is CORS-allowed here: every browser-facing endpoint is GET.
    // `/v1/cli-usage` is POST but is called by the CLI (Node/Rust), which is
    // not subject to CORS — so omitting POST from this list removes the
    // cross-origin-POST vector without affecting CLI callers. If a future
    // endpoint needs browser-driven POST, add "POST" back here AND tighten
    // `.allow_any_origin()` to an explicit origin allowlist.
    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec![
            "User-Agent",
            "Sec-Fetch-Mode",
            "Referer",
            "Content-Type",
            "Origin",
            "Access-Control-Request-Method",
            "Access-Control-Request-Headers",
        ])
        .allow_methods(vec!["GET"]);

    // Per-IP rate limiters. State lives in an in-process DashMap per
    // limiter instance, so both reset on restart. Public reads share one
    // bucket (generous); the telemetry write endpoint has its own tighter
    // bucket. See `api::rate_limit` for the policies. `spawn_limiter_gc`
    // starts the keyed-store eviction task — skipping it leaks memory
    // linearly in the number of unique observed client IPs.
    let public_limiter = public_routes_limiter();
    spawn_limiter_gc(public_limiter.clone());
    let cli_usage_limiter = write_routes_limiter();
    spawn_limiter_gc(cli_usage_limiter.clone());

    let top_level = warp::path::end()
        .and(warp::get())
        .and(with_rate_limit(public_limiter.clone()))
        .map(|| "API for Validator Bonds 2.0");

    let route_api_docs_oas = warp::path("docs.json")
        .and(warp::get())
        .and(with_rate_limit(public_limiter.clone()))
        .map(|| warp::reply::json(&<ApiDoc as utoipa::OpenApi>::openapi()));

    let route_api_docs_html = warp::path("docs")
        .and(warp::get())
        .and(with_rate_limit(public_limiter.clone()))
        .and_then(docs::handler);

    #[allow(deprecated)] // backwards compatibility
    let route_bonds = warp::path!("bonds")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_rate_limit(public_limiter.clone()))
        .and(warp::query::<bonds::QueryParams>())
        .and(with_context(context.clone()))
        .and_then(bonds::handler);

    let route_bonds_bidding = warp::path!("bonds" / "bidding")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_rate_limit(public_limiter.clone()))
        .and(warp::query::<bonds::QueryParams>())
        .and(with_context(context.clone()))
        .and_then(bonds::handler_bidding);

    let route_bonds_institutional = warp::path!("bonds" / "institutional")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_rate_limit(public_limiter.clone()))
        .and(warp::query::<bonds::QueryParams>())
        .and(with_context(context.clone()))
        .and_then(bonds::handler_institutional);

    let route_protected_events = warp::path!("protected-events")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_rate_limit(public_limiter))
        .and(warp::query::<protected_events::QueryParams>())
        .and(with_context(context.clone()))
        .and_then(protected_events::handler);

    let route_cli_usage = warp::path!("v1" / "cli-usage")
        .and(warp::path::end())
        .and(warp::post())
        .and(with_rate_limit(cli_usage_limiter))
        .and(warp::query::<cli_usage::QueryParams>())
        .and(with_context(context.clone()))
        .and_then(cli_usage::handler);

    let base_routes = top_level
        .or(route_api_docs_oas)
        .or(route_api_docs_html)
        .or(route_bonds)
        .or(route_bonds_bidding)
        .or(route_bonds_institutional)
        .or(route_protected_events)
        .or(route_cli_usage);

    // Serve compressed responses only when client requests it via Accept-Encoding: gzip header
    let accepts_gzip = warp::header::optional::<String>("accept-encoding")
        .and_then(|encoding: Option<String>| async move {
            match encoding {
                Some(enc) if enc.contains("gzip") => Ok(()),
                _ => Err(warp::reject::not_found()),
            }
        })
        .untuple_one();

    let routes_compressed = accepts_gzip
        .and(base_routes.clone())
        .with(warp::filters::compression::gzip());

    // CORS is the outermost wrapper so the 429 produced by
    // `recover_rate_limited` also carries the Access-Control-* headers —
    // otherwise a browser that trips the limiter on a GET endpoint sees a
    // CORS error instead of a readable 429.
    let routes = routes_compressed
        .or(base_routes)
        .recover(recover_rate_limited)
        .with(cors);

    warp::serve(routes).run(([0, 0, 0, 0], params.port)).await;

    Ok(())
}

fn with_context(
    context: WrappedContext,
) -> impl Filter<Extract = (WrappedContext,), Error = Infallible> + Clone {
    warp::any().map(move || context.clone())
}
