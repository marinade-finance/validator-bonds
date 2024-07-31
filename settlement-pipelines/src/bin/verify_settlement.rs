use anyhow::anyhow;
use clap::Parser;
use log::{error, info};
use protected_event_distribution::utils::read_from_json_file;
use settlement_pipelines::arguments::{get_rpc_client, GlobalOpts};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::init::init_log;
use settlement_pipelines::json_data::BondSettlement;
use solana_sdk::bs58;
use solana_sdk::pubkey::Pubkey;
use std::io;
use std::path::PathBuf;
use validator_bonds_common::settlements::get_settlements_for_config;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    #[clap(long, short = 'p')]
    past_settlements: PathBuf,
}

#[tokio::main]
async fn main() -> CliResult {
    CliResult(real_main().await)
}

async fn real_main() -> anyhow::Result<()> {
    let args: Args = Args::parse();
    init_log(&args.global_opts);

    let config_address = args.global_opts.config;
    info!(
        "Verify existing settlements from list of past settlements JSON file {:?} for validator-bonds config: {}",
        args.past_settlements, config_address
    );

    let past_settlements: Vec<BondSettlement> = read_from_json_file(&args.past_settlements)
        .map_err(|e| anyhow!("Failed to load --past-settlements: {:?}", e))
        .map_err(CliError::Processing)?;

    let (rpc_client, _) = get_rpc_client(&args.global_opts).map_err(CliError::RetryAble)?;
    let config_settlements = get_settlements_for_config(rpc_client.clone(), &config_address)
        .await
        .map_err(CliError::RetryAble)?;

    info!(
        "Found {} settlements for config {} at '{}'",
        config_settlements.len(),
        config_address,
        rpc_client.url()
    );

    let mut unknown_settlements: Vec<String> = vec![];
    for (settlement_pubkey, _settlement) in config_settlements {
        if !past_settlements
            .iter()
            .any(|past_settlement| past_settlement.settlement_address == settlement_pubkey)
        {
            unknown_settlements.push(bs58::encode(settlement_pubkey).into_string());
        }
    }

    if unknown_settlements.is_empty() {
        info!("All settlements are known");
    } else {
        error!("Found unknown settlements:\n {:?}", unknown_settlements);
        error!(
            "Known settlements:\n {:?}",
            past_settlements
                .iter()
                .map(|s| s.settlement_address)
                .collect::<Vec<Pubkey>>()
        );
    }

    serde_json::to_writer(io::stdout(), &unknown_settlements)
        .map_err(|e| anyhow!("Failed to write unknown settlements as JSON: {:?}", e))
        .map_err(CliError::Processing)?;

    Ok(())
}
