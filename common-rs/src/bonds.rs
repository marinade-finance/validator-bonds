use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::bond::Bond;

use crate::get_anchor_client;

pub async fn get_bonds(rpc_client: Arc<RpcClient>) -> anyhow::Result<Vec<(Pubkey, Bond)>> {
    let program = get_anchor_client(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}
