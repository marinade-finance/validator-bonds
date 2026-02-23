use crate::{protected_events::ProtectedEvent, settlement_collection::SettlementMeta};
use log::debug;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct SettlementConfig {
    pub meta: SettlementMeta,
    #[serde(flatten)]
    pub kind: SettlementConfigKind,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(tag = "type")]
pub enum SettlementConfigKind {
    /// configuration for protected event [protected_events::ProtectedEvent::DowntimeRevenueImpact]
    DowntimeRevenueImpactSettlement {
        /// when settlement sum of claims is under this value, it is not generated
        min_settlement_lamports: u64,
        /// when downtime of the validator is lower to the grace period the settlement is not generated
        grace_downtime_bps: Option<u64>,
        /// range of bps that are covered by the settlement, usually differentiated by type of funder
        covered_range_bps: [u64; 2],
    },
    /// configuration for protected event [protected_events::ProtectedEvent::CommissionSamIncrease]
    CommissionSamIncreaseSettlement {
        /// when settlement sum of claims is under this value, it is not generated
        min_settlement_lamports: u64,
        /// when downtime of the validator is lower to the grace period the settlement is not generated
        grace_increase_bps: Option<u64>,
        /// range of bps that are covered by the settlement, usually differentiated by type of funder
        covered_range_bps: [u64; 2],
        /// if any of the commissions exceeds this value the penalty markup will be applied,
        /// base markup is applied otherwise
        extra_penalty_threshold_bps: u64,
        /// base settlement markup, in basis points, applied if EPR change is low
        base_markup_bps: u64,
        /// penalty settlement markup, in basis points, applied if EPR change is large
        penalty_markup_bps: u64,
    },
}

impl SettlementConfigKind {
    pub fn covered_range_bps(&self) -> &[u64; 2] {
        match self {
            SettlementConfigKind::DowntimeRevenueImpactSettlement {
                covered_range_bps, ..
            } => covered_range_bps,
            SettlementConfigKind::CommissionSamIncreaseSettlement {
                covered_range_bps, ..
            } => covered_range_bps,
        }
    }
    pub fn min_settlement_lamports(&self) -> u64 {
        *match self {
            SettlementConfigKind::DowntimeRevenueImpactSettlement {
                min_settlement_lamports,
                ..
            } => min_settlement_lamports,
            SettlementConfigKind::CommissionSamIncreaseSettlement {
                min_settlement_lamports,
                ..
            } => min_settlement_lamports,
        }
    }
}

pub fn build_protected_event_matcher(
    settlement_config: &SettlementConfig,
) -> Box<dyn Fn(&ProtectedEvent) -> bool + '_> {
    Box::new(move |protected_event: &ProtectedEvent| {
        match (&settlement_config.kind, protected_event) {
            (
                SettlementConfigKind::DowntimeRevenueImpactSettlement {
                    grace_downtime_bps, ..
                },
                ProtectedEvent::DowntimeRevenueImpact { epr_loss_bps, .. },
            ) => {
                if *epr_loss_bps > grace_downtime_bps.unwrap_or_default() {
                    true
                } else {
                    debug!(
                        "DowntimeRevenueImpact event vote account {} with epr_loss_bps: {} is under grace period: {}",
                        protected_event.vote_account(),
                        epr_loss_bps,
                        grace_downtime_bps.unwrap_or_default()
                    );
                    false
                }
            }
            (
                SettlementConfigKind::CommissionSamIncreaseSettlement {
                    grace_increase_bps, ..
                },
                ProtectedEvent::CommissionSamIncrease { epr_loss_bps, .. },
            ) => {
                if *epr_loss_bps > grace_increase_bps.unwrap_or_default() {
                    true
                } else {
                    debug!(
                        "CommissionSamIncrease event vote account {} with epr_loss_bps: {} is under grace period: {}",
                        protected_event.vote_account(),
                        epr_loss_bps,
                        grace_increase_bps.unwrap_or_default()
                    );
                    false
                }
            }
            _ => false,
        }
    })
}
