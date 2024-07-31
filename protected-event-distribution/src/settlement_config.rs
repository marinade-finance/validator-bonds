use crate::{protected_events::ProtectedEvent, settlement_claims::SettlementMeta};
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;

#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum SettlementConfig {
    /// configuration for protected event [protected_events::ProtectedEvent::DowntimeRevenueImpact]
    DowntimeRevenueImpactSettlement {
        meta: SettlementMeta,
        /// when settlement sum of claims is under this value, it is not generated
        min_settlement_lamports: u64,
        /// when downtime of the validator is lower to the grace period the settlement is not generated
        grace_downtime_bps: Option<u64>,
        /// range of bps that are covered by the settlement, usually differentiated by type of funder
        covered_range_bps: [u64; 2],
    },
    /// configuration for protected event [protected_events::ProtectedEvent::CommissionIncrease]
    CommissionIncreaseSettlement {
        meta: SettlementMeta,
        min_settlement_lamports: u64,
        grace_increase_bps: Option<u64>,
        covered_range_bps: [u64; 2],
    },
}

impl SettlementConfig {
    pub fn meta(&self) -> &SettlementMeta {
        match self {
            SettlementConfig::DowntimeRevenueImpactSettlement { meta, .. } => meta,
            SettlementConfig::CommissionIncreaseSettlement { meta, .. } => meta,
        }
    }
    pub fn covered_range_bps(&self) -> &[u64; 2] {
        match self {
            SettlementConfig::DowntimeRevenueImpactSettlement {
                covered_range_bps, ..
            } => covered_range_bps,
            SettlementConfig::CommissionIncreaseSettlement {
                covered_range_bps, ..
            } => covered_range_bps,
        }
    }
    pub fn min_settlement_lamports(&self) -> u64 {
        *match self {
            SettlementConfig::DowntimeRevenueImpactSettlement {
                min_settlement_lamports,
                ..
            } => min_settlement_lamports,
            SettlementConfig::CommissionIncreaseSettlement {
                min_settlement_lamports,
                ..
            } => min_settlement_lamports,
        }
    }
}

pub fn build_protected_event_matcher(
    settlement_config: &SettlementConfig,
) -> Box<dyn Fn(&ProtectedEvent) -> bool + '_> {
    Box::new(
        move |protected_event: &ProtectedEvent| match (settlement_config, protected_event) {
            (
                SettlementConfig::DowntimeRevenueImpactSettlement {
                    grace_downtime_bps, ..
                },
                ProtectedEvent::DowntimeRevenueImpact { epr_loss_bps, .. },
            ) => *epr_loss_bps > grace_downtime_bps.unwrap_or_default(),
            (
                SettlementConfig::CommissionIncreaseSettlement {
                    grace_increase_bps, ..
                },
                ProtectedEvent::CommissionIncrease { epr_loss_bps, .. },
            ) => *epr_loss_bps > grace_increase_bps.unwrap_or_default(),
            _ => false,
        },
    )
}

pub fn stake_authorities_filter(whitelist: HashSet<Pubkey>) -> Box<dyn Fn(&Pubkey) -> bool> {
    Box::new(move |pubkey| whitelist.contains(pubkey))
}

pub fn no_filter() -> Box<dyn Fn(&Pubkey) -> bool> {
    Box::new(|_| true)
}
