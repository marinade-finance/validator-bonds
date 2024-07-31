use env_logger::{Builder, Env};
use protected_event_distribution::revenue_expectation_meta::RevenueExpectationMetaCollection;
use protected_event_distribution::settlement_claims::generate_settlement_collection;
use protected_event_distribution::settlement_config::{
    no_filter, stake_authorities_filter, SettlementConfig,
};
use protected_event_distribution::stake_meta_index::StakeMetaIndex;
use protected_event_distribution::utils::{file_error, read_from_yaml_file};
use protected_event_distribution::{
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

    /// Input collection data referring to promised and actual validator processing.
    /// It's an aggregate collection of data that says if a validator has paid
    /// what was expected to pay to the staker. That could be a change in commission or mev rate,
    /// a wrong performance that led to a lower reward, etc.
    #[arg(long, env)]
    revenue_expectation_collection: String,

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

    info!("Loading revenue expecation meta collection...");
    let revenue_expectation_meta_collection: RevenueExpectationMetaCollection =
        read_from_json_file(&args.revenue_expectation_collection).map_err(file_error(
            "revenue-expectation-collection",
            &args.revenue_expectation_collection,
        ))?;

    info!("Generating protected event collection...");
    let protected_event_collection = generate_protected_event_collection(
        validator_meta_collection,
        revenue_expectation_meta_collection,
    );
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

    info!("Generating protected events settlement collection...");
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

    info!("Generating protected events merkle tree collection...");
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
