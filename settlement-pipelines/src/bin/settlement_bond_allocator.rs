use clap::Parser;
use env_logger::{Builder, Env};
use log::info;
use settlement_common::revenue_expectation_meta::RevenueExpectationMetaCollection;
use settlement_common::settlement_collection::SettlementCollection;
use settlement_common::utils::{file_error, read_from_json_file, write_to_json_file};
use settlement_pipelines::bond_allocator::{
    allocate, AllocatorInput, BondsFile, DEFAULT_EXPOSURE_WARNING_BPS,
};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;

/// Routes direct-staking PSR settlements to the bond config that can pay them.
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Direct-staking settlement collection produced by bid-distribution-cli
    #[arg(long, env)]
    input_settlement_collection: String,

    /// Bonds of the SAM config, the `/bonds/bidding` response
    #[arg(long, env)]
    bonds_bidding: String,

    /// Bonds of the institutional config, the `/bonds/institutional` response
    #[arg(long, env)]
    bonds_institutional: String,

    /// ds-sam revenue expectations, only used to report validators the auction no longer evaluates
    #[arg(long, env)]
    revenue_expectation_collection: String,

    /// Snapshot slot the settlements must belong to; a mismatch aborts without writing anything
    #[arg(long, env)]
    expect_slot: u64,

    #[arg(long, env)]
    output_bidding_settlement_collection: String,

    #[arg(long, env)]
    output_institutional_settlement_collection: String,

    #[arg(long, env)]
    output_report: String,

    /// Warn when a validator's direct-staking obligation exceeds this share of its effective bond
    #[arg(long, env, default_value_t = DEFAULT_EXPOSURE_WARNING_BPS, value_parser = clap::value_parser!(u64).range(1..=10_000))]
    exposure_warning_bps: u64,
}

fn main() -> anyhow::Result<()> {
    Builder::from_env(Env::default().default_filter_or("info")).init();

    let args: Args = Args::parse();
    info!("Starting direct-staking settlement bond allocation...");

    let collection: SettlementCollection = read_from_json_file(&args.input_settlement_collection)
        .map_err(file_error(
        "input-settlement-collection",
        &args.input_settlement_collection,
    ))?;
    let bidding_bonds: BondsFile = read_from_json_file(&args.bonds_bidding)
        .map_err(file_error("bonds-bidding", &args.bonds_bidding))?;
    let institutional_bonds: BondsFile = read_from_json_file(&args.bonds_institutional)
        .map_err(file_error("bonds-institutional", &args.bonds_institutional))?;
    let revenue_expectations: RevenueExpectationMetaCollection =
        read_from_json_file(&args.revenue_expectation_collection).map_err(file_error(
            "revenue-expectation-collection",
            &args.revenue_expectation_collection,
        ))?;
    info!(
        "Loaded {} settlements, {} bidding bonds, {} institutional bonds, {} revenue expectations",
        collection.settlements.len(),
        bidding_bonds.bonds.len(),
        institutional_bonds.bonds.len(),
        revenue_expectations.revenue_expectations.len()
    );

    let evaluated_vote_accounts: HashSet<Pubkey> = revenue_expectations
        .revenue_expectations
        .iter()
        .map(|expectation| expectation.vote_account)
        .collect();

    let output = allocate(AllocatorInput {
        collection: &collection,
        bidding_bonds: &bidding_bonds.bonds,
        institutional_bonds: &institutional_bonds.bonds,
        evaluated_vote_accounts: &evaluated_vote_accounts,
        expect_slot: args.expect_slot,
        exposure_warning_bps: args.exposure_warning_bps,
    })?;

    // Both files are always written, empty included: the schedulers use their presence as progress.
    write_to_json_file(&output.bidding, &args.output_bidding_settlement_collection).map_err(
        file_error(
            "output-bidding-settlement-collection",
            &args.output_bidding_settlement_collection,
        ),
    )?;
    write_to_json_file(
        &output.institutional,
        &args.output_institutional_settlement_collection,
    )
    .map_err(file_error(
        "output-institutional-settlement-collection",
        &args.output_institutional_settlement_collection,
    ))?;
    write_to_json_file(&output.report, &args.output_report)
        .map_err(file_error("output-report", &args.output_report))?;

    info!("Direct-staking settlement bond allocation: finished.");
    Ok(())
}
