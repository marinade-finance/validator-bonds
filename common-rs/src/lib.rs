use anchor_client::{Client, Cluster, DynSigner, Program};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::signature::Keypair;
use std::{str::FromStr, sync::Arc};

pub mod bonds;
pub mod config;
pub mod constants;
pub mod dto;
pub mod funded_bonds;
pub mod settlement_claims;
pub mod settlements;
pub mod stake_accounts;
pub mod utils;
pub mod utils_rpc_retry;
pub mod withdraw_requests;

pub fn get_validator_bonds_program(
    rpc_client: Arc<RpcClient>,
    payer: Option<Arc<DynSigner>>,
) -> anyhow::Result<Program<Arc<DynSigner>>> {
    let payer = payer.unwrap_or(Arc::new(DynSigner(Arc::new(Keypair::new()))));

    Ok(Client::new_with_options(
        Cluster::from_str(&rpc_client.url())?,
        payer,
        rpc_client.commitment(),
    )
    .program(validator_bonds::ID)?)
}
