use anchor_client::anchor_lang::AccountDeserialize;
use anyhow::anyhow;
use log::{debug, error};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcAccountInfoConfig;
use solana_program::pubkey::Pubkey;
use solana_sdk::account::Account;
use std::sync::Arc;
use tokio::time::sleep;

pub async fn get_account_infos_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<Account>)>> {
    let addresses = pubkeys
        // permitted to fetch 100 accounts at once; https://solana.com/docs/rpc/http/getmultipleaccounts
        .chunks(100)
        .collect::<Vec<&[Pubkey]>>();

    let mut accounts_result: Vec<(Pubkey, Option<Account>)> = vec![];
    for address_chunk in addresses.iter() {
        let accounts = rpc_client
            .get_multiple_accounts_with_config(address_chunk, RpcAccountInfoConfig::default())
            .await
            .map_err(|e| anyhow!("Error fetching settlement accounts: {:?}", e))?;
        accounts
            .value
            .into_iter()
            .zip(address_chunk.iter())
            .for_each(|(account, pubkey)| {
                accounts_result.push((*pubkey, account));
            });
    }
    Ok(accounts_result)
}

pub async fn get_accounts_for_pubkeys<T: AccountDeserialize>(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
) -> anyhow::Result<Vec<(Pubkey, Option<T>)>> {
    let accounts = get_account_infos_for_pubkeys(rpc_client, pubkeys).await?;
    Ok(accounts
        .iter()
        .map(|(pubkey, account)| {
            let account = account.as_ref().and_then(|account| {
                let mut data: &[u8] = &account.data;
                T::try_deserialize(&mut data).map_or_else(
                    |e| {
                        error!(
                            "Cannot deserialize account data for account {}: {}",
                            pubkey, e
                        );
                        None
                    },
                    Some,
                )
            });
            (*pubkey, account)
        })
        .collect())
}

pub async fn try_get_all_account_infos_for_pubkeys(
    rpc_client: Arc<RpcClient>,
    pubkeys: &[Pubkey],
    retry_count: usize,
) -> anyhow::Result<Vec<(Pubkey, Option<Account>)>> {
    let mut counter: usize = 0;
    let accounts = loop {
        let accounts = get_account_infos_for_pubkeys(rpc_client.clone(), pubkeys).await?;
        counter += 1;
        if accounts.iter().all(|(_, account)| account.is_some()) {
            break accounts;
        }
        if counter > retry_count {
            debug!(
                "Retry limit {} reached while trying to fetch all provided pubkeys, expected length: {}, actual length: {}",
                retry_count,
                pubkeys.len(),
                accounts.iter().filter(|(_, account)| account.is_some()).count()
            );
            break accounts;
        }
        sleep(std::time::Duration::from_secs((counter * 2) as u64)).await;
    };
    Ok(accounts)
}
