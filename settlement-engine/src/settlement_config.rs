use crate::{protected_events::ProtectedEvent, settlement_claims::SettlementMeta};
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;

#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum SettlementConfig {
    LowCreditsSettlement {
        meta: SettlementMeta,
        min_settlement_lamports: u64,
        grace_low_credits_bps: Option<u64>,
        covered_range_bps: [u64; 2],
    },
    CommissionIncreaseSettlement {
        meta: SettlementMeta,
        min_settlement_lamports: u64,
        grace_commission_increase: u8,
        covered_range_bps: [u64; 2],
    },
}

impl SettlementConfig {
    pub fn meta(&self) -> &SettlementMeta {
        match self {
            SettlementConfig::LowCreditsSettlement { meta, .. } => meta,
            SettlementConfig::CommissionIncreaseSettlement { meta, .. } => meta,
        }
    }
    pub fn covered_range_bps(&self) -> &[u64; 2] {
        match self {
            SettlementConfig::LowCreditsSettlement {
                covered_range_bps, ..
            } => covered_range_bps,
            SettlementConfig::CommissionIncreaseSettlement {
                covered_range_bps, ..
            } => covered_range_bps,
        }
    }
    pub fn min_settlement_lamports(&self) -> u64 {
        *match self {
            SettlementConfig::LowCreditsSettlement {
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
                SettlementConfig::LowCreditsSettlement {
                    grace_low_credits_bps,
                    ..
                },
                ProtectedEvent::LowCredits { epr_loss_bps, .. },
            ) => *epr_loss_bps > grace_low_credits_bps.unwrap_or_default(),
            (
                SettlementConfig::CommissionIncreaseSettlement {
                    grace_commission_increase,
                    ..
                },
                ProtectedEvent::CommissionIncrease {
                    previous_commission,
                    current_commission,
                    ..
                },
            ) => {
                current_commission.saturating_sub(*previous_commission) > *grace_commission_increase
            }
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
