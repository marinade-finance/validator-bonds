use anchor_client::anchor_lang::AccountDeserialize;
use anyhow::anyhow;
use log::error;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcAccountInfoConfig;

use solana_program::pubkey::Pubkey;

use std::sync::Arc;

pub async fn get_accounts_for_pubkeys<T: AccountDeserialize>(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<T>)>> {
    let settlement_addresses = pubkeys
        // permitted to fetch 100 accounts at once; https://solana.com/docs/rpc/http/getmultipleaccounts
        .chunks(100)
        .collect::<Vec<&[Pubkey]>>();

    let mut settlement_accounts: Vec<(Pubkey, Option<T>)> = vec![];
    for address_chunk in settlement_addresses.iter() {
        let accounts = rpc_client
            .get_multiple_accounts_with_config(address_chunk, RpcAccountInfoConfig::default())
            .await
            .map_err(|e| anyhow!("Error fetching settlement accounts: {:?}", e))?;
        accounts
            .value
            .iter()
            .zip(address_chunk.iter())
            .for_each(|(account, pubkey)| {
                let account = account.as_ref().and_then(|account| {
                    let mut data: &[u8] = &account.data;
                    T::try_deserialize(&mut data).map_or_else(
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
                settlement_accounts.push((*pubkey, account));
            });
    }
    Ok(settlement_accounts)
}
