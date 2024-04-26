use api::api_docs::ApiDoc;
use api::context::{Context, WrappedContext};
use api::handlers::{bonds, docs, protected_events};
use api::repositories::protected_events::spawn_protected_events_cache;
use env_logger::Env;
use log::{error, info};
use std::convert::Infallible;
use std::sync::Arc;
use structopt::StructOpt;
use tokio::sync::RwLock;
use tokio_postgres::NoTls;
use warp::Filter;

#[derive(Debug, StructOpt)]
pub struct Params {
    #[structopt(long = "postgres-url")]
    pub postgres_url: String,

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
    let (psql_client, psql_conn) = tokio_postgres::connect(&params.postgres_url, NoTls).await?;
    tokio::spawn(async move {
        if let Err(err) = psql_conn.await {
            error!("PSQL Connection error: {}", err);
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
            error!("Spawning protected events cache.");
            spawn_protected_events_cache(gcp_sa_key, gcp_project_id, protected_event_records).await;
        }
        (None, None) => {
            error!("GCP parameters not provided, will not populate the protected events.")
        }
        _ => anyhow::bail!("All GCP parameters must be used together."),
    };

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
        .allow_methods(vec!["POST", "GET"]);

    let top_level = warp::path::end()
        .and(warp::get())
        .map(|| "API for Validator Bonds 2.0");

    let route_api_docs_oas = warp::path("docs.json")
        .and(warp::get())
        .map(|| warp::reply::json(&<ApiDoc as utoipa::OpenApi>::openapi()));

    let route_api_docs_html = warp::path("docs").and(warp::get()).and_then(docs::handler);

    let route_bonds = warp::path!("bonds")
        .and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<bonds::QueryParams>())
        .and(with_context(context.clone()))
        .and_then(bonds::handler);

    let route_protected_events = warp::path!("protected-events")
        .and(warp::path::end())
        .and(warp::get())
        .and(warp::query::<protected_events::QueryParams>())
        .and(with_context(context.clone()))
        .and_then(protected_events::handler);

    let routes = top_level
        .or(route_api_docs_oas)
        .or(route_api_docs_html)
        .or(route_bonds)
        .or(route_protected_events)
        .with(cors)
        .with(warp::filters::compression::gzip());

    warp::serve(routes).run(([0, 0, 0, 0], params.port)).await;

    Ok(())
}

fn with_context(
    context: WrappedContext,
) -> impl Filter<Extract = (WrappedContext,), Error = Infallible> + Clone {
    warp::any().map(move || context.clone())
}
