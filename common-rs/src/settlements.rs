use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

use std::sync::Arc;

use validator_bonds::state::settlement::Settlement;

use crate::get_validator_bonds_program;
use crate::utils::get_accounts_for_pubkeys;

pub async fn get_settlements(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<(Pubkey, Settlement)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}

pub async fn get_settlements_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<Settlement>)>> {
    get_accounts_for_pubkeys(rpc_client, pubkeys).await
}
