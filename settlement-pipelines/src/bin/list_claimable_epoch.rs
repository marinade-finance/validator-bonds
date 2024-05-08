use clap::Parser;
use log::info;
use settlement_pipelines::arguments::{get_rpc_client, GlobalOpts};
use settlement_pipelines::init::init_log;
use settlement_pipelines::settlements::list_claimable_settlements;
use std::collections::HashSet;
use std::io;
use validator_bonds_common::config::get_config;

// Printing on std out the list of epochs that contains
// settlements that could be claimed
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Args = Args::parse();
    init_log(&args.global_opts);

    let config_address = args.global_opts.config;
    info!(
        "Listing claimable epochs for validator-bonds config: {}",
        config_address
    );

    let (rpc_client, _) = get_rpc_client(&args.global_opts)?;
    let config = get_config(rpc_client.clone(), config_address).await?;

    let claimable_settlements =
        list_claimable_settlements(rpc_client.clone(), &config_address, &config).await?;

    let claimable_epochs = claimable_settlements
        .iter()
        .map(|d| d.settlement.epoch_created_for)
        .collect::<HashSet<_>>() // be unique
        .into_iter()
        .collect::<Vec<u64>>();

    info!("Claimable epochs: {:?}", claimable_epochs);
    serde_json::to_writer(io::stdout(), &claimable_epochs)?;
    Ok(())
}
