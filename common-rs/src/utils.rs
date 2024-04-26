use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::clock::Clock;
use solana_program::sysvar::clock;
use std::sync::Arc;

pub async fn get_sysvar_clock(client: Arc<RpcClient>) -> anyhow::Result<Clock> {
    let clock = client.get_account(&clock::ID).await?;
    bincode::deserialize(&clock.data).map_err(Into::into)
}
