use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::withdraw_request::WithdrawRequest;

use crate::get_validator_bonds_program;

pub async fn get_withdraw_requests(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<(Pubkey, WithdrawRequest)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}
