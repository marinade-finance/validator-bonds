use api::context::{Context, WrappedContext};
use api::repositories::protected_events::spawn_protected_events_cache;
use api::routes::{build_app, internal_router};
use clap::Parser;
use env_logger::Env;
use log::{error, info};
use openssl::ssl::{SslConnector, SslMethod};
use postgres_openssl::MakeTlsConnector;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

/// Internal port for Prometheus metrics + health, scraped via a dedicated
/// metrics `Service` annotated `prometheus.io/port: "9000"`. Kept off the
/// public port.
const INTERNAL_PORT: u16 = 9000;

#[derive(Debug, Parser)]
pub struct Params {
    #[arg(long = "postgres-url")]
    pub postgres_url: String,

    #[arg(long = "postgres-ssl-root-cert", env = "PG_SSLROOTCERT")]
    pub postgres_ssl_root_cert: String,

    #[arg(long = "gcp-project-id")]
    pub gcp_project_id: Option<String>,

    #[arg(long = "gcp-sa-key")]
    pub gcp_sa_key: Option<String>,

    #[arg(long = "port", default_value = "8000")]
    pub port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::Builder::from_env(Env::default().default_filter_or("info")).init();
    info!("Launching API");

    let params = Params::parse();

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
    let context: WrappedContext = Arc::new(RwLock::new(Context::new(
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

    let public_addr = SocketAddr::from(([0, 0, 0, 0], params.port));
    let internal_addr = SocketAddr::from(([0, 0, 0, 0], INTERNAL_PORT));

    let public_listener = TcpListener::bind(public_addr).await?;
    let internal_listener = TcpListener::bind(internal_addr).await?;

    let app = build_app(context.clone());
    let internal = internal_router(context);

    info!("Serving public API on {public_addr}, metrics/health on {internal_addr}");

    // ConnectInfo is required so the rate limiter can fall back to the peer IP
    // when `cf-connecting-ip` is absent.
    let public_server = tokio::spawn(async move {
        axum::serve(
            public_listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    });
    let internal_server =
        tokio::spawn(
            async move { axum::serve(internal_listener, internal.into_make_service()).await },
        );

    // If either server exits (always an error in practice), surface it and exit non-zero.
    tokio::select! {
        res = public_server => anyhow::bail!("Public API server stopped: {res:?}"),
        res = internal_server => anyhow::bail!("Internal server stopped: {res:?}"),
    }
}
