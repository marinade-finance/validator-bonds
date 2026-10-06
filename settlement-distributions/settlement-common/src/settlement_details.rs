use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum SettlementDetails {
    Bidding(Box<BidSettlementDetails>),
    PriorityFee(PriorityFeeSettlementDetails),
    BidTooLowPenalty(BidTooLowPenaltyDetails),
    BlacklistPenalty(BlacklistPenaltyDetails),
    BondRiskFee(BondRiskFeeDetails),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BidSettlementDetails {
    pub total_active_stake: u64,
    pub total_marinade_active_stake: u64,
    pub total_marinade_redelegation_stake: u64,
    pub auction_effective_static_bid: String,
    pub marinade_stake_share: String,
    pub marinade_inflation_rewards: String,
    pub marinade_mev_rewards: String,
    pub marinade_block_rewards: String,
    pub staker_inflation_rewards: Option<String>,
    pub staker_mev_rewards: Option<String>,
    pub staker_block_rewards: Option<String>,
    pub staker_bid_rewards: Option<String>,
    pub total_marinade_stakers_rewards: String,
    pub settlement_claims: serde_json::Value,
    pub stakers_total_claim: u64,
    pub marinade_fee_claim: u64,
    pub dao_fee_claim: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PriorityFeeSettlementDetails {
    pub total_marinade_active_stake: u64,
    pub total_marinade_activating_stake: u64,
    pub activating_stake_pmpe: String,
    pub activating_bid_claim: String,
    pub activating_stakers_pool: u64,
    pub marinade_fee_claim: u64,
    pub dao_fee_claim: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidTooLowPenaltyDetails {
    pub total_marinade_active_stake: u64,
    pub effective_sam_marinade_active_stake: u64,
    pub bid_too_low_penalty_pmpe: String,
    pub bid_too_low_penalty_total_claim: String,
    pub distributor_bid_too_low_penalty_claim: u64,
    pub stakers_bid_too_low_penalty_claim: u64,
    pub dao_bid_too_low_penalty_claim: u64,
    pub marinade_bid_too_low_penalty_claim: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlacklistPenaltyDetails {
    pub total_marinade_active_stake: u64,
    pub effective_sam_marinade_active_stake: u64,
    pub blacklist_penalty_pmpe: String,
    pub blacklist_penalty_total_claim: String,
    pub stakers_blacklist_penalty_claim: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BondRiskFeeDetails {
    pub total_marinade_active_stake: u64,
    pub effective_sam_marinade_active_stake: u64,
    pub bond_risk_fee_sol: String,
    pub stakers_bond_risk_fee_claim: u64,
}
