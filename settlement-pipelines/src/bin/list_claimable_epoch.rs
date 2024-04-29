use anchor_client::Cluster;
use anyhow::anyhow;
use clap::Parser;
use log::info;
use settlement_pipelines::arguments::GlobalOpts;
use settlement_pipelines::init::init_log;
use settlement_pipelines::settlements::list_claimable_settlements;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use std::collections::HashSet;
use std::io;
use std::str::FromStr;
use std::sync::Arc;
use validator_bonds::state::config::Config;
use validator_bonds_common::get_validator_bonds_program;

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

    let rpc_url = args.global_opts.rpc_url.expect("RPC URL is required");
    let anchor_cluster = Cluster::from_str(&rpc_url)
        .map_err(|e| anyhow!("Could not parse JSON RPC url {}: {:?}", rpc_url, e))?;
    let rpc_client = Arc::new(RpcClient::new_with_commitment(
        anchor_cluster.to_string(),
        CommitmentConfig {
            commitment: args.global_opts.commitment,
        },
    ));

    let program = get_validator_bonds_program(rpc_client.clone(), None)?;
    let config: Config = program.account(config_address).await.map_err(|e| {
        anyhow!(
            "Cannot load validator-bonds config account {}: {:?}",
            config_address,
            e
        )
    })?;

    let claimable_settlements =
        list_claimable_settlements(&config_address, &config, rpc_client.clone()).await?;

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
