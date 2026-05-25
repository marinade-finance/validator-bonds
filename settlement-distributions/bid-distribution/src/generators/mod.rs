pub mod bidding;
pub mod fee_optimizer;
pub mod psr_events;
pub mod sam_penalties;

#[cfg(test)]
mod tests;

use settlement_common::settlement_collection::{
    Settlement, SettlementClaim, SettlementFunder, SettlementReason,
};
use settlement_common::settlement_details::SettlementDetails;
use settlement_common::utils::sort_claims_deterministically;
use solana_sdk::pubkey::Pubkey;

pub fn add_to_settlement_collection(
    settlement_collections: &mut Vec<Settlement>,
    mut claims: Vec<SettlementClaim>,
    claims_amount: u64,
    reason: SettlementReason,
    vote_account: Pubkey,
    funder: SettlementFunder,
    details: Option<SettlementDetails>,
) {
    if !claims.is_empty() {
        sort_claims_deterministically(&mut claims);
        settlement_collections.push(Settlement {
            reason,
            funder,
            vote_account,
            claims_count: claims.len(),
            claims_amount,
            claims,
            details,
        });
    }
}
