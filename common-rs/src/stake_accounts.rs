use crate::cli_result::CliError;
use log::{info, warn};
use solana_account_decoder::UiAccountEncoding;
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
    stake_history::StakeHistory,
    sysvar::{clock, stake_history},
};
use solana_stake_interface::program::ID as stake_program_id;
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
pub type CollectedStakeAccount = (Pubkey, u64, StakeStateV2);
pub type CollectedStakeAccounts = Vec<CollectedStakeAccount>;

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
            &stake_program_id,
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
                    panic!("Failed to deserialize stake account data for {pubkey}")
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
    clock: &Clock,
) -> anyhow::Result<HashMap<Pubkey, CollectedStakeAccounts>> {
    let mut vote_account_map: HashMap<Pubkey, CollectedStakeAccounts> = HashMap::new();
    for (pubkey, lamports, stake) in stake_accounts {
        // locked stake accounts are not correctly delegated to bonds
        if !is_locked(&stake, clock) {
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

// From provided stake accounts it filters for:
// - all non-locked stake accounts that are funded to a Settlement
// That means the returned Stake Accounts are fully deactivated
// and their whole lamports amount can be used for claiming
// - Returns Map<settlement_pubkey, Vec<stake_account_data>>
pub async fn obtain_claimable_stake_accounts_for_settlement(
    stake_accounts: CollectedStakeAccounts,
    config_address: &Pubkey,
    settlement_addresses: Vec<Pubkey>,
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<HashMap<Pubkey, (u64, CollectedStakeAccounts)>> {
    let clock = get_clock(rpc_client.clone()).await?;
    let stake_history = get_stake_history(rpc_client.clone()).await?;
    let filtered_deactivated_stake_accounts: CollectedStakeAccounts = stake_accounts
        .into_iter()
        .filter(|(pubkey, _, stake)| {
            if is_locked(stake, &clock) {
                // cannot use locked stake account
                warn!(
                    "Locked stake account {} found (withdrawer {}/staker {})",
                    pubkey,
                    stake
                        .authorized()
                        .map_or("None".to_string(), |a| a.withdrawer.to_string()),
                    stake
                        .authorized()
                        .map_or("None".to_string(), |a| a.staker.to_string()),
                );
                false
            } else if let Some(delegation) = stake.delegation() {
                // stake has got delegation but is fully deactivated
                // https://github.com/marinade-finance/native-staking/blob/master/bot/src/utils/stakes.rs#L64C1-L64C113
                delegation
                    .stake_activating_and_deactivating(clock.epoch, &stake_history, None)
                    .effective
                    == 0
            } else {
                // non-locked, non-delegated, maybe initialized (initialized has got authorities but not delegation)
                // (more filtering under map_stake_accounts_to_settlement)
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
    clock: &Clock,
    stake_history: &StakeHistory,
) -> anyhow::Result<HashMap<Pubkey, (u64, CollectedStakeAccounts)>> {
    let filtered_to_be_deactivated_stake_accounts: CollectedStakeAccounts = stake_accounts
        .into_iter()
        .filter(|(_, _, stake)| {
            if is_locked(stake, clock) {
                // cannot use locked stake account
                false
            } else if let Some(delegation) = stake.delegation() {
                // fully deactivated or deactivating
                let StakeHistoryEntry {
                    effective,
                    deactivating,
                    activating: _,
                } = delegation.stake_activating_and_deactivating(clock.epoch, stake_history, None);
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

#[derive(Default, Clone, Debug, PartialEq)]
pub struct StakeAggregate {
    pub effective: u64,
    pub activating: u64,
    pub deactivating: u64,
    pub stake_accounts: u32,
}

/// `deactivating` is a subset of `effective`, never additive: Agave's `with_deactivating` reports the
/// cooling-down stake as effective for that epoch too. Active-only is `effective - deactivating`.
fn aggregate_stake_by_vote_account(
    stake_accounts: &CollectedStakeAccounts,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> HashMap<Pubkey, StakeAggregate> {
    let mut per_vote_account: HashMap<Pubkey, StakeAggregate> = HashMap::new();

    for (_, _, stake) in stake_accounts {
        if is_locked(stake, clock) {
            continue;
        }
        let Some(delegation) = stake.delegation() else {
            continue;
        };
        let StakeHistoryEntry {
            effective,
            activating,
            deactivating,
        } = delegation.stake_activating_and_deactivating(clock.epoch, stake_history, None);

        let aggregate = per_vote_account.entry(delegation.voter_pubkey).or_default();
        aggregate.effective += effective;
        aggregate.activating += activating;
        aggregate.deactivating += deactivating;
        aggregate.stake_accounts += 1;
    }

    // Fully cooled-down accounts keep their delegation, so they would otherwise contribute rows
    // carrying no stake at all — 878 of them on the native exit authority for 14 SOL.
    per_vote_account.retain(|_, aggregate| {
        aggregate.effective + aggregate.activating + aggregate.deactivating > 0
    });
    per_vote_account
}

/// `epoch`/`slot` are the ones the amounts were computed against, so a caller stamping a snapshot
/// cannot pair them with a different clock than the warmup/cooldown math used.
pub struct StakeByAuthority {
    pub epoch: u64,
    pub slot: u64,
    pub authorities: HashMap<Pubkey, HashMap<Pubkey, StakeAggregate>>,
}

/// Marinade-routed stake per staker authority, per vote account. Errors are never partial: a missing
/// authority understates the stake and would over-report bond coverage downstream.
pub async fn collect_stake_by_authority(
    rpc_client: Arc<RpcClient>,
    stake_authorities: &[Pubkey],
) -> Result<StakeByAuthority, CliError> {
    let clock = get_clock(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;
    let stake_history = get_stake_history(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;

    let mut authorities = HashMap::new();
    for stake_authority in stake_authorities {
        let stake_accounts =
            collect_stake_accounts(rpc_client.clone(), None, Some(stake_authority))
                .await
                .map_err(CliError::retry_able)?;
        let per_vote_account =
            aggregate_stake_by_vote_account(&stake_accounts, &clock, &stake_history);

        let effective: u64 = per_vote_account
            .values()
            .map(|aggregate| aggregate.effective)
            .sum();
        info!(
            "Stake authority {stake_authority}: {} accounts, {} vote accounts, {} lamports effective",
            stake_accounts.len(),
            per_vote_account.len(),
            effective
        );

        authorities.insert(*stake_authority, per_vote_account);
    }

    Ok(StakeByAuthority {
        epoch: clock.epoch,
        slot: clock.slot,
        authorities,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::stake::state::{Delegation, Meta, Stake};
    use solana_stake_interface::stake_flags::StakeFlags;

    const EPOCH: u64 = 1014;
    const STAKE: u64 = 100_000;

    // An empty StakeHistory makes the Agave warmup/cooldown math deterministic: outside the
    // activation and deactivation epochs it reports the delegation verbatim or nothing at all.
    fn stake_state(
        activation_epoch: u64,
        deactivation_epoch: u64,
        lockup_epoch: u64,
    ) -> StakeStateV2 {
        let mut meta = Meta::default();
        meta.lockup.epoch = lockup_epoch;
        StakeStateV2::Stake(
            meta,
            Stake {
                delegation: Delegation {
                    voter_pubkey: vote_account(),
                    stake: STAKE,
                    activation_epoch,
                    deactivation_epoch,
                    ..Default::default()
                },
                credits_observed: 0,
            },
            StakeFlags::empty(),
        )
    }

    fn vote_account() -> Pubkey {
        Pubkey::from_str_const("We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb")
    }

    fn aggregate(states: Vec<StakeStateV2>) -> HashMap<Pubkey, StakeAggregate> {
        let accounts: CollectedStakeAccounts = states
            .into_iter()
            .map(|state| (Pubkey::new_unique(), STAKE, state))
            .collect();
        let clock = Clock {
            epoch: EPOCH,
            ..Default::default()
        };
        aggregate_stake_by_vote_account(&accounts, &clock, &StakeHistory::default())
    }

    fn only(states: Vec<StakeStateV2>) -> StakeAggregate {
        let aggregated = aggregate(states);
        assert_eq!(aggregated.len(), 1, "expected one vote account");
        aggregated.get(&vote_account()).unwrap().clone()
    }

    #[test]
    fn activated_stake_is_effective() {
        assert_eq!(
            only(vec![stake_state(EPOCH - 1, u64::MAX, 0)]),
            StakeAggregate {
                effective: STAKE,
                activating: 0,
                deactivating: 0,
                stake_accounts: 1,
            }
        );
    }

    #[test]
    fn stake_activating_this_epoch_is_not_effective_yet() {
        assert_eq!(
            only(vec![stake_state(EPOCH, u64::MAX, 0)]),
            StakeAggregate {
                effective: 0,
                activating: STAKE,
                deactivating: 0,
                stake_accounts: 1,
            }
        );
    }

    #[test]
    fn deactivating_stake_is_still_reported_as_effective() {
        // The subset invariant: summing effective + deactivating would double-count this stake.
        assert_eq!(
            only(vec![stake_state(EPOCH - 1, EPOCH, 0)]),
            StakeAggregate {
                effective: STAKE,
                activating: 0,
                deactivating: STAKE,
                stake_accounts: 1,
            }
        );
    }

    #[test]
    fn a_fully_deactivated_vote_account_is_dropped() {
        assert!(aggregate(vec![stake_state(EPOCH - 2, EPOCH - 1, 0)]).is_empty());
    }

    #[test]
    fn a_locked_stake_account_is_skipped() {
        assert!(aggregate(vec![stake_state(EPOCH - 1, u64::MAX, EPOCH + 1)]).is_empty());
    }

    #[test]
    fn a_stake_account_without_delegation_is_skipped() {
        assert!(aggregate(vec![StakeStateV2::Initialized(Meta::default())]).is_empty());
    }

    #[test]
    fn accounts_of_one_vote_account_are_summed() {
        assert_eq!(
            only(vec![
                stake_state(EPOCH - 1, u64::MAX, 0),
                stake_state(EPOCH - 1, u64::MAX, 0),
                stake_state(EPOCH, u64::MAX, 0),
            ]),
            StakeAggregate {
                effective: 2 * STAKE,
                activating: STAKE,
                deactivating: 0,
                stake_accounts: 3,
            }
        );
    }
}
