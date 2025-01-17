use merkle_tree::serde_serialize::{pubkey_string_conversion, vec_pubkey_string_conversion};
use serde::Deserialize;
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutStakeAccount {
    #[serde(with = "pubkey_string_conversion")]
    pub pubkey: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub validator: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub staker: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub withdrawer: Pubkey,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub active_stake: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub activating_stake: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub deactivating_stake: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub balance_lamports: u64,
    pub share: f64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub payout_lamports: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsrPayoutValidator {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub validator_rewards: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub stakers_rewards: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub percentile_diff: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub total_active_stake: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub total_active_institutional_stake: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstitutionalPsrPayout {
    pub epoch: u64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub slot: u64,
    pub percentile: f64,
    #[serde(deserialize_with = "deserialize_bigint")]
    pub percentile_rewards: u64,
    #[serde(with = "vec_pubkey_string_conversion")]
    pub institutional_staker_authorities: Vec<Pubkey>,
    pub validator_outliers: Vec<PsrPayoutValidator>,
    pub payouts: Vec<PayoutStakeAccount>,
}

/// The custom deserialize_bigint function handles parsing string representations of big integers.
/// As the TypeScript codebase uses strings to represent big integers, this function is necessary.
fn deserialize_bigint<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: String = serde::Deserialize::deserialize(deserializer)?;
    s.parse::<u64>().map_err(serde::de::Error::custom)
}
