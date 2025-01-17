use bid_psr_distribution::settlement_collection::SettlementMeta;
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;

#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum SettlementConfig {
    Bidding {
        meta: SettlementMeta,
        marinade_fee_bps: u64,
        marinade_withdraw_authority: Pubkey,
        marinade_stake_authority: Pubkey,
    },
}

impl SettlementConfig {
    pub fn meta(&self) -> &SettlementMeta {
        match self {
            SettlementConfig::Bidding { meta, .. } => meta,
        }
    }
    pub fn marinade_withdraw_authority(&self) -> &Pubkey {
        match self {
            SettlementConfig::Bidding {
                marinade_withdraw_authority,
                ..
            } => marinade_withdraw_authority,
        }
    }
    pub fn marinade_stake_authority(&self) -> &Pubkey {
        match self {
            SettlementConfig::Bidding {
                marinade_stake_authority,
                ..
            } => marinade_stake_authority,
        }
    }
    pub fn marinade_fee_bps(&self) -> &u64 {
        match self {
            SettlementConfig::Bidding {
                marinade_fee_bps, ..
            } => marinade_fee_bps,
        }
    }
}
