use anyhow::anyhow;
use clap::Parser;
use log::info;
use merkle_generator::{generate_merkle_tree_collection, load_settlement_files, GeneratorConfig};
use solana_sdk::pubkey::Pubkey;
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Generate unified merkle trees from multiple settlement sources"
)]
struct Args {
    /// Comma-separated list of input settlement JSON files
    #[arg(long, value_delimiter = ',', required = true)]
    input_settlement_files: Vec<PathBuf>,

    /// Output path for unified merkle trees JSON
    #[arg(long)]
    output_merkle_trees: PathBuf,

    /// Validator bonds config pubkey (can also be set via VALIDATOR_BONDS_CONFIG env var)
    #[arg(long, env = "VALIDATOR_BONDS_CONFIG")]
    validator_bonds_config: String,
}

fn main() -> anyhow::Result<()> {
    env_logger::init();

    let args = Args::parse();

    info!("Merkle Generator CLI starting");
    info!(
        "Input files: {:?}",
        args.input_settlement_files
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    );

    let validator_bonds_config = Pubkey::from_str(&args.validator_bonds_config)
        .map_err(|e| anyhow!("Invalid validator_bonds_config pubkey: {e}"))?;

    info!("Validator bonds config: {validator_bonds_config}");

    let config = GeneratorConfig {
        validator_bonds_config,
    };

    // Load all settlement files
    let sources = load_settlement_files(&args.input_settlement_files)?;

    // Generate merkle trees
    let merkle_tree_collection = generate_merkle_tree_collection(sources, &config)?;

    // Write output
    info!(
        "Writing unified merkle trees to {}",
        args.output_merkle_trees.display()
    );
    settlement_common::utils::write_to_json_file(
        &merkle_tree_collection,
        args.output_merkle_trees
            .to_str()
            .ok_or_else(|| anyhow!("Invalid output path"))?,
    )?;

    info!("Merkle generator completed successfully");
    info!(
        "  Total merkle trees: {}",
        merkle_tree_collection.merkle_trees.len()
    );
    info!(
        "  Total claims: {}",
        merkle_tree_collection
            .merkle_trees
            .iter()
            .map(|t| t.max_total_claims)
            .sum::<usize>()
    );
    info!(
        "  Total claim amount: {} lamports",
        merkle_tree_collection
            .merkle_trees
            .iter()
            .map(|t| t.max_total_claim_sum)
            .sum::<u64>()
    );
    info!("  Sources: {:?}", merkle_tree_collection.sources);

    Ok(())
}
