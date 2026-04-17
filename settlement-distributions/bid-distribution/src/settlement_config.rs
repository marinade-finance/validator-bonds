use anyhow::ensure;
use merkle_tree::serde_serialize::{option_vec_pubkey_string_conversion, pubkey_string_conversion};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::SettlementMeta;
use settlement_common::settlement_config::SettlementConfig as PsrSettlementConfig;
use settlement_common::utils::stake_authority_filter;
use solana_sdk::pubkey::Pubkey;

/// Fee percentages calculated from basis points
#[derive(Debug, Clone, Copy, Default)]
pub struct FeeRates {
    /// Marinade distributor fee as a decimal percentage (e.g., 0.095 for 9.5%)
    pub marinade_distributor_fee: Decimal,
    /// DAO fee share as a decimal percentage (e.g., 0.05 for 5%)
    pub dao_fee_share: Decimal,
    /// Minimum fee floor as a decimal percentage
    pub min_fee: Decimal,
}

/// Named fee authorities returned by [FeeConfig::fee_authorities]
pub struct FeeAuthorities {
    pub marinade_withdraw: Pubkey,
    pub marinade_stake: Pubkey,
    pub dao_withdraw: Pubkey,
    pub dao_stake: Pubkey,
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
    /// Minimum fee floor in basis points; fee is never reduced below this (default: 0)
    #[serde(default)]
    pub min_fee_bps: u64,
    /// target = SSI + apy_over_ssi_pmpe. Set to -10 (or lower) to effectively disable fee cap.
    #[serde(default)]
    pub apy_over_ssi_pmpe: Decimal,
}

impl FeeConfig {
    /// Validates that fee basis points are within valid range (0..=10000)
    pub fn validate(&self) -> anyhow::Result<()> {
        ensure!(
            self.marinade_fee_bps <= 10_000,
            "marinade_fee_bps {} exceeds maximum 10000 (100%)",
            self.marinade_fee_bps
        );
        ensure!(
            self.dao.fee_split_share_bps <= 10_000,
            "dao.fee_split_share_bps {} exceeds maximum 10000 (100%)",
            self.dao.fee_split_share_bps
        );
        ensure!(
            self.min_fee_bps <= 10_000,
            "min_fee_bps {} exceeds maximum 10000 (100%)",
            self.min_fee_bps
        );
        Ok(())
    }

    pub fn fee_authorities(&self) -> FeeAuthorities {
        FeeAuthorities {
            marinade_withdraw: self.marinade.withdraw_authority,
            marinade_stake: self.marinade.stake_authority,
            dao_withdraw: self.dao.withdraw_authority,
            dao_stake: self.dao.stake_authority,
        }
    }

    /// Converts basis points to decimal percentages for fee calculations
    pub fn fee_rates(&self) -> FeeRates {
        FeeRates {
            marinade_distributor_fee: Decimal::from(self.marinade_fee_bps) / Decimal::from(10_000),
            dao_fee_share: Decimal::from(self.dao.fee_split_share_bps) / Decimal::from(10_000),
            min_fee: Decimal::from(self.min_fee_bps) / Decimal::from(10_000),
        }
    }
}

/// SAM-specific settlement configuration
#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct SamSettlementConfig {
    pub meta: SettlementMeta,
    #[serde(flatten)]
    pub kind: SamSettlementKind,
}

/// SAM settlement type variants
#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(tag = "type")]
pub enum SamSettlementKind {
    /// SAM Bidding - rewards from auction participation
    Bidding,
    /// SAM BidTooLowPenalty - penalty for bidding too low
    BidTooLowPenalty,
    /// SAM BlacklistPenalty - penalty for blacklisted validators
    BlacklistPenalty,
    /// SAM BondRiskFee - fee for bond risk
    BondRiskFee,
}

/// Unified settlement configuration for all settlement types.
/// SAM variants are defined here; PSR variants are reused from settlement-common
/// to avoid field duplication and silent drift.
#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(untagged)]
pub enum SettlementConfig {
    Sam(SamSettlementConfig),
    Psr(PsrSettlementConfig),
}

impl SettlementConfig {
    pub fn meta(&self) -> &SettlementMeta {
        match self {
            SettlementConfig::Sam(sam) => &sam.meta,
            SettlementConfig::Psr(psr) => &psr.meta,
        }
    }

    pub fn to_psr_config(&self) -> Option<&PsrSettlementConfig> {
        match self {
            SettlementConfig::Psr(config) => Some(config),
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

    pub fn psr_settlements(&self) -> Vec<PsrSettlementConfig> {
        self.settlements
            .iter()
            .filter_map(|c| c.to_psr_config().cloned())
            .collect()
    }

    pub fn bidding_config(&self) -> Option<&SettlementConfig> {
        self.settlements.iter().find(|c| {
            matches!(
                c,
                SettlementConfig::Sam(SamSettlementConfig {
                    kind: SamSettlementKind::Bidding,
                    ..
                })
            )
        })
    }

    pub fn bid_too_low_penalty_config(&self) -> Option<&SettlementConfig> {
        self.settlements.iter().find(|c| {
            matches!(
                c,
                SettlementConfig::Sam(SamSettlementConfig {
                    kind: SamSettlementKind::BidTooLowPenalty,
                    ..
                })
            )
        })
    }

    pub fn blacklist_penalty_config(&self) -> Option<&SettlementConfig> {
        self.settlements.iter().find(|c| {
            matches!(
                c,
                SettlementConfig::Sam(SamSettlementConfig {
                    kind: SamSettlementKind::BlacklistPenalty,
                    ..
                })
            )
        })
    }

    pub fn bond_risk_fee_config(&self) -> Option<&SettlementConfig> {
        self.settlements.iter().find(|c| {
            matches!(
                c,
                SettlementConfig::Sam(SamSettlementConfig {
                    kind: SamSettlementKind::BondRiskFee,
                    ..
                })
            )
        })
    }
}
