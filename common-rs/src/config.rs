use crate::get_validator_bonds_program;
use crate::utils::get_accounts_for_pubkeys;
use anyhow::anyhow;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::pubkey::Pubkey;
use std::sync::Arc;

use validator_bonds::state::config::Config;

pub async fn get_config(
    rpc_client: Arc<RpcClient>,
    config_address: Pubkey,
) -> anyhow::Result<Config> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    let config = program.account(config_address).await.map_err(|e| {
        anyhow!(
            "Cannot load validator-bonds config account {}: {:?}",
            config_address,
            e
        )
    })?;
    Ok(config)
}

pub async fn get_configs_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<Config>)>> {
    get_accounts_for_pubkeys(rpc_client, pubkeys).await
}
