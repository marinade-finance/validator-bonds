use env_logger::{Builder, Env};
use log::LevelFilter;
use snapshot_parser::utils::write_to_json_file;
use std::fs;
use {
    clap::Parser,
    log::info,
    snapshot_parser::{bank_loader::create_bank_from_ledger, stake_meta, validator_meta},
    std::path::PathBuf,
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long, env, value_parser = Args::path_parser)]
    ledger_path: PathBuf,

    #[arg(long, env)]
    output_validator_meta_collection: String,

    #[arg(long, env)]
    output_stake_meta_collection: String,
}

impl Args {
    fn path_parser(path: &str) -> Result<PathBuf, &'static str> {
        Ok(fs::canonicalize(path).unwrap_or_else(|err| {
            panic!("Unable to access path '{}': {}", path, err);
        }))
    }
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.filter_module("solana_metrics::metrics", LevelFilter::Error);
    builder.init();

    info!("Starting snapshot parser...");
    let args: Args = Args::parse();

    info!("Creating bank from ledger path: {:?}", &args.ledger_path);
    let bank = create_bank_from_ledger(&args.ledger_path)?;

    info!("Creating validator meta collection...");
    let validator_meta_collection = validator_meta::generate_validator_collection(&bank)?;
    write_to_json_file(
        &validator_meta_collection,
        &args.output_validator_meta_collection,
    )?;

    info!("Creating stake meta collection...");
    let stake_meta_collection = stake_meta::generate_stake_meta_collection(&bank)?;
    write_to_json_file(&stake_meta_collection, &args.output_stake_meta_collection)?;

    info!("Finished.");
    Ok(())
}
