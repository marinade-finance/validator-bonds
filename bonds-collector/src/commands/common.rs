use clap::Args;
use solana_sdk::commitment_config::CommitmentLevel;
use validator_bonds_common::dto::BondType;

// BondType's FromStr error is anyhow::Error, which doesn't implement
// std::error::Error, so clap's derive can't use the FromStr value parser
// directly. Wrap it in a parser that maps the error to a String.
fn parse_bond_type(s: &str) -> Result<BondType, String> {
    s.parse::<BondType>().map_err(|e| e.to_string())
}

#[derive(Debug, Args)]
pub struct CommonCollectOptions {
    #[arg(short = 'u', env = "RPC_URL")]
    pub rpc_url: String,

    #[arg(long = "commitment", default_value = "confirmed")]
    pub commitment: CommitmentLevel,

    #[arg(
        short = 't',
        long = "bond-type",
        value_parser = parse_bond_type,
        help = "Type of bond to collect (bidding or institutional)"
    )]
    pub bond_type: BondType,
}
