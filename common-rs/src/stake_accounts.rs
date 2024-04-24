use solana_account_decoder::UiAccountEncoding;
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_sdk::{
    clock::Clock,
    pubkey::Pubkey,
    stake::{self, state::StakeState},
    stake_history::StakeHistory,
    sysvar::{clock, stake_history},
};
use std::sync::Arc;

pub async fn get_stake_history(rpc_client: Arc<RpcClient>) -> anyhow::Result<StakeHistory> {
    Ok(bincode::deserialize(
        &rpc_client.get_account_data(&stake_history::ID).await?,
    )?)
}

pub async fn get_clock(rpc_client: Arc<RpcClient>) -> anyhow::Result<Clock> {
    Ok(bincode::deserialize(
        &rpc_client.get_account_data(&clock::id()).await?,
    )?)
}

pub async fn collect_stake_accounts(
    rpc_client: Arc<RpcClient>,
    withdraw_authority: Option<Pubkey>,
    stake_authority: Option<Pubkey>,
) -> anyhow::Result<Vec<(Pubkey, StakeState)>> {
    const STAKE_AUTHORITY_OFFSET: usize = 4 + 8;
    const WITHDRAW_AUTHORITY_OFFSET: usize = 4 + 8 + 32;
    let mut filters = vec![];

    if let Some(stake_authority) = stake_authority {
        filters.push(RpcFilterType::Memcmp(Memcmp::new(
            STAKE_AUTHORITY_OFFSET,
            solana_client::rpc_filter::MemcmpEncodedBytes::Base58(stake_authority.to_string()),
        )))
    }
    if let Some(withdraw_authority) = withdraw_authority {
        filters.push(RpcFilterType::Memcmp(Memcmp::new(
            WITHDRAW_AUTHORITY_OFFSET,
            solana_client::rpc_filter::MemcmpEncodedBytes::Base58(withdraw_authority.to_string()),
        )))
    }

    let accounts = rpc_client
        .get_program_accounts_with_config(
            &stake::program::ID,
            RpcProgramAccountsConfig {
                filters: Some([filters, vec![RpcFilterType::DataSize(200)]].concat()),
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .await?;
    Ok(accounts
        .into_iter()
        .map(|(pubkey, account)| (pubkey, bincode::deserialize(&account.data).unwrap()))
        .collect())
}