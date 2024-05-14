use crate::utils::get_sysvar_clock;
use log::info;
use solana_account_decoder::{UiAccountEncoding, UiDataSliceConfig};
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_program::stake::state::StakeStateV2;
use solana_program::stake_history::StakeHistoryEntry;
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

/// stake account pubkey, lamports in account, stake state
pub type CollectedStakeAccounts = Vec<(Pubkey, u64, StakeStateV2)>;

pub async fn collect_stake_accounts(
    rpc_client: Arc<RpcClient>,
    withdraw_authority: Option<&Pubkey>,
    stake_authority: Option<&Pubkey>,
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

// Mapping provided stake accounts to the voter_pubkey,
// i.e., to the vote account that the stake account is delegated to
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

pub fn is_locked(stake: &StakeStateV2, clock: &Clock) -> bool {
    stake.lockup().is_some() && stake.lockup().unwrap().is_in_force(clock, None)
}

// From provided stake accounts it filters out:
// - all non-locked stake accounts that are funded to the Settlement
// provided stake accounts are fully deactivated and whole lamports amount can be used for claiming
// returns Map<settlement_pubkey, Vec<stake_account_data>>
pub async fn obtain_claimable_stake_accounts_for_settlement(
    stake_accounts: CollectedStakeAccounts,
    config_address: &Pubkey,
    settlement_addresses: Vec<Pubkey>,
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<HashMap<Pubkey, (u64, CollectedStakeAccounts)>> {
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let stake_history = get_stake_history(rpc_client.clone()).await?;
    let filtered_deactivated_stake_accounts: CollectedStakeAccounts = stake_accounts
        .into_iter()
        .filter(|(_, _, stake)| {
            if is_locked(stake, &clock) {
                // cannot use locked stake account
                false
            } else if let Some(delegation) = stake.delegation() {
                // stake has got delegation but is fully deactivated
                // https://github.com/marinade-finance/native-staking/blob/master/bot/src/utils/stakes.rs#L64C1-L64C113
                delegation
                    .stake_activating_and_deactivating(clock.epoch, Some(&stake_history), None)
                    .effective
                    == 0
            } else {
                // non-locked, non-delegated, maybe initialized (more filtering under map_stake_accounts_to_settlement)
                true
            }
        })
        .collect();
    let settlement_map = map_stake_accounts_to_settlement(
        filtered_deactivated_stake_accounts,
        config_address,
        settlement_addresses,
    );
    Ok(settlement_map)
}

// All non locked stake accounts that are funded to the Settlement
// Stake accounts are good to be claimed in near future (i.e., in next epoch, deactivated)
pub async fn obtain_funded_stake_accounts_for_settlement(
    stake_accounts: CollectedStakeAccounts,
    config_address: &Pubkey,
    settlement_addresses: Vec<Pubkey>,
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<HashMap<Pubkey, (u64, CollectedStakeAccounts)>> {
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let stake_history = get_stake_history(rpc_client.clone()).await?;
    let filtered_to_be_deactivated_stake_accounts: CollectedStakeAccounts = stake_accounts
        .into_iter()
        .filter(|(_, _, stake)| {
            if is_locked(stake, &clock) {
                // cannot use locked stake account
                false
            } else if let Some(delegation) = stake.delegation() {
                // fully deactivated or deactivating
                let StakeHistoryEntry {
                    effective,
                    deactivating,
                    activating: _,
                } = delegation.stake_activating_and_deactivating(
                    clock.epoch,
                    Some(&stake_history),
                    None,
                );
                effective == 0 || deactivating > 0
            } else {
                // non-locked, non-delegated, maybe initialized (more filtering under map_stake_accounts_to_settlement)
                true
            }
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
    // calculate sum of lamports for each settlement address
    settlement_map
        .into_iter()
        .map(|(k, v)| {
            let sum = v.iter().map(|(_, lamports, _)| *lamports).sum::<u64>();
            (k, (sum, v))
        })
        .collect::<HashMap<_, _>>()
}

pub async fn get_stake_account_slices(
    rpc_client: Arc<RpcClient>,
    stake_authority: Option<Pubkey>,
    slice: Option<(usize, usize)>,
    fetch_pause_millis: Option<u64>,
) -> (Vec<(Pubkey, StakeStateV2)>, Option<anyhow::Error>) {
    info!(
        "Fetching stake account slices {:?} with stake authority: {:?}",
        slice, stake_authority
    );
    let mut stake_accounts_count = 0;
    let data_slice = slice.map(|(offset, length)| UiDataSliceConfig { offset, length });
    let mut stake_accounts: Vec<(Pubkey, StakeStateV2)> = vec![];
    let mut errors: Vec<String> = vec![];

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
        let result = rpc_client
            .get_program_accounts_with_config(
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
            )
            .await;
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

        // pause between fetches to not overwhelming the RPC with many requests
        if let Some(fetch_pause) = fetch_pause_millis {
            tokio::time::sleep(tokio::time::Duration::from_millis(fetch_pause)).await;
        }
    }

    info!(
        "Loaded {} stake accounts with filter: {:?}",
        stake_accounts_count,
        (stake_authority, slice)
    );
    let result_error = if errors.is_empty() {
        None
    } else {
        Some(anyhow::anyhow!(
            "Failed to fetch stake accounts: {:?}",
            errors
        ))
    };

    (stake_accounts, result_error)
}
