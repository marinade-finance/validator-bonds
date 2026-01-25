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

/// The output Settlements data is updated with stake accounts owned by Marinade and DAO
pub fn get_fee_deposit_stake_accounts(
    stake_meta_index: &StakeMetaIndex,
    fee_config: &FeeConfig,
) -> (HashMap<Pubkey, u64>, HashMap<Pubkey, u64>) {
    let (marinade_withdraw, marinade_stake, dao_withdraw, dao_stake) = fee_config.fee_authorities();

    let marinade_fee_deposit_stake_accounts: HashMap<_, _> = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| {
            x.withdraw_authority.eq(marinade_withdraw) && x.stake_authority.eq(marinade_stake)
        })
        .iter()
        .map(|s| (s.pubkey, s.active_delegation_lamports))
        .collect();
    let dao_fee_deposit_stake_accounts: HashMap<_, _> = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| x.withdraw_authority.eq(dao_withdraw) && x.stake_authority.eq(dao_stake))
        .iter()
        .map(|s| (s.pubkey, s.active_delegation_lamports))
        .collect();

    (
        marinade_fee_deposit_stake_accounts,
        dao_fee_deposit_stake_accounts,
    )
}

/// Adds a settlement to the collection if any claims are present, placing it in a deterministic order
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
