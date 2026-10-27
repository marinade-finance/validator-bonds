use anyhow::{anyhow, ensure};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use std::sync::Arc;
use validator_bonds::constants::{MARINADE_LIQUID_PROGRAM_ID, MARINADE_LIQUID_STATE};
use validator_bonds::utils::{parse_state_stake_list_meta, stake_list_records};
use validator_bonds_common::stake_accounts::CollectedStakeAccounts;

pub struct MarinadeLiquidStakeList {
    pub state: Pubkey,
    pub stake_list: Pubkey,
    pub stake_accounts: HashSet<Pubkey>,
}

/// Loads the stake accounts listed in the Marinade liquid stake list.
pub async fn fetch_marinade_liquid_stake_list(
    rpc_client: Arc<RpcClient>,
) -> anyhow::Result<MarinadeLiquidStakeList> {
    let state = rpc_client.get_account(&MARINADE_LIQUID_STATE).await?;
    ensure!(
        state.owner == MARINADE_LIQUID_PROGRAM_ID,
        "Marinade liquid State {MARINADE_LIQUID_STATE} is owned by {}, expected {MARINADE_LIQUID_PROGRAM_ID}",
        state.owner
    );
    let meta = parse_state_stake_list_meta(&state.data)
        .map_err(|e| anyhow!("Cannot parse Marinade liquid State {MARINADE_LIQUID_STATE}: {e}"))?;
    let stake_list = rpc_client.get_account(&meta.account).await?;
    ensure!(
        stake_list.owner == MARINADE_LIQUID_PROGRAM_ID,
        "Marinade liquid stake list {} is owned by {}, expected {MARINADE_LIQUID_PROGRAM_ID}",
        meta.account,
        stake_list.owner
    );
    let stake_accounts = stake_list_records(&stake_list.data, &meta)
        .map_err(|e| {
            anyhow!(
                "Cannot parse Marinade liquid stake list {}: {e}",
                meta.account
            )
        })?
        .map(|record| Pubkey::new_from_array(record[..32].try_into().unwrap()))
        .collect();
    Ok(MarinadeLiquidStakeList {
        state: MARINADE_LIQUID_STATE,
        stake_list: meta.account,
        stake_accounts,
    })
}

/// Keeps only the stake accounts listed in the Marinade liquid stake list, preserving order.
pub fn filter_listed(
    stake_accounts: &CollectedStakeAccounts,
    listed: &HashSet<Pubkey>,
) -> CollectedStakeAccounts {
    stake_accounts
        .iter()
        .filter(|(pubkey, _, _)| listed.contains(pubkey))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_stake_interface::state::StakeStateV2;

    fn stake_accounts(count: usize) -> CollectedStakeAccounts {
        (0..count)
            .map(|i| (Pubkey::new_unique(), i as u64, StakeStateV2::Uninitialized))
            .collect()
    }

    #[test]
    fn filter_listed_keeps_members_in_order() {
        let accounts = stake_accounts(4);
        let listed: HashSet<Pubkey> = [accounts[3].0, accounts[1].0].into_iter().collect();
        let filtered = filter_listed(&accounts, &listed);
        assert_eq!(
            filtered
                .iter()
                .map(|(pubkey, _, _)| *pubkey)
                .collect::<Vec<_>>(),
            vec![accounts[1].0, accounts[3].0]
        );
    }

    #[test]
    fn filter_listed_empty_when_no_member() {
        let accounts = stake_accounts(3);
        let listed: HashSet<Pubkey> = [Pubkey::new_unique()].into_iter().collect();
        assert!(filter_listed(&accounts, &listed).is_empty());
    }
}
