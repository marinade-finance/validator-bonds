use bid_psr_distribution::merkle_tree_collection::generate_merkle_tree_collection;
use bid_psr_distribution::utils::{file_error, read_from_json_file, write_to_json_file};
use env_logger::{Builder, Env};
use institutional_psr_distribution::institutional_psr_payouts::InstitutionalPsrPayout;
use institutional_psr_distribution::settlement_generator::generate_institutional_psr_settlement_collection;
use {clap::Parser, log::info};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Input PSR institutional data calculated in the institutional-staking service.
    /// These should be a finalized input that is to be translated to a protected event
    /// merkle tree and a settlement collection.
    #[arg(long, env)]
    institutional_psr_payout: String,

    #[arg(long, env)]
    output_settlement_collection: String,

    #[arg(long, env)]
    output_merkle_tree_collection: String,
}

fn main() -> anyhow::Result<()> {
    let mut builder = Builder::from_env(Env::default().default_filter_or("info"));
    builder.init();

    info!("Starting Institutional PSR Settlements engine...");
    let args: Args = Args::parse();

    info!("Loading institutional PSR payout collection...");
    let psr_payouts: InstitutionalPsrPayout = read_from_json_file(&args.institutional_psr_payout)
        .map_err(file_error(
        "institutional-psr-payout",
        &args.institutional_psr_payout,
    ))?;

    info!("Generating institutional protected events settlement collection...");
    let settlement_collection = generate_institutional_psr_settlement_collection(&psr_payouts);
    write_to_json_file(&settlement_collection, &args.output_settlement_collection).map_err(
        file_error(
            "output-settlement-collection",
            &args.output_settlement_collection,
        ),
    )?;

    info!("Generating institutional protected events merkle tree collection...");
    let merkle_tree_collection = generate_merkle_tree_collection(settlement_collection)?;
    write_to_json_file(&merkle_tree_collection, &args.output_merkle_tree_collection).map_err(
        file_error(
            "output_merkle-tree-collection",
            &args.output_merkle_tree_collection,
        ),
    )?;

    info!("Institutional PSR Settlements engine: finished.");
    Ok(())
}
