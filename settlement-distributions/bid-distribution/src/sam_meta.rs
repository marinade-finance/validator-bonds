use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use {
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    std::fmt::Debug,
};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tvl {
    marinade_mnde_tvl_sol: Decimal,
    marinade_sam_tvl_sol: Decimal,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SamMetadata {
    scoring_id: String,
    tvl: Tvl,
    delegation_strategy_mnde_votes: Decimal,
    scoring_config: String,
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
    pub effective_bid: Decimal,
    pub constraints: String,
    pub metadata: SamMetadata,
    pub scoring_run_id: u32,
    pub epoch: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevShare {
    total_pmpe: Decimal,
    inflation_pmpe: Decimal,
    mev_pmpe: Decimal,
    bid_pmpe: Decimal,
    auction_effective_bid_pmpe: Decimal,
}
