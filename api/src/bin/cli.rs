use api::repositories::{bond::store_bonds, common::CommonStoreOptions};
use clap::{Args, Parser, Subcommand};
use tracing_log::LogTracer;
use validator_bonds_common::cli_result::CliResult;

#[derive(Debug, Args)]
pub struct Common {
    #[arg(short = 'v')]
    verbose: bool,
}

#[derive(Debug, Parser)]
struct Params {
    #[command(flatten)]
    common: Common,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    StoreBonds(CommonStoreOptions),
}

#[tokio::main]
async fn main() -> CliResult {
    CliResult(real_main().await)
}

async fn real_main() -> anyhow::Result<()> {
    let params = Params::parse();
    LogTracer::init().expect("Setting up log compatibility failed");
    let subscriber = tracing_subscriber::fmt::Subscriber::builder()
        .with_target(false)
        .with_writer(std::io::stderr)
        .with_max_level(if params.common.verbose {
            tracing::Level::DEBUG
        } else {
            tracing::Level::INFO
        })
        .compact()
        .finish();

    tracing::subscriber::set_global_default(subscriber).unwrap();

    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default_panic(info);
        log::error!("Worker thread panicked, exiting.");
        std::process::exit(1);
    }));

    match params.command {
        Command::StoreBonds(options) => store_bonds(options).await?,
    };
    Ok(())
}
