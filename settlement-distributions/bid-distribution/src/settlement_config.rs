use merkle_tree::serde_serialize::{option_vec_pubkey_string_conversion, pubkey_string_conversion};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::SettlementMeta;
use settlement_common::settlement_config::SettlementConfig as PsrSettlementConfig;
use settlement_common::utils::stake_authority_filter;
use solana_sdk::pubkey::Pubkey;

/// Fee percentages calculated from basis points
#[derive(Debug, Clone, Copy)]
pub struct FeePercentages {
    /// Marinade distributor fee as a decimal percentage (e.g., 0.095 for 9.5%)
    pub marinade_distributor_fee: Decimal,
    /// DAO fee share as a decimal percentage (e.g., 0.05 for 5%)
    pub dao_fee_share: Decimal,
}

impl Default for FeePercentages {
    fn default() -> Self {
        Self {
            marinade_distributor_fee: Decimal::ZERO,
            dao_fee_share: Decimal::ZERO,
        }
    }
}

/// Authority configuration for stake/withdraw authorities
#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct AuthorityConfig {
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
}

/// DAO fee configuration including fee split share and authorities
#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct DaoConfig {
    pub fee_split_share_bps: u64,
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
}

/// Shared fee configuration for SAM settlement types (Bidding, BidTooLowPenalty)
#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct FeeConfig {
    pub marinade_fee_bps: u64,
    pub marinade: AuthorityConfig,
    pub dao: DaoConfig,
}

impl FeeConfig {
    /// Returns fee authorities as (marinade_withdraw, marinade_stake, dao_withdraw, dao_stake)
    pub fn fee_authorities(&self) -> (&Pubkey, &Pubkey, &Pubkey, &Pubkey) {
        (
            &self.marinade.withdraw_authority,
            &self.marinade.stake_authority,
            &self.dao.withdraw_authority,
            &self.dao.stake_authority,
        )
    }

    /// Converts basis points to decimal percentages for fee calculations
    pub fn fee_percentages(&self) -> FeePercentages {
        FeePercentages {
            marinade_distributor_fee: Decimal::from(self.marinade_fee_bps) / Decimal::from(10_000),
            dao_fee_share: Decimal::from(self.dao.fee_split_share_bps) / Decimal::from(10_000),
        }
    }
}

/// Unified settlement configuration for all settlement types.
/// Each variant represents a different type of settlement that can be generated.
#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum SettlementConfig {
    /// SAM Bidding - rewards from auction participation
    Bidding { meta: SettlementMeta },

    /// SAM BidTooLowPenalty - penalty for bidding too low
    BidTooLowPenalty { meta: SettlementMeta },

    /// SAM BlacklistPenalty - penalty for blacklisted validators
    BlacklistPenalty { meta: SettlementMeta },

    /// SAM BondRiskFee - fee for bond risk
    BondRiskFee { meta: SettlementMeta },

    /// PSR DowntimeRevenueImpact - compensation for downtime
    DowntimeRevenueImpactSettlement {
        meta: SettlementMeta,
        min_settlement_lamports: u64,
        grace_downtime_bps: Option<u64>,
        covered_range_bps: [u64; 2],
    },

    /// PSR CommissionSamIncrease - compensation for commission increase
    CommissionSamIncreaseSettlement {
        meta: SettlementMeta,
        min_settlement_lamports: u64,
        grace_increase_bps: Option<u64>,
        covered_range_bps: [u64; 2],
        extra_penalty_threshold_bps: u64,
        base_markup_bps: u64,
        penalty_markup_bps: u64,
    },
}

impl SettlementConfig {
    pub fn meta(&self) -> &SettlementMeta {
        match self {
            SettlementConfig::Bidding { meta } => meta,
            SettlementConfig::BidTooLowPenalty { meta } => meta,
            SettlementConfig::BlacklistPenalty { meta } => meta,
            SettlementConfig::BondRiskFee { meta } => meta,
            SettlementConfig::DowntimeRevenueImpactSettlement { meta, .. } => meta,
            SettlementConfig::CommissionSamIncreaseSettlement { meta, .. } => meta,
        }
    }

    /// Checks if this is a SAM settlement type (Bidding, BidTooLowPenalty, BlacklistPenalty)
    pub fn is_sam_settlement(&self) -> bool {
        matches!(
            self,
            SettlementConfig::Bidding { .. }
                | SettlementConfig::BidTooLowPenalty { .. }
                | SettlementConfig::BlacklistPenalty { .. }
                | SettlementConfig::BondRiskFee { .. }
        )
    }

    /// Checks if this is a PSR settlement type (DowntimeRevenueImpact, CommissionSamIncrease)
    pub fn is_psr_settlement(&self) -> bool {
        matches!(
            self,
            SettlementConfig::DowntimeRevenueImpactSettlement { .. }
                | SettlementConfig::CommissionSamIncreaseSettlement { .. }
        )
    }

    /// Converts to PSR settlement config for use with PSR settlement generator.
    /// Only valid for PSR settlement types.
    pub fn to_psr_config(&self) -> Option<PsrSettlementConfig> {
        match self {
            SettlementConfig::DowntimeRevenueImpactSettlement {
                meta,
                min_settlement_lamports,
                grace_downtime_bps,
                covered_range_bps,
            } => Some(PsrSettlementConfig::DowntimeRevenueImpactSettlement {
                meta: meta.clone(),
                min_settlement_lamports: *min_settlement_lamports,
                grace_downtime_bps: *grace_downtime_bps,
                covered_range_bps: *covered_range_bps,
            }),
            SettlementConfig::CommissionSamIncreaseSettlement {
                meta,
                min_settlement_lamports,
                grace_increase_bps,
                covered_range_bps,
                extra_penalty_threshold_bps,
                base_markup_bps,
                penalty_markup_bps,
            } => Some(PsrSettlementConfig::CommissionSamIncreaseSettlement {
                meta: meta.clone(),
                min_settlement_lamports: *min_settlement_lamports,
                grace_increase_bps: *grace_increase_bps,
                covered_range_bps: *covered_range_bps,
                extra_penalty_threshold_bps: *extra_penalty_threshold_bps,
                base_markup_bps: *base_markup_bps,
                penalty_markup_bps: *penalty_markup_bps,
            }),
            _ => None,
        }
    }
}

/// Top-level configuration for bid distribution.
/// Contains fee config, whitelist and list of settlement configurations.
#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct BidDistributionConfig {
    pub fee_config: FeeConfig,
    #[serde(
        default,
        with = "option_vec_pubkey_string_conversion",
        skip_serializing_if = "Option::is_none"
    )]
    pub whitelist_stake_authorities: Option<Vec<Pubkey>>,
    pub settlements: Vec<SettlementConfig>,
}

impl BidDistributionConfig {
    pub fn whitelist_stake_authorities_filter(&self) -> Box<dyn Fn(&Pubkey) -> bool> {
        stake_authority_filter(self.whitelist_stake_authorities.clone())
    }

    /// Returns SAM settlement configs (Bidding, BidTooLowPenalty, BlacklistPenalty)
    pub fn sam_settlements(&self) -> Vec<&SettlementConfig> {
        self.settlements
            .iter()
            .filter(|c| c.is_sam_settlement())
            .collect()
    }

    /// Returns PSR settlement configs converted to PsrSettlementConfig
    pub fn psr_settlements(&self) -> Vec<PsrSettlementConfig> {
        self.settlements
            .iter()
            .filter_map(|c| c.to_psr_config())
            .collect()
    }

    /// Find the Bidding config (for SAM bid settlements)
    pub fn bidding_config(&self) -> Option<&SettlementConfig> {
        self.settlements
            .iter()
            .find(|c| matches!(c, SettlementConfig::Bidding { .. }))
    }

    /// Find the BidTooLowPenalty config (for SAM penalty settlements)
    pub fn bid_too_low_penalty_config(&self) -> Option<&SettlementConfig> {
        self.settlements
            .iter()
            .find(|c| matches!(c, SettlementConfig::BidTooLowPenalty { .. }))
    }

    /// Find the BlacklistPenalty config (for SAM penalty settlements)
    pub fn blacklist_penalty_config(&self) -> Option<&SettlementConfig> {
        self.settlements
            .iter()
            .find(|c| matches!(c, SettlementConfig::BlacklistPenalty { .. }))
    }

    /// Find the BondRiskFee config (for SAM bond risk fee settlements)
    pub fn bond_risk_fee_config(&self) -> Option<&SettlementConfig> {
        self.settlements
            .iter()
            .find(|c| matches!(c, SettlementConfig::BondRiskFee { .. }))
    }
}
