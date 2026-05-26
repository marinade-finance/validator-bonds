pub mod bidding;
pub mod psr_events;
pub mod sam_penalties;

#[cfg(test)]
mod tests;

use settlement_common::settlement_collection::{
    Settlement, SettlementClaim, SettlementMeta, SettlementReason,
};
use settlement_common::utils::sort_claims_deterministically;
use solana_sdk::pubkey::Pubkey;

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
