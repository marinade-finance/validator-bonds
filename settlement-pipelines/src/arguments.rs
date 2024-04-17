use anyhow::anyhow;
use clap::Args;
use solana_sdk::signature::read_keypair_file;
use solana_sdk::signer::Signer;
use std::path::Path;
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

    #[arg(long)]
    pub skip_preflight: bool,
}

pub fn load_keypair(s: &str) -> Result<Arc<dyn Signer>, anyhow::Error> {
    let path = shellexpand::tilde(s);
    let k = read_keypair_file(Path::new(&path.to_string()))
        .map_err(|e| anyhow!("Could not read keypair file from '{}': {}", s, e))?;
    Ok(Arc::new(k))
}
