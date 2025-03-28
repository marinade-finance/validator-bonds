use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::bond::Bond;

use crate::get_validator_bonds_program;
use crate::utils::get_accounts_for_pubkeys;

const CONFIG_ADDRESS_OFFSET: usize = 8;

pub async fn get_bonds(rpc_client: Arc<RpcClient>) -> anyhow::Result<Vec<(Pubkey, Bond)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}

pub async fn get_bonds_for_config(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
) -> anyhow::Result<Vec<(Pubkey, Bond)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    let filters = vec![RpcFilterType::Memcmp(Memcmp::new(
        CONFIG_ADDRESS_OFFSET,
        solana_client::rpc_filter::MemcmpEncodedBytes::Base58(config_address.to_string()),
    ))];
    Ok(program.accounts(filters).await?)
}

pub async fn get_bonds_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<Bond>)>> {
    get_accounts_for_pubkeys(rpc_client, pubkeys).await
}
