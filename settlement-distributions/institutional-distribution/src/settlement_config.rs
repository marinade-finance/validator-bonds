use merkle_tree::serde_serialize::pubkey_string_conversion;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::{
    SettlementFunder, SettlementMeta, SettlementReason,
};
use solana_sdk::pubkey::Pubkey;

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct InstitutionalDistributionConfig {
    pub settlement_meta: SettlementMeta,
    pub settlement_reason: SettlementReason,
    #[serde(with = "pubkey_string_conversion")]
    pub marinade_withdraw_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub marinade_stake_authority: Pubkey,
    pub dao_fee_split_share_bps: u64,
    #[serde(with = "pubkey_string_conversion")]
    pub dao_withdraw_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub dao_stake_authority: Pubkey,
    pub snapshot_slot: u64,
}

pub struct ConfigParams {
    pub marinade_withdraw_authority: Pubkey,
    pub marinade_stake_authority: Pubkey,
    pub dao_fee_split_share_bps: u64,
    pub dao_withdraw_authority: Pubkey,
    pub dao_stake_authority: Pubkey,
    pub snapshot_slot: u64,
}

impl InstitutionalDistributionConfig {
    pub fn new(params: ConfigParams) -> Self {
        InstitutionalDistributionConfig {
            settlement_meta: SettlementMeta {
                funder: SettlementFunder::ValidatorBond,
            },
            settlement_reason: SettlementReason::InstitutionalPayout,
            marinade_withdraw_authority: params.marinade_withdraw_authority,
            marinade_stake_authority: params.marinade_stake_authority,
            dao_fee_split_share_bps: params.dao_fee_split_share_bps,
            dao_withdraw_authority: params.dao_withdraw_authority,
            dao_stake_authority: params.dao_stake_authority,
            snapshot_slot: params.snapshot_slot,
        }
    }
}
