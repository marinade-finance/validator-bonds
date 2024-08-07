use solana_sdk::pubkey::Pubkey;
use serde::Serializer;
use serde::Deserializer;
use {
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    std::fmt::Debug,
};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tvl {
    marinade_mnde_tvl_sol: f64,
    marinade_sam_tvl_sol: f64,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    scoring_id: String,
    tvl: Tvl,
    delegation_strategy_mnde_votes: f64,
    scoring_config: String,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ValidatorSamMeta {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub marinade_mnde_target_sol: f64,
    pub marinade_sam_target_sol: f64,
    pub rev_share: RevShare,
    pub stake_priority: u32,
    pub unstake_priority: u32,
    pub max_stake_wanted: f64,
    pub effective_bid: f64,
    pub constraints: String,
    pub metadata: Metadata,
    pub scoring_run_id: String,
    pub epoch: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RevShare {
    total_pmpe: f64,
    inflation_pmpe: f64,
    mev_pmpe: f64,
    bid_pmpe: f64,
    auction_effective_bid_pmpe: f64,
}