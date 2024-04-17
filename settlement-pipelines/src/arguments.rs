use clap::Args;
use solana_sdk::commitment_config::CommitmentLevel;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use std::str::FromStr;
use std::sync::Arc;

#[derive(Debug, Args)]
pub struct GlobalOpts {
    /// Logging to be verbose
    #[clap(long, short, global = true, default_value_t = false)]
    pub verbose: bool,

    #[arg(
        short = 'u',
        long,
        env,
        default_value = "https://api.mainnet-beta.solana.com"
    )]
    pub rpc_url: Option<String>,

    #[arg(short = 'k', long, default_value = "~/.config/solana/id.json")]
    pub keypair: String,

    #[arg(long)]
    pub fee_payer: Option<String>,

    #[arg(
        long,
        default_value = "confirmed",
        value_parser = parse_commitment,
    )]
    pub commitment_level: CommitmentLevel,

    #[arg(long)]
    pub skip_preflight: bool,
}

pub fn parse_keypair(s: &str) -> Result<Vec<u8>, clap::Error> {
    let path = shellexpand::tilde(s);
    let file = std::fs::File::open(path.to_string()).map_err(|_err| {
        let mut err = clap::Error::new(clap::error::ErrorKind::Io);
        err.insert(
            clap::error::ContextKind::InvalidValue,
            clap::error::ContextValue::String(s.to_string()),
        );
        err
    })?;
    let data: serde_json::Value = serde_json::from_reader(file).unwrap();
    serde_json::from_value(data).map_err(|_err| {
        let mut err = clap::Error::new(clap::error::ErrorKind::ValueValidation);
        err.insert(
            clap::error::ContextKind::InvalidValue,
            clap::error::ContextValue::String(s.to_string()),
        );
        err
    })
    // let keypair = Keypair::from_bytes(&key_bytes).map_err(|err| {
    //     let mut err = clap::Error::new(clap::error::ErrorKind::ValueValidation);
    //     err.insert(clap::error::ContextKind::InvalidValue, clap::error::ContextValue::String(s.to_string()));
    //     err
    // })?;
    // Ok(Arc::new(keypair))
}

fn parse_commitment(s: &str) -> Result<CommitmentLevel, clap::Error> {
    let commitment = CommitmentLevel::from_str(s).map_err(|_err| {
        let mut err = clap::Error::new(clap::error::ErrorKind::InvalidValue);
        err.insert(
            clap::error::ContextKind::InvalidValue,
            clap::error::ContextValue::String(s.to_string()),
        );
        err
    })?;
    Ok(commitment)
}

fn load_keypair_from_bytes(keypair_bytes: &Vec<u8>) -> Result<Arc<dyn Signer>, anyhow::Error> {
    let keypair = Keypair::from_bytes(keypair_bytes).map_err(|err| anyhow::anyhow!("{}", err))?;
    Ok(Arc::new(keypair))
}

pub fn load_keypair(s: &str) -> Result<Arc<dyn Signer>, anyhow::Error> {
    let vec_bytes = parse_keypair(s).map_err(|err| anyhow::anyhow!("{}", err))?;
    load_keypair_from_bytes(&vec_bytes)
}
