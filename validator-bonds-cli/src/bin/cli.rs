use structopt::StructOpt;
use tracing_log::LogTracer;
use validator_bonds_cli::commands::bonds::collect_bonds;
use validator_bonds_cli::commands::common::CommonCollectOptions;

#[derive(Debug, StructOpt)]
pub struct Common {
    #[structopt(short = "v")]
    verbose: bool,
}

#[derive(Debug, StructOpt)]
struct Params {
    #[structopt(flatten)]
    common: Common,

    #[structopt(subcommand)]
    command: Command,
}

#[derive(Debug, StructOpt)]
pub enum Command {
    CollectBonds(CommonCollectOptions),
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let params = Params::from_args();
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
        Command::CollectBonds(options) => collect_bonds(options).await?,
    };
    Ok(())
}
