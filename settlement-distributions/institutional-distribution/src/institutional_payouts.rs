use crate::custom_deserialize::{deserialize_bigint, deserialize_large_decimal};
use merkle_tree::serde_serialize::{pubkey_string_conversion, vec_pubkey_string_conversion};
use rust_decimal::Decimal;
use serde::Deserialize;
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatorPayoutInfo {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,

    pub is_institutional: bool,

    pub payout_type: String,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub distributor_fee_lamports: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub validator_fee_lamports: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub distribute_to_stakers_lamports: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub psr_fee_lamports: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Validator {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,

    pub staked_amounts: StakedAmounts,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub validator_rewards: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub stakers_rewards: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub total_rewards: u64,

    #[serde(deserialize_with = "deserialize_large_decimal")]
    pub apy: Decimal,

    pub institutional_staked_ratio: Decimal,

    #[serde(deserialize_with = "deserialize_large_decimal")]
    pub apy_percentile_diff: Decimal,

    pub commission: u32,

    pub mev_commission: Option<u32>,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub credits: u64,

    #[serde(deserialize_with = "deserialize_large_decimal")]
    pub uptime: Decimal,

    #[serde(deserialize_with = "deserialize_large_decimal")]
    pub uptime_deviation_bps: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StakeAccount {
    #[serde(with = "pubkey_string_conversion")]
    pub address: Pubkey,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub effective_stake: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StakedAmounts {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub total_active: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub total_activating: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub total_deactivating: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub institutional_active: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub institutional_activating: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub institutional_deactivating: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutStaker {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,

    pub stake_accounts: Vec<StakeAccount>,

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

    pub share_institutional: Decimal,

    pub share_deactivation: Decimal,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub payout_lamports: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutDistributor {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub payout_lamports: u64,

    pub stake_accounts: Vec<StakeAccount>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsrPercentileData {
    pub psr_percentile: u16,

    #[serde(deserialize_with = "deserialize_large_decimal")]
    pub psr_percentile_apy: Decimal,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub psr_percentile_effective_stake: u64,

    pub psr_grace_downtime_bps: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstitutionalPayout {
    pub epoch: u64,

    #[serde(deserialize_with = "deserialize_bigint")]
    pub slot: u64,

    pub config: ConfigDto,

    pub institutional_validators: InstitutionalValidatorsDto,

    pub psr_percentile_data: PsrPercentileData,

    #[serde(with = "vec_pubkey_string_conversion")]
    pub institutional_staker_authorities: Vec<Pubkey>,

    pub validator_max_fee_bps: i32,

    pub distributor_fee_bps: i32,

    pub payout_stakers: Vec<PayoutStaker>,

    pub payout_distributors: Vec<PayoutDistributor>,

    pub validators: Vec<Validator>,

    pub validator_payout_info: Vec<ValidatorPayoutInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDto {
    #[serde(with = "vec_pubkey_string_conversion")]
    pub staker_authority_filter: Vec<Pubkey>,

    pub psr_percentile: u16,

    pub psr_grace_downtime_bps: u32,

    pub validator_max_fee_bps: i32,

    pub distributor_fee_bps: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstitutionalValidatorDto {
    pub name: String,

    #[serde(rename = "vote_pubkey")]
    #[serde(with = "pubkey_string_conversion")]
    pub vote_pubkey: Pubkey,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstitutionalValidatorsDto {
    pub validators: Vec<InstitutionalValidatorDto>,
}
