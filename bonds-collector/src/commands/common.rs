use solana_sdk::commitment_config::CommitmentLevel;
use structopt::StructOpt;
use validator_bonds_common::dto::BondType;

#[derive(Debug, StructOpt)]
pub struct CommonCollectOptions {
    #[structopt(short = "u", env = "RPC_URL")]
    pub rpc_url: String,

    #[structopt(long = "commitment", default_value = "confirmed")]
    pub commitment: CommitmentLevel,

    #[structopt(
        short = "t",
        long = "bond-type",
        help = "Type of bond to collect (bidding or institutional)"
    )]
    pub bond_type: BondType,
}
