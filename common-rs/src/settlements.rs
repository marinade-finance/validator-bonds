use anchor_client::anchor_lang::AccountDeserialize;
use log::error;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use validator_bonds::state::settlement::Settlement;

use crate::get_validator_bonds_program;

pub async fn get_settlements(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<Vec<(Pubkey, Settlement)>> {
    let program = get_validator_bonds_program(rpc_client, None)?;
    Ok(program.accounts(Default::default()).await?)
}

pub async fn get_settlements_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &Vec<Pubkey>,
) -> anyhow::Result<Vec<(Pubkey, Option<Settlement>)>> {
    let settlement_accounts = rpc_client.get_multiple_accounts(&pubkeys).await?;
    pubkeys
        .iter()
        .zip(settlement_accounts.iter())
        .map(|(pubkey, account)| {
            let account = account.as_ref().and_then(|account| {
                let mut data: &[u8] = &account.data;
                Settlement::try_deserialize(&mut data).map_or_else(
                    |e| {
                        error!(
                            "Cannot deserialize account data for settlement account {}: {}",
                            pubkey, e
                        );
                        None
                    },
                    Some,
                )
            });
            Ok((*pubkey, account))
        })
        .collect()
}
