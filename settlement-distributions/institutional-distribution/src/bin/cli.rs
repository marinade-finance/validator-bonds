use bid_psr_distribution::merkle_tree_collection::generate_merkle_tree_collection;
use bid_psr_distribution::stake_meta_index::StakeMetaIndex;
use bid_psr_distribution::utils::{file_error, read_from_json_file, write_to_json_file};
use env_logger::{Builder, Env};
use institutional_distribution::institutional_payouts::InstitutionalPayout;
use institutional_distribution::settlement_config::{
    ConfigParams, InstitutionalDistributionConfig,
};
use institutional_distribution::settlement_generator::generate_institutional_settlement_collection;
use snapshot_parser_types::stake_meta::StakeMetaCollection;
use solana_sdk::pubkey::Pubkey;
use {clap::Parser, log::info};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Input institutional payout data calculated in the institutional-staking CLI
    #[arg(long, env)]
    institutional_payouts: String,

    #[arg(long, env)]
    stake_meta_collection: String,

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

    #[arg(long, env)]
    output_settlement_collection: String,

    #[arg(long, env)]
    output_merkle_tree_collection: String,
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.init();

    info!("Starting Institutional Payout Settlements calculation...");
    let args: Args = Args::parse();

    info!(
        "DAO fee split share bps {:?} loaded",
        &args.dao_fee_split_share_bps
    );

    info!("Loading Institutional Payout collection...");
    let institutional_payouts: InstitutionalPayout =
        read_from_json_file(&args.institutional_payouts).map_err(file_error(
            "institutional-payouts",
            &args.institutional_payouts,
        ))?;

    info!("Loading Stake Meta Collection...");
    let stake_meta_collection: StakeMetaCollection =
        read_from_json_file(&args.stake_meta_collection).map_err(file_error(
            "stake-meta-collection",
            &args.stake_meta_collection,
        ))?;
    info!("Building Stake Meta Collection Index...");
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let config = InstitutionalDistributionConfig::new(ConfigParams {
        marinade_stake_authority: args.marinade_fee_stake_authority,
        marinade_withdraw_authority: args.marinade_fee_withdraw_authority,
        dao_fee_split_share_bps: args.dao_fee_split_share_bps,
        dao_stake_authority: args.dao_fee_stake_authority,
        dao_withdraw_authority: args.dao_fee_withdraw_authority,
        snapshot_slot: institutional_payouts.slot,
    });

    info!("Generating Institutional Payout Settlement collection...");
    let settlement_collection = generate_institutional_settlement_collection(
        &config,
        &institutional_payouts,
        &stake_meta_index,
    );
    write_to_json_file(&settlement_collection, &args.output_settlement_collection).map_err(
        file_error(
            "output-settlement-collection",
            &args.output_settlement_collection,
        ),
    )?;

    info!("Generating Institutional Payout Merkle tree collection...");
    let merkle_tree_collection = generate_merkle_tree_collection(settlement_collection)?;
    write_to_json_file(&merkle_tree_collection, &args.output_merkle_tree_collection).map_err(
        file_error(
            "output-merkle-tree-collection",
            &args.output_merkle_tree_collection,
        ),
    )?;

    info!("Institutional Payout Settlements calculation: finished.");
    Ok(())
}
