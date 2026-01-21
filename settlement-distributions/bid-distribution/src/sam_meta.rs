use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use {
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    std::fmt::Debug,
};

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tvl {
    pub(crate) marinade_mnde_tvl_sol: Decimal,
    pub(crate) marinade_sam_tvl_sol: Decimal,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SamMetadata {
    pub(crate) scoring_id: String,
    pub(crate) tvl: Tvl,
    pub(crate) delegation_strategy_mnde_votes: Decimal,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ValidatorSamMeta {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub marinade_mnde_target_sol: Decimal,
    pub marinade_sam_target_sol: Decimal,
    pub rev_share: RevShare,
    pub stake_priority: u32,
    pub unstake_priority: u32,
    pub max_stake_wanted: Decimal,
    // ds-scoring passes revShare.auctionEffectiveBid here as effective_bid
    pub effective_bid: Decimal,
    pub constraints: String,
    pub metadata: SamMetadata,
    pub scoring_run_id: u32,
    pub epoch: u32,
    pub values: Option<AuctionValidatorValues>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RevShare {
    pub total_pmpe: Decimal,
    pub inflation_pmpe: Decimal,
    pub mev_pmpe: Decimal,
    pub bid_pmpe: Decimal,
    pub auction_effective_bid_pmpe: Decimal,
    pub bid_too_low_penalty_pmpe: Decimal,
    pub blacklist_penalty_pmpe: Decimal,
    pub eff_participating_bid_pmpe: Decimal,
    pub expected_max_eff_bid_pmpe: Decimal,

    pub block_pmpe: Option<Decimal>,
    pub onchain_distributed_pmpe: Option<Decimal>,
    pub bond_obligation_pmpe: Option<Decimal>,
    pub auction_effective_static_bid_pmpe: Option<Decimal>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuctionValidatorValues {
    pub bond_balance_sol: Option<Decimal>,
    pub marinade_activated_stake_sol: Decimal,
    pub bond_risk_fee_sol: Decimal,
    pub paid_undelegation_sol: Decimal,
    pub sam_blacklisted: bool,
    pub commissions: Option<CommissionDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommissionDetails {
    pub inflation_commission_dec: Decimal,
    pub mev_commission_dec: Decimal,
    pub block_rewards_commission_dec: Decimal,
    pub inflation_commission_onchain_dec: Decimal,
    pub inflation_commission_in_bond_dec: Option<Decimal>,
    pub inflation_commission_override_dec: Option<Decimal>,
    pub mev_commission_onchain_dec: Option<Decimal>,
    pub mev_commission_in_bond_dec: Option<Decimal>,
    pub mev_commission_override_dec: Option<Decimal>,
    pub block_rewards_commission_in_bond_dec: Option<Decimal>,
    pub block_rewards_commission_override_dec: Option<Decimal>,
}
