use env_logger::{Builder, Env};
use settlement_engine::bids_pmpe_meta::BidsPmpeMetaCollection;
use settlement_engine::settlement_claims::generate_settlement_collection;
use settlement_engine::settlement_config::{no_filter, stake_authorities_filter, SettlementConfig};
use settlement_engine::stake_meta_index::StakeMetaIndex;
use settlement_engine::utils::{file_error, read_from_yaml_file};
use settlement_engine::{
    merkle_tree_collection::generate_merkle_tree_collection,
    protected_events::generate_protected_event_collection,
    utils::{read_from_json_file, write_to_json_file},
};
use snapshot_parser::{stake_meta::StakeMetaCollection, validator_meta::ValidatorMetaCollection};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use {clap::Parser, log::info};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Input collection data referring to validator commission and MEV rates for an epoch.
    /// Data expected to come from a snapshot generated at the last slot of the epoch.
    #[arg(long, env)]
    validator_meta_collection: String,

    /// Input collection data referring to stake accounts from the snapshot
    /// of the same epoch as the validator metadata.
    #[arg(long, env)]
    stake_meta_collection: String,

    /// Input collection data referring to promised and actual bids in pmpes.
    /// It's an aggregate collection of data that says if a validator has paid
    /// what they promised to pay to the staker.
    /// The data involves commission rates, mev, expected and actual bids, etc.
    #[arg(long, env)]
    bids_pmpe_collection: String,

    #[arg(long, env)]
    output_protected_event_collection: String,

    #[arg(long, env)]
    output_settlement_collection: String,

    #[arg(long, env)]
    output_merkle_tree_collection: String,

    #[arg(long, env, value_delimiter = ',')]
    whitelist_stake_authority: Option<Vec<Pubkey>>,

    #[arg(long, env)]
    settlement_config: String,
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.init();

    info!("Starting settlement engine...");
    let args: Args = Args::parse();

    info!(
        "Loading settlement configuration: {:?}",
        args.settlement_config
    );
    let settlement_configs: Vec<SettlementConfig> = read_from_yaml_file(&args.settlement_config)
        .map_err(file_error("settlement-config", &args.settlement_config))?;

    if let Some(whitelisted_stake_authorities) = &args.whitelist_stake_authority {
        info!(
            "Using whitelist on stake authorities: {:?}",
            whitelisted_stake_authorities
        );
    }

    info!("Loading validator meta collection...");
    let validator_meta_collection: ValidatorMetaCollection =
        read_from_json_file(&args.validator_meta_collection).map_err(file_error(
            "validator-meta-collection",
            &args.validator_meta_collection,
        ))?;

    info!("Loading bids pmpe meta collection...");
    let bids_pmpe_meta_collection: BidsPmpeMetaCollection =
        read_from_json_file(&args.bids_pmpe_collection).map_err(file_error(
            "bids-pmpe-collection",
            &args.bids_pmpe_collection,
        ))?;

    info!("Generating protected event collection...");
    let protected_event_collection =
        generate_protected_event_collection(validator_meta_collection, bids_pmpe_meta_collection);
    info!("Writing protected events collection to json file");
    write_to_json_file(
        &protected_event_collection,
        &args.output_protected_event_collection,
    )
    .map_err(file_error(
        "output-protected-event-collection",
        &args.output_protected_event_collection,
    ))?;

    info!("Loading stake meta collection...");
    let stake_meta_collection: StakeMetaCollection =
        read_from_json_file(&args.stake_meta_collection).map_err(file_error(
            "stake-meta-collection",
            &args.stake_meta_collection,
        ))?;

    info!(
        "Building stake authorities filter: {:?}",
        args.whitelist_stake_authority
    );
    let stake_authority_filter =
        args.whitelist_stake_authority
            .map_or(no_filter(), |whitelisted_stake_authorities| {
                stake_authorities_filter(HashSet::from_iter(whitelisted_stake_authorities))
            });

    info!("Building stake meta collection index...");
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    info!("Generating settlement collection...");
    let settlement_collection = generate_settlement_collection(
        &stake_meta_index,
        &protected_event_collection,
        &stake_authority_filter,
        &settlement_configs,
    );
    write_to_json_file(&settlement_collection, &args.output_settlement_collection).map_err(
        file_error(
            "output-settlement-collection",
            &args.output_settlement_collection,
        ),
    )?;

    info!("Generating merkle tree collection...");
    let merkle_tree_collection = generate_merkle_tree_collection(settlement_collection)?;
    write_to_json_file(&merkle_tree_collection, &args.output_merkle_tree_collection).map_err(
        file_error(
            "output_merkle-tree-collection",
            &args.output_merkle_tree_collection,
        ),
    )?;

    info!("Finished.");
    Ok(())
}
