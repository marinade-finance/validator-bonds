use anchor_client::anchor_lang::prelude::Pubkey;
use anchor_client::{Cluster, DynSigner, Program};
use anyhow::anyhow;
use clap::Args;
use log::debug;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::{CommitmentConfig, CommitmentLevel};
use solana_sdk::signature::{read_keypair_file, Keypair, Signer};
use solana_transaction_executor::{PriorityFeePolicy, TipPolicy};
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use validator_bonds_common::{constants::MARINADE_CONFIG_ADDRESS, get_validator_bonds_program};

pub const DEFAULT_KEYPAIR_PATH: &str = "~/.config/solana/id.json";

#[derive(Debug, Args)]
pub struct GlobalOpts {
    #[arg(
        short = 'u',
        long,
        env,
        default_value = "https://api.mainnet-beta.solana.com"
    )]
    pub rpc_url: String,

    #[arg(long = "commitment", default_value = "confirmed")]
    pub commitment: CommitmentLevel,

    #[arg(short = 'k', long)]
    pub keypair: Option<String>,

    #[arg(long)]
    pub fee_payer: Option<String>,

    #[arg(long, default_value = MARINADE_CONFIG_ADDRESS)]
    pub config: Pubkey,

    #[arg(short = 'o', long)]
    pub operator_authority: Option<String>,

    /// Logging to be verbose
    #[clap(long, short, global = true, default_value_t = false)]
    pub verbose: bool,

    #[arg(long)]
    pub skip_preflight: bool,
}

#[derive(Debug, Args)]
pub struct PriorityFeePolicyOpts {
    #[arg(long)]
    micro_lamports_per_cu_min: Option<u64>,
    #[arg(long)]
    micro_lamports_per_cu_max: Option<u64>,
    #[arg(long)]
    micro_lamport_multiplier: Option<u64>,
}

#[derive(Debug, Args)]
pub struct TipPolicyOpts {
    #[arg(long)]
    tip_min: Option<u64>,
    #[arg(long)]
    tip_max: Option<u64>,
    #[arg(long)]
    tip_multiplier: Option<u64>,
}

pub fn load_default_keypair(s: Option<&str>) -> anyhow::Result<Option<Arc<Keypair>>> {
    if s.is_none() || s.unwrap().is_empty() {
        load_keypair(DEFAULT_KEYPAIR_PATH).map_or_else(|_e| Ok(None), |keypair| Ok(Some(keypair)))
    } else {
        Ok(Some(load_keypair(s.unwrap())?))
    }
}

pub fn load_keypair(s: &str) -> anyhow::Result<Arc<Keypair>> {
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

pub fn load_pubkey(s: &str) -> anyhow::Result<Pubkey> {
    let parsed_keypair_data = parse_keypair_as_json_data(s);
    if let Ok(keypair_data) = parsed_keypair_data {
        if let Ok(keypair) = Keypair::from_bytes(&keypair_data) {
            Ok(keypair.pubkey())
        } else {
            Err(anyhow!(
                "Could not read pubkey from json data that seems to be a keypair"
            ))
        }
    } else {
        Pubkey::from_str(s).map_err(|e| anyhow!("Could not parse pubkey from '{}': {}", s, e))
    }
}

fn create_clap_error(message: &str, context_value: &str) -> clap::Error {
    let mut err = clap::Error::raw(clap::error::ErrorKind::ValueValidation, message);
    err.insert(
        clap::error::ContextKind::InvalidValue,
        clap::error::ContextValue::String(context_value.to_string()),
    );
    err
}

fn parse_keypair_as_json_data(s: &str) -> Result<Vec<u8>, clap::Error> {
    let data: serde_json::Value = serde_json::from_str(s)
        .map_err(|err| create_clap_error(&format!("Failed to parse JSON data: {}", err), s))?;
    serde_json::from_value(data).map_err(|err| {
        create_clap_error(
            &format!("Failed to convert JSON data to Vec<u8>: {}", err),
            s,
        )
    })
}

pub fn to_tip_policy(opts: &TipPolicyOpts) -> TipPolicy {
    let default = TipPolicy::default();
    TipPolicy {
        tip_min: opts.tip_min.unwrap_or(default.tip_min),
        tip_max: opts.tip_max.unwrap_or(default.tip_max),
        multiplier_per_attempt: opts
            .tip_multiplier
            .unwrap_or(default.multiplier_per_attempt),
    }
}

pub fn to_priority_fee_policy(opts: &PriorityFeePolicyOpts) -> PriorityFeePolicy {
    let default = PriorityFeePolicy::default();
    PriorityFeePolicy {
        micro_lamports_per_cu_min: opts
            .micro_lamports_per_cu_min
            .unwrap_or(default.micro_lamports_per_cu_min),
        micro_lamports_per_cu_max: opts
            .micro_lamports_per_cu_max
            .unwrap_or(default.micro_lamports_per_cu_max),
        multiplier_per_attempt: opts
            .micro_lamport_multiplier
            .unwrap_or(default.multiplier_per_attempt),
    }
}

pub struct InitializedGlobalOpts {
    pub fee_payer: Arc<Keypair>,
    pub operator_authority: Arc<Keypair>,
    pub priority_fee_policy: PriorityFeePolicy,
    pub tip_policy: TipPolicy,
    pub rpc_client: Arc<RpcClient>,
    pub program: Program<Arc<DynSigner>>,
}

/// Initialize the Anchor Solana client
pub fn get_rpc_client(global_opts: &GlobalOpts) -> anyhow::Result<(Arc<RpcClient>, String)> {
    let rpc_url = global_opts.rpc_url.clone();
    let anchor_cluster = Cluster::from_str(&rpc_url)
        .map_err(|e| anyhow!("Could not parse JSON RPC url `{:?}`: {}", rpc_url, e))?;
    let rpc_client = Arc::new(RpcClient::new_with_commitment(
        anchor_cluster.to_string(),
        CommitmentConfig {
            commitment: CommitmentLevel::Confirmed,
        },
    ));
    Ok((rpc_client, rpc_url))
}

pub fn init_from_opts(
    global_opts: &GlobalOpts,
    priority_fee_policy_opts: &PriorityFeePolicyOpts,
    tip_policy_opts: &TipPolicyOpts,
) -> anyhow::Result<InitializedGlobalOpts> {
    let (rpc_client, _) = get_rpc_client(global_opts)?;

    let default_keypair = load_default_keypair(global_opts.keypair.as_deref())?;
    let fee_payer_keypair = if let Some(fee_payer) = global_opts.fee_payer.clone() {
        load_keypair(&fee_payer)?
    } else {
        default_keypair.clone().map_or(Err(anyhow!("Neither --fee-payer nor --keypair provided, no keypair to pay for transaction fees")), Ok)?
    };
    let operator_authority_keypair =
        if let Some(operator_authority) = global_opts.operator_authority.clone() {
            load_keypair(&operator_authority)?
        } else {
            default_keypair.map_or(
                Err(anyhow!(
                "Neither --operator-authority nor --keypair provided, operator keypair required"
            )),
                Ok,
            )?
        };

    let priority_fee_policy = to_priority_fee_policy(priority_fee_policy_opts);
    let tip_policy = to_tip_policy(tip_policy_opts);

    let dyn_fee_payer = Arc::new(DynSigner(Arc::new(fee_payer_keypair.clone())));
    let program = get_validator_bonds_program(rpc_client.clone(), Some(dyn_fee_payer))?;

    Ok(InitializedGlobalOpts {
        fee_payer: fee_payer_keypair,
        operator_authority: operator_authority_keypair,
        priority_fee_policy,
        tip_policy,
        rpc_client,
        program,
    })
}
