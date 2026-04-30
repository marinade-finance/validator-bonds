pub mod bidding;
pub mod psr_events;
pub mod sam_penalties;

#[cfg(test)]
mod tests;

use settlement_common::settlement_collection::{
    Settlement, SettlementClaim, SettlementMeta, SettlementReason,
};
use settlement_common::stake_meta_index::StakeMetaIndex;
use settlement_common::utils::sort_claims_deterministically;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

use crate::settlement_config::FeeConfig;

/// Stake accounts owned by Marinade and DAO that fee claims in the output
/// settlements are routed to.
pub struct FeeDepositStakeAccounts {
    pub marinade_active: HashMap<Pubkey, u64>,
    pub marinade_activating: HashMap<Pubkey, u64>,
    pub dao_active: HashMap<Pubkey, u64>,
    pub dao_activating: HashMap<Pubkey, u64>,
}

pub fn get_fee_deposit_stake_accounts(
    stake_meta_index: &StakeMetaIndex,
    fee_config: &FeeConfig,
) -> FeeDepositStakeAccounts {
    let authorities = fee_config.fee_authorities();

    let marinade_meta = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| {
            x.withdraw_authority.eq(&authorities.marinade_withdraw)
                && x.stake_authority.eq(&authorities.marinade_stake)
        });
    let dao_meta = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| {
            x.withdraw_authority.eq(&authorities.dao_withdraw)
                && x.stake_authority.eq(&authorities.dao_stake)
        });

    FeeDepositStakeAccounts {
        marinade_active: marinade_meta
            .iter()
            .filter(|s| s.active_delegation_lamports > 0)
            .map(|s| (s.pubkey, s.active_delegation_lamports))
            .collect(),
        marinade_activating: marinade_meta
            .iter()
            .filter(|s| s.activating_delegation_lamports > 0)
            .map(|s| (s.pubkey, s.activating_delegation_lamports))
            .collect(),
        dao_active: dao_meta
            .iter()
            .filter(|s| s.active_delegation_lamports > 0)
            .map(|s| (s.pubkey, s.active_delegation_lamports))
            .collect(),
        dao_activating: dao_meta
            .iter()
            .filter(|s| s.activating_delegation_lamports > 0)
            .map(|s| (s.pubkey, s.activating_delegation_lamports))
            .collect(),
    }
}

pub fn add_to_settlement_collection(
    settlement_collections: &mut Vec<Settlement>,
    mut claims: Vec<SettlementClaim>,
    claims_amount: u64,
    reason: SettlementReason,
    vote_account: Pubkey,
    settlement_meta: &SettlementMeta,
    details: Option<serde_json::Value>,
) {
    if !claims.is_empty() {
        sort_claims_deterministically(&mut claims);
        settlement_collections.push(Settlement {
            reason,
            meta: settlement_meta.clone(),
            vote_account,
            claims_count: claims.len(),
            claims_amount,
            claims,
            details,
        });
    }
}
