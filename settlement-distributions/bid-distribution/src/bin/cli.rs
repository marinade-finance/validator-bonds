use bid_distribution::generators::bidding::generate_bid_settlements;
use bid_distribution::generators::psr_events::generate_psr_settlements;
use bid_distribution::generators::sam_penalties::{
    generate_bond_risk_fee_settlements, generate_penalty_settlements,
};
use bid_distribution::rewards::load_rewards_from_directory;
use bid_distribution::sam_meta::ValidatorSamMeta;
use bid_distribution::settlement_config::BidDistributionConfig;
use env_logger::{Builder, Env};
use settlement_common::protected_events::generate_protected_event_collection;
use settlement_common::revenue_expectation_meta::RevenueExpectationMetaCollection;
use settlement_common::settlement_collection::SettlementCollection;
use settlement_common::stake_meta_index::StakeMetaIndex;
use settlement_common::utils::{
    file_error, read_from_json_file, read_from_yaml_file, write_to_json_file,
};
use snapshot_parser_validator_cli::stake_meta::StakeMetaCollection;
use snapshot_parser_validator_cli::validator_meta::ValidatorMetaCollection;
use std::collections::HashSet;
use std::path::PathBuf;
use {clap::Parser, log::info};

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Unified bid distribution CLI for generating SAM and PSR settlements"
)]
struct Args {
    // ===== Required inputs =====
    /// Input collection data referring to stake accounts from the snapshot
    #[arg(long, env)]
    stake_meta_collection: String,

    /// Settlement configuration file (YAML)
    #[arg(long, env)]
    settlement_config: String,

    // ===== SAM-specific inputs (optional) =====
    /// SAM scoring meta collection JSON file
    #[arg(long, env)]
    sam_meta_collection: Option<String>,

    /// Directory containing reward JSON files
    #[arg(long, env)]
    rewards_dir: Option<PathBuf>,

    // ===== PSR-specific inputs (optional) =====
    /// Validator meta collection JSON file (for PSR)
    #[arg(long, env)]
    validator_meta_collection: Option<String>,

    /// Revenue expectation collection JSON file (for PSR)
    #[arg(long, env)]
    revenue_expectation_collection: Option<String>,

    // ===== Outputs =====
    /// Output path for combined settlement collection JSON
    #[arg(long, env)]
    output_settlement_collection: String,

    /// Output path for protected events collection JSON (PSR only)
    #[arg(long, env)]
    output_protected_event_collection: Option<String>,
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.init();

    info!("Starting unified bid distribution...");
    let args: Args = Args::parse();

    // Load settlement configuration
    info!(
        "Loading settlement configuration: {:?}",
        args.settlement_config
    );
    let bid_distribution_config: BidDistributionConfig =
        read_from_yaml_file(&args.settlement_config)
            .map_err(file_error("settlement-config", &args.settlement_config))?;
    bid_distribution_config.fee_config.validate()?;

    info!(
        "Whitelist stake authorities: {:?}",
        bid_distribution_config.whitelist_stake_authorities
    );

    // Load stake meta collection (always required)
    info!("Loading stake meta collection...");
    let stake_meta_collection: StakeMetaCollection =
        read_from_json_file(&args.stake_meta_collection).map_err(file_error(
            "stake-meta-collection",
            &args.stake_meta_collection,
        ))?;

    info!("Building stake meta collection index...");
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);
    let stake_meta_epoch = stake_meta_collection.epoch;

    let stake_authority_filter = bid_distribution_config.whitelist_stake_authorities_filter();

    let mut all_settlements = vec![];

    // ===== SAM Settlements (Bidding + Penalties) =====
    let has_sam_configs = bid_distribution_config.bidding_config().is_some()
        || bid_distribution_config
            .bid_too_low_penalty_config()
            .is_some()
        || bid_distribution_config.blacklist_penalty_config().is_some()
        || bid_distribution_config.bond_risk_fee_config().is_some();

    if has_sam_configs {
        info!("Generating SAM settlements...");

        // SAM inputs are required when SAM configs are present
        anyhow::ensure!(
            args.sam_meta_collection.is_some(),
            "--sam-meta-collection is required when SAM settlement configs are present"
        );
        anyhow::ensure!(
            args.rewards_dir.is_some(),
            "--rewards-dir is required when SAM settlement configs are present"
        );
        let sam_meta_path = args.sam_meta_collection.as_ref().unwrap();
        let rewards_dir = args.rewards_dir.as_ref().unwrap();

        // All three SAM config types are required
        let bidding_config = bid_distribution_config.bidding_config().ok_or_else(|| {
            anyhow::anyhow!("Bidding settlement config is required in bid-distribution-config")
        })?;
        let bid_too_low_penalty_config = bid_distribution_config
            .bid_too_low_penalty_config()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "BidTooLowPenalty settlement config is required in bid-distribution-config"
                )
            })?;
        let blacklist_penalty_config = bid_distribution_config
            .blacklist_penalty_config()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "BlacklistPenalty settlement config is required in bid-distribution-config"
                )
            })?;
        let bond_risk_fee_config = bid_distribution_config
            .bond_risk_fee_config()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "BondRiskFee settlement config is required in bid-distribution-config"
                )
            })?;

        info!("Loading SAM scoring meta collection...");
        let sam_validator_metas: Vec<ValidatorSamMeta> = read_from_json_file(sam_meta_path)
            .map_err(file_error("sam-meta-collection", sam_meta_path))?;

        info!("Loading rewards from directory: {rewards_dir:?}");
        let rewards_collection = load_rewards_from_directory(rewards_dir, &stake_meta_collection)?;
        info!(
            "Loaded rewards for {} vote accounts, total rewards: {}",
            rewards_collection.rewards_by_vote_account.len(),
            rewards_collection.total_rewards()
        );

        // Epoch consistency verification
        let rewards_epoch = rewards_collection.epoch;
        anyhow::ensure!(
            rewards_epoch == stake_meta_epoch,
            "Epoch mismatch between rewards collection ({rewards_epoch}) and stake meta collection ({stake_meta_epoch})",
        );
        let metas_epochs: HashSet<u64> = sam_validator_metas
            .iter()
            .map(|meta| meta.epoch as u64)
            .collect();
        anyhow::ensure!(
            metas_epochs.iter().all(|v| *v == stake_meta_epoch),
            "Epoch mismatch between SAM metas ({metas_epochs:?}) and stake meta collection ({stake_meta_epoch})",
        );

        // Generate bid settlements
        info!("Generating bid settlements...");
        let bid_settlements = generate_bid_settlements(
            &stake_meta_index,
            &sam_validator_metas,
            &rewards_collection,
            bidding_config,
            &bid_distribution_config.fee_config,
            &*stake_authority_filter,
        )?;
        info!("Generated {} bid settlements", bid_settlements.len());
        all_settlements.extend(bid_settlements);

        // Generate penalty settlements
        info!("Generating penalty settlements...");
        let penalty_settlements = generate_penalty_settlements(
            &stake_meta_index,
            &sam_validator_metas,
            bid_too_low_penalty_config,
            blacklist_penalty_config,
            bond_risk_fee_config,
            &bid_distribution_config.fee_config,
            &*stake_authority_filter,
        )?;
        info!(
            "Generated {} penalty settlements",
            penalty_settlements.len()
        );
        all_settlements.extend(penalty_settlements);

        // Generate bond risk fee settlements
        info!("Generating bond risk fee settlements...");
        let bond_risk_fee_settlements = generate_bond_risk_fee_settlements(
            &stake_meta_index,
            &sam_validator_metas,
            bond_risk_fee_config,
            &*stake_authority_filter,
        )?;
        info!(
            "Generated {} bond risk fee settlements",
            bond_risk_fee_settlements.len()
        );
        all_settlements.extend(bond_risk_fee_settlements);
    } else {
        // No SAM configs — fail if SAM inputs were partially provided (likely a mistake)
        anyhow::ensure!(
            args.sam_meta_collection.is_none() && args.rewards_dir.is_none(),
            "SAM inputs (--sam-meta-collection, --rewards-dir) provided but no SAM settlement configs found in config file"
        );
    }

    // ===== PSR Settlements (Protected Events) =====
    let psr_configs = bid_distribution_config.psr_settlements();

    if !psr_configs.is_empty() {
        info!("Generating PSR settlements...");

        // PSR inputs are required when PSR configs are present
        anyhow::ensure!(
            args.validator_meta_collection.is_some(),
            "--validator-meta-collection is required when PSR settlement configs are present"
        );
        anyhow::ensure!(
            args.revenue_expectation_collection.is_some(),
            "--revenue-expectation-collection is required when PSR settlement configs are present"
        );
        let validator_meta_path = args.validator_meta_collection.as_ref().unwrap();
        let revenue_path = args.revenue_expectation_collection.as_ref().unwrap();

        info!("Loading validator meta collection...");
        let validator_meta_collection: ValidatorMetaCollection =
            read_from_json_file(validator_meta_path)
                .map_err(file_error("validator-meta-collection", validator_meta_path))?;

        info!("Loading revenue expectation meta collection...");
        let revenue_expectation_meta_collection: RevenueExpectationMetaCollection =
            read_from_json_file(revenue_path)
                .map_err(file_error("revenue-expectation-collection", revenue_path))?;

        info!("Generating protected event collection...");
        let protected_event_collection = generate_protected_event_collection(
            validator_meta_collection,
            revenue_expectation_meta_collection,
        );

        // Output protected events if requested
        if let Some(output_path) = &args.output_protected_event_collection {
            info!("Writing protected events collection to {output_path}");
            write_to_json_file(&protected_event_collection, output_path)
                .map_err(file_error("output-protected-event-collection", output_path))?;
        }

        info!("Generating PSR settlements...");
        let psr_settlements = generate_psr_settlements(
            &stake_meta_index,
            &protected_event_collection,
            &stake_authority_filter,
            &psr_configs,
        )?;
        info!("Generated {} PSR settlements", psr_settlements.len());
        all_settlements.extend(psr_settlements);
    } else {
        // No PSR configs — fail if PSR inputs were partially provided (likely a mistake)
        anyhow::ensure!(
            args.validator_meta_collection.is_none() && args.revenue_expectation_collection.is_none(),
            "PSR inputs (--validator-meta-collection, --revenue-expectation-collection) provided but no PSR settlement configs found in config file"
        );
    }

    // Sort settlements by reason
    all_settlements.sort_by_key(|s| s.reason.to_string());

    // Create settlement collection
    let settlement_collection = SettlementCollection {
        slot: stake_meta_collection.slot,
        epoch: stake_meta_collection.epoch,
        settlements: all_settlements,
    };

    info!(
        "Total settlements generated: {}",
        settlement_collection.settlements.len()
    );

    // Write outputs
    info!(
        "Writing settlement collection to {}",
        &args.output_settlement_collection
    );
    write_to_json_file(&settlement_collection, &args.output_settlement_collection).map_err(
        file_error(
            "output-settlement-collection",
            &args.output_settlement_collection,
        ),
    )?;

    info!("Finished.");
    Ok(())
}
