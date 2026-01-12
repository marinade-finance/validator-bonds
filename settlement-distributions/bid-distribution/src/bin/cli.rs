use bid_distribution::sam_meta::ValidatorSamMeta;
use bid_distribution::settlement_claims::generate_settlements_collection;
use bid_distribution::settlement_config::SettlementConfig;
use bid_psr_distribution::merkle_tree_collection::generate_merkle_tree_collection;
use bid_psr_distribution::rewards::load_rewards_from_directory;
use bid_psr_distribution::settlement_collection::SettlementFunder;
use bid_psr_distribution::settlement_collection::SettlementMeta;
use bid_psr_distribution::stake_meta_index::StakeMetaIndex;
use bid_psr_distribution::utils::{file_error, read_from_json_file, write_to_json_file};
use env_logger::{Builder, Env};
use snapshot_parser_validator_cli::stake_meta::StakeMetaCollection;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use std::path::PathBuf;
use {clap::Parser, log::info};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long, env)]
    sam_meta_collection: String,

    #[arg(long, env)]
    stake_meta_collection: String,

    #[arg(long, env)]
    rewards_dir: PathBuf,

    #[arg(long, env)]
    output_settlement_collection: String,

    #[arg(long, env)]
    output_merkle_tree_collection: String,

    #[arg(long)]
    output_config: String,

    // Total Marinade (distributor) fee split between Marinade and DAO
    #[arg(long, env)]
    marinade_fee_bps: u64,

    #[arg(long, env)]
    marinade_fee_stake_authority: Pubkey,

    #[arg(long, env)]
    marinade_fee_withdraw_authority: Pubkey,

    // DAO share of the total Marinade (distributor) fee
    #[arg(long, env)]
    dao_fee_split_share_bps: u64,

    #[arg(long, env)]
    dao_fee_stake_authority: Pubkey,

    #[arg(long, env)]
    dao_fee_withdraw_authority: Pubkey,

    #[arg(long, env, value_delimiter = ',')]
    whitelist_stake_authority: Option<Vec<Pubkey>>,

    #[arg(long, env)]
    validator_bonds_config: Pubkey,
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.init();

    info!("Starting bid distribution...");
    let args: Args = Args::parse();

    info!(
        "Marinade fee bps {:?}, DAO fee split share bps {:?}, whitelist stake authorities: {:?}",
        &args.marinade_fee_bps, &args.dao_fee_split_share_bps, &args.whitelist_stake_authority
    );

    let settlement_config = SettlementConfig::Bidding {
        validator_bonds_config: args.validator_bonds_config,
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        marinade_fee_bps: args.marinade_fee_bps,
        marinade_stake_authority: args.marinade_fee_stake_authority,
        marinade_withdraw_authority: args.marinade_fee_withdraw_authority,
        dao_fee_split_share_bps: args.dao_fee_split_share_bps,
        dao_stake_authority: args.dao_fee_stake_authority,
        dao_withdraw_authority: args.dao_fee_withdraw_authority,
        whitelist_stake_authorities: args.whitelist_stake_authority.clone(),
    };

    info!("Loading SAM scoring meta collection...");
    let sam_validator_metas: Vec<ValidatorSamMeta> = read_from_json_file(&args.sam_meta_collection)
        .map_err(file_error("sam-meta-collection", &args.sam_meta_collection))?;

    info!("Loading stake meta collection...");
    let stake_meta_collection: StakeMetaCollection =
        read_from_json_file(&args.stake_meta_collection).map_err(file_error(
            "stake-meta-collection",
            &args.stake_meta_collection,
        ))?;

    info!("Building stake meta collection index...");
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    info!("Loading rewards from directory: {:?}", &args.rewards_dir);
    let rewards_collection =
        load_rewards_from_directory(&args.rewards_dir, &stake_meta_collection)?;
    info!(
        "Loaded rewards for {} vote accounts, total rewards: {}",
        rewards_collection.rewards_by_vote_account.len(),
        rewards_collection.total_rewards()
    );

    info!("Verification of input data epoch consistency...");
    let rewards_epoch = rewards_collection.epoch;
    let stake_meta_epoch = stake_meta_collection.epoch;
    anyhow::ensure!(
        rewards_epoch == stake_meta_epoch,
        "Epoch mismatch between rewards collection ({}), and stake meta collection ({})",
        rewards_epoch,
        stake_meta_epoch,
    );
    let metas_epochs: HashSet<u64> = sam_validator_metas
        .iter()
        .map(|meta| meta.epoch as u64)
        .collect();
    anyhow::ensure!(
        metas_epochs.iter().all(|v| *v == stake_meta_epoch),
        format!(
            "Epoch mismatch between SAM metas ({:?}) and stake meta collection ({})",
            metas_epochs, stake_meta_epoch,
        ),
    );

    info!("Generating settlement collection...");
    let settlement_collection = generate_settlements_collection(
        &stake_meta_index,
        &sam_validator_metas,
        &rewards_collection,
        &settlement_config,
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
            "output-merkle-tree-collection",
            &args.output_merkle_tree_collection,
        ),
    )?;

    info!("Writing settlement config to {}", &args.output_config);
    write_to_json_file(&settlement_config, &args.output_config)
        .map_err(file_error("output-config", &args.output_config))?;

    info!("Finished.");
    Ok(())
}
