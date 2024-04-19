use anyhow::anyhow;
use clap::Args;
use log::debug;
use solana_sdk::signature::{read_keypair_file, Keypair};
use solana_sdk::signer::Signer;
use std::path::Path;
use std::sync::Arc;

pub const DEFAULT_KEYPAIR_PATH: &str = "~/.config/solana/id.json";

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

    #[arg(short = 'k', long)]
    pub keypair: Option<String>,

    #[arg(long)]
    pub fee_payer: Option<String>,

    #[arg(long)]
    pub skip_preflight: bool,
}

pub fn load_default_keypair(s: Option<&str>) -> Result<Option<Arc<dyn Signer>>, anyhow::Error> {
    if s.is_none() || s.unwrap().is_empty() {
        load_keypair(DEFAULT_KEYPAIR_PATH).map_or_else(|_e| Ok(None), |keypair| Ok(Some(keypair)))
    } else {
        Ok(Some(load_keypair(s.unwrap())?))
    }
}

pub fn load_keypair(s: &str) -> Result<Arc<dyn Signer>, anyhow::Error> {
    // loading directly as the json keypair data (format [u8; 64])
    let parsed_json = parse_keypair_as_json_data(s);
    if let Ok(key_bytes) = parsed_json {
        let k = Keypair::from_bytes(&key_bytes)
            .map_err(|e| anyhow!("Could not read keypair from json data: {}", e))?;
        return Ok(Arc::new(k));
    } else {
        debug!(
            "Could not parse keypair as json data: '{:?}'",
            parsed_json.err()
        );
    }
    // loading as a file path to keypair
    let path = shellexpand::tilde(s);
    let k = read_keypair_file(Path::new(&path.to_string()))
        .map_err(|e| anyhow!("Could not read keypair file from '{}': {}", s, e))?;
    Ok(Arc::new(k))
}

fn parse_keypair_as_json_data(s: &str) -> Result<Vec<u8>, clap::Error> {
    let data: serde_json::Value = serde_json::from_str(s).map_err(|_err| {
        let mut err = clap::Error::new(clap::error::ErrorKind::ValueValidation);
        err.insert(
            clap::error::ContextKind::InvalidValue,
            clap::error::ContextValue::String(s.to_string()),
        );
        err
    })?;
    serde_json::from_value(data).map_err(|_err| {
        let mut err = clap::Error::new(clap::error::ErrorKind::ValueValidation);
        err.insert(
            clap::error::ContextKind::InvalidValue,
            clap::error::ContextValue::String(s.to_string()),
        );
        err
    })
}
