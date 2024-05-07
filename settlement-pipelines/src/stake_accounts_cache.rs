use anyhow::anyhow;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::sync::Arc;
use validator_bonds_common::stake_accounts::{collect_stake_accounts, CollectedStakeAccounts};

#[derive(PartialEq, Eq, Hash, Clone)]
struct StakeWithdrawAuthorityPair<'a> {
    pub withdraw_authority: &'a Pubkey,
    pub stake_authority: &'a Pubkey,
}

impl<'a> StakeWithdrawAuthorityPair<'a> {
    pub fn new(withdraw_authority: &'a Pubkey, stake_authority: &'a Pubkey) -> Self {
        Self {
            withdraw_authority,
            stake_authority,
        }
    }
}

#[derive(Default)]
pub struct StakeAccountsCache<'a> {
    cache: HashMap<StakeWithdrawAuthorityPair<'a>, CollectedStakeAccounts>,
}

impl<'a> StakeAccountsCache<'a> {
    pub async fn get(
        &mut self,
        rpc_client: Arc<RpcClient>,
        withdraw_authority: &'a Pubkey,
        stake_authority: &'a Pubkey,
    ) -> anyhow::Result<&CollectedStakeAccounts> {
        let stake_withdraw_pair =
            StakeWithdrawAuthorityPair::new(withdraw_authority, stake_authority);
        // when the cache contains the stake account, we can use it
        if self.cache.contains_key(&stake_withdraw_pair) {
            Ok(self
                .cache
                .get(&stake_withdraw_pair)
                .expect("Cache 'contains_key' succeeded, but 'get' failed"))
        } else {
            // not fetched yet, let's fetch
            let stake_accounts = collect_stake_accounts(
                rpc_client.clone(),
                Some(withdraw_authority),
                Some(stake_authority),
            ).await.map_or_else(|e| {
                let err_msg = format!(
                    "Failed to fetch and deserialize stake accounts for claiming of staker/withdraw authorities {}/{}: {:?}",
                    stake_authority,
                    withdraw_authority,
                    e
                );
                Err(anyhow!("{}", err_msg))
            }, Ok)?;

            self.cache
                .insert(stake_withdraw_pair.clone(), stake_accounts);
            Ok(self
                .cache
                .get(&stake_withdraw_pair)
                .expect("Cache 'insert' succeeded, but 'get' failed"))
        }
    }
}
