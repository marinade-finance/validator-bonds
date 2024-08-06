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
    #[serde(deserialize_with = "string_to_f64", serialize_with = "f64_to_string")]
    pub marinade_mnde_target_sol: f64,
    #[serde(deserialize_with = "string_to_f64", serialize_with = "f64_to_string")]
    pub marinade_sam_target_sol: f64,
    pub rev_share: String,
    pub stake_priority: u32,
    pub unstake_priority: u32,
    #[serde(deserialize_with = "string_to_f64", serialize_with = "f64_to_string")]
    pub max_stake_wanted: f64,
    #[serde(deserialize_with = "string_to_f64", serialize_with = "f64_to_string")]
    pub effective_bid: f64,
    pub constraints: String,
    pub metadata: Metadata,
    pub scoring_run_id: String,
    pub epoch: u32,
}

fn string_to_f64<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    s.parse::<f64>().map_err(serde::de::Error::custom)
}

fn f64_to_string<S>(x: &f64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&x.to_string())
}