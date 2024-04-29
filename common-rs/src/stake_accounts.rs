use crate::utils::get_sysvar_clock;
use futures::future::join_all;
use log::info;
use solana_account_decoder::{UiAccountEncoding, UiDataSliceConfig};
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_program::stake::state::StakeStateV2;
use solana_sdk::{
    clock::Clock,
    pubkey::Pubkey,
    stake::{self},
    stake_history::StakeHistory,
    sysvar::{clock, stake_history},
};
use std::collections::HashMap;
use std::sync::Arc;
use validator_bonds::state::config::find_bonds_withdrawer_authority;
use validator_bonds::state::settlement::find_settlement_staker_authority;

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

pub type CollectedStakeAccounts = Vec<(Pubkey, u64, StakeStateV2)>;

pub async fn collect_stake_accounts(
    rpc_client: Arc<RpcClient>,
    withdraw_authority: Option<Pubkey>,
    stake_authority: Option<Pubkey>,
) -> anyhow::Result<CollectedStakeAccounts> {
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
        .map(|(pubkey, account)| {
            (
                pubkey,
                account.lamports,
                bincode::deserialize(&account.data).unwrap_or_else(|_| {
                    panic!("Failed to deserialize stake account data for {}", pubkey)
                }),
            )
        })
        .collect())
}

// returns Map<voter_pubkey, Vec<stake_account_data>>
pub async fn obtain_delegated_stake_accounts(
    stake_accounts: CollectedStakeAccounts,
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<HashMap<Pubkey, CollectedStakeAccounts>> {
    let clock: Clock = get_sysvar_clock(rpc_client).await?;
    let mut vote_account_map: HashMap<Pubkey, CollectedStakeAccounts> = HashMap::new();
    for (pubkey, lamports, stake) in stake_accounts {
        // locked stake accounts are not correctly delegated to bonds
        if !is_locked(&stake, &clock) {
            if let Some(delegated_stake) = stake.stake() {
                let voter_pubkey = delegated_stake.delegation.voter_pubkey;
                vote_account_map
                    .entry(voter_pubkey)
                    .or_default()
                    .push((pubkey, lamports, stake));
            }
        }
    }
    Ok(vote_account_map)
}

fn is_locked(stake: &StakeStateV2, clock: &Clock) -> bool {
    stake.lockup().is_some() && stake.lockup().unwrap().is_in_force(clock, None)
}

// returns Map<settlement_pubkey, Vec<stake_account_data>>
pub async fn obtain_claimable_stake_accounts_for_settlement(
    stake_accounts: CollectedStakeAccounts,
    config_address: &Pubkey,
    settlement_addresses: Vec<Pubkey>,
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<HashMap<Pubkey, (u64, CollectedStakeAccounts)>> {
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let filtered_deactivated_stake_accounts: CollectedStakeAccounts = stake_accounts
        .into_iter()
        .filter(|(_, _, stake)| {
            !is_locked(stake, &clock)
                // stake account is initialized or delegated+deactivated
                && (stake.delegation().is_none()
                    || stake.delegation().unwrap().deactivation_epoch <= clock.epoch)
        })
        .collect();
    let settlement_map = map_stake_accounts_to_settlement(
        filtered_deactivated_stake_accounts,
        config_address,
        settlement_addresses,
    );
    Ok(settlement_map)
}

pub async fn obtain_funded_stake_accounts_for_settlement(
    stake_accounts: CollectedStakeAccounts,
    config_address: &Pubkey,
    settlement_addresses: Vec<Pubkey>,
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<HashMap<Pubkey, (u64, CollectedStakeAccounts)>> {
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let filtered_to_be_deactivated_stake_accounts: CollectedStakeAccounts = stake_accounts
        .into_iter()
        .filter(|(_, _, stake)| {
            !is_locked(stake, &clock)
                && (stake.delegation().is_none()
                    || stake.delegation().unwrap().deactivation_epoch <= clock.epoch + 1)
        })
        .collect();
    let settlement_map = map_stake_accounts_to_settlement(
        filtered_to_be_deactivated_stake_accounts,
        config_address,
        settlement_addresses,
    );
    Ok(settlement_map)
}

fn map_stake_accounts_to_settlement(
    stake_accounts: CollectedStakeAccounts,
    config_address: &Pubkey,
    settlement_addresses: Vec<Pubkey>,
) -> HashMap<Pubkey, (u64, CollectedStakeAccounts)> {
    let mut settlement_map: HashMap<Pubkey, CollectedStakeAccounts> = HashMap::new();
    let (withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    for settlement_address in settlement_addresses {
        let (staker_authority, _) = find_settlement_staker_authority(&settlement_address);
        for (pubkey, lamports, stake) in stake_accounts.iter() {
            if let Some(authorized) = stake.authorized() {
                if authorized.staker == staker_authority
                    && authorized.withdrawer == withdrawer_authority
                {
                    settlement_map
                        .entry(settlement_address)
                        .or_default()
                        .push((*pubkey, *lamports, *stake))
                }
            }
        }
    }
    settlement_map
        .into_iter()
        .map(|(k, mut v)| {
            let sum = v.iter().map(|(_, lamports, _)| *lamports).sum::<u64>();
            // sorting stake accounts with delegation before those without it
            v.sort_by(|(_, _, stake1), (_, _, stake2)| {
                let ord1 = if let Some(_d) = stake1.delegation() {
                    -1
                } else {
                    1
                };
                let ord2 = if let Some(_d) = stake2.delegation() {
                    -1
                } else {
                    1
                };
                ord1.partial_cmp(&ord2).unwrap()
            });
            (k, (sum, v))
        })
        .collect::<HashMap<_, _>>()
}

pub async fn get_stake_account_slices(
    rpc_client: Arc<RpcClient>,
    stake_authority: Option<Pubkey>,
    slice: Option<(usize, usize)>,
) -> anyhow::Result<Vec<(Pubkey, StakeStateV2)>> {
    info!(
        "Fetching stake account slices {:?} with stake authority: {:?}",
        slice, stake_authority
    );
    let mut stake_accounts_count = 0;
    let data_slice = slice.map(|(offset, length)| UiDataSliceConfig { offset, length });
    let mut stake_accounts: Vec<(Pubkey, StakeStateV2)> = vec![];
    let mut errors: Vec<String> = vec![];
    let mut futures = vec![];

    for page in 0..=u8::MAX {
        let mut filters: Vec<RpcFilterType> = vec![RpcFilterType::DataSize(200)];
        if let Some(stake_authority) = stake_authority {
            filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                4 + 8,
                stake_authority.to_bytes().to_vec(),
            )));
        }
        filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
            4 + 8 + 32,
            vec![page],
        )));
        let future = rpc_client.get_program_accounts_with_config(
            &stake::program::ID,
            RpcProgramAccountsConfig {
                filters: Some(filters.clone()),
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    commitment: Some(rpc_client.commitment()),
                    data_slice,
                    min_context_slot: None,
                },
                with_context: None,
            },
        );
        futures.push(future);
    }

    let results = join_all(futures).await;

    for result in results {
        match result {
            Ok(accounts) => {
                stake_accounts_count += accounts.len();
                for (pubkey, account) in accounts {
                    let stake_state = bincode::deserialize(&account.data).unwrap_or_else(|_| {
                        panic!("Failed to deserialize stake account data for {}", pubkey)
                    });
                    stake_accounts.push((pubkey, stake_state));
                }
            }
            Err(err) => {
                errors.push(format!("Failed to fetch stake accounts slice: {:?}", err));
            }
        };
    }

    info!(
        "Loaded {} stake accounts with filter: {:?}",
        stake_accounts_count,
        (stake_authority, slice)
    );
    if !errors.is_empty() {
        return Err(anyhow::anyhow!(
            "Failed to fetch stake accounts: {:?}",
            errors
        ));
    }
    Ok(stake_accounts)
}
