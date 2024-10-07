use bid_distribution::sam_meta::ValidatorSamMeta;
use bid_distribution::settlement_claims::generate_bid_settlement_collection;
use bid_distribution::settlement_config::SettlementConfig;
use env_logger::{Builder, Env};
use protected_event_distribution::merkle_tree_collection::generate_merkle_tree_collection;
use protected_event_distribution::settlement_claims::SettlementFunder;
use protected_event_distribution::settlement_claims::SettlementMeta;
use protected_event_distribution::settlement_config::no_filter;
use protected_event_distribution::settlement_config::stake_authorities_filter;
use protected_event_distribution::stake_meta_index::StakeMetaIndex;
use protected_event_distribution::utils::{read_from_json_file, write_to_json_file};
use snapshot_parser_types::stake_meta::StakeMetaCollection;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use {clap::Parser, log::info};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long, env)]
    sam_meta_collection: String,

    #[arg(long, env)]
    stake_meta_collection: String,

    #[arg(long, env)]
    output_settlement_collection: String,

    #[arg(long, env)]
    output_merkle_tree_collection: String,

    #[arg(long, env)]
    marinade_fee_bps: u64,

    #[arg(long, env)]
    marinade_fee_stake_authority: Pubkey,

    #[arg(long, env)]
    marinade_fee_withdraw_authority: Pubkey,

    #[arg(long, env, value_delimiter = ',')]
    whitelist_stake_authority: Option<Vec<Pubkey>>,
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.init();

    info!("Starting bid distribution...");
    let args: Args = Args::parse();

    info!("Marinade fee bps loaded: {:?}", &args.marinade_fee_bps);

    let settlement_meta = SettlementMeta {
        funder: SettlementFunder::ValidatorBond,
    };

    let settlement_config = SettlementConfig::Bidding {
        meta: settlement_meta,
        marinade_fee_bps: args.marinade_fee_bps,
        marinade_stake_authority: args.marinade_fee_stake_authority,
        marinade_withdraw_authority: args.marinade_fee_withdraw_authority,
    };

    info!("Loading SAM scoring meta collection...");
    let validator_sam_metas: Vec<ValidatorSamMeta> =
        read_from_json_file(&args.sam_meta_collection)?;

    info!("Loading stake meta collection...");
    let stake_meta_collection: StakeMetaCollection =
        read_from_json_file(&args.stake_meta_collection)?;

    info!("Building stake meta collection index...");
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    if let Some(whitelisted_stake_authorities) = &args.whitelist_stake_authority {
        info!(
            "Using whitelist on stake authorities: {:?}",
            whitelisted_stake_authorities
        );
    }

    info!(
        "Building stake authorities filter: {:?}",
        args.whitelist_stake_authority
    );
    let stake_authority_filter =
        args.whitelist_stake_authority
            .map_or(no_filter(), |whitelisted_stake_authorities| {
                stake_authorities_filter(HashSet::from_iter(whitelisted_stake_authorities))
            });
    info!("Generating settlement collection...");
    let settlement_collection = generate_bid_settlement_collection(
        &stake_meta_index,
        &validator_sam_metas,
        &stake_authority_filter,
        &settlement_config,
    );
    write_to_json_file(&settlement_collection, &args.output_settlement_collection)?;

    info!("Generating merkle tree collection...");
    let merkle_tree_collection = generate_merkle_tree_collection(settlement_collection)?;
    write_to_json_file(&merkle_tree_collection, &args.output_merkle_tree_collection)?;

    info!("Finished.");
    Ok(())
}
