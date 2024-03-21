use env_logger::{Builder, Env};
use settlement_engine::settlement_claims::stake_authorities_filter;
use settlement_engine::{
    merkle_tree_collection::generate_merkle_tree_collection,
    protected_events::generate_protected_event_collection,
    settlement_claims::generate_settlement_claim_collection,
    utils::{read_from_json_file, write_to_json_file},
};
use snapshot_parser::{stake_meta::StakeMetaCollection, validator_meta::ValidatorMetaCollection};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use {clap::Parser, log::info};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long, env)]
    validator_meta_collection: String,

    #[arg(long, env)]
    stake_meta_collection: String,

    #[arg(long, env)]
    output_protected_event_collection: String,

    #[arg(long, env)]
    output_settlement_claim_collection: String,

    #[arg(long, env)]
    output_merkle_tree_collection: String,

    #[arg(long, env, value_delimiter = ',')]
    whitelist_stake_authority: Option<Vec<Pubkey>>,

    #[arg(long, env)]
    low_rewards_threshold_pct: f64,
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.init();

    info!("Starting settlement engine...");
    let args: Args = Args::parse();

    if let Some(whitelisted_stake_authorities) = &args.whitelist_stake_authority {
        info!(
            "Using whitelist on stake authorities: {:?}",
            whitelisted_stake_authorities
        );
    }

    info!("Loading validator meta collection...");
    let validator_meta_collection: ValidatorMetaCollection =
        read_from_json_file(&args.validator_meta_collection)?;

    info!("Loading stake meta collection...");
    let stake_meta_collection: StakeMetaCollection =
        read_from_json_file(&args.stake_meta_collection)?;

    info!("Generating insured event collection...");
    let protected_event_collection = generate_protected_event_collection(
        validator_meta_collection,
        args.low_rewards_threshold_pct,
    );
    info!("Writing insured events collection to json file");
    write_to_json_file(
        &protected_event_collection,
        &args.output_protected_event_collection,
    )?;

    info!(
        "Generating insured event collection, stake authorities: {:?}",
        args.whitelist_stake_authority
    );
    let stake_meta_filter = args
        .whitelist_stake_authority
        .map(|whitelisted_stake_authorities| {
            stake_authorities_filter(HashSet::from_iter(whitelisted_stake_authorities))
        });

    info!("Generating settlement claim collection...");
    let settlement_claim_collection = generate_settlement_claim_collection(
        stake_meta_collection,
        protected_event_collection,
        stake_meta_filter,
    );
    write_to_json_file(
        &settlement_claim_collection,
        &args.output_settlement_claim_collection,
    )?;

    info!("Generating merkle tree collection...");
    let merkle_tree_collection = generate_merkle_tree_collection(settlement_claim_collection)?;
    write_to_json_file(&merkle_tree_collection, &args.output_merkle_tree_collection)?;

    info!("Finished.");
    Ok(())
}
