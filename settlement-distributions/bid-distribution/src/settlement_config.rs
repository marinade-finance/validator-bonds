use bid_psr_distribution::settlement_collection::SettlementMeta;
use bid_psr_distribution::utils::stake_authority_filter;
use merkle_tree::serde_serialize::{option_vec_pubkey_string_conversion, pubkey_string_conversion};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;

/// Fee percentages calculated from basis points
#[derive(Debug, Clone, Copy)]
pub struct FeePercentages {
    /// Marinade distributor fee as a decimal percentage (e.g., 0.095 for 9.5%)
    pub marinade_distributor_fee: Decimal,
    /// DAO fee share as a decimal percentage (e.g., 0.05 for 5%)
    pub dao_fee_share: Decimal,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum SettlementConfig {
    Bidding {
        #[serde(with = "pubkey_string_conversion")]
        validator_bonds_config: Pubkey,
        meta: SettlementMeta,
        marinade_fee_bps: u64,
        #[serde(with = "pubkey_string_conversion")]
        marinade_withdraw_authority: Pubkey,
        #[serde(with = "pubkey_string_conversion")]
        marinade_stake_authority: Pubkey,
        dao_fee_split_share_bps: u64,
        #[serde(with = "pubkey_string_conversion")]
        dao_withdraw_authority: Pubkey,
        #[serde(with = "pubkey_string_conversion")]
        dao_stake_authority: Pubkey,
        #[serde(
            default,
            with = "option_vec_pubkey_string_conversion",
            skip_serializing_if = "Option::is_none"
        )]
        whitelist_stake_authorities: Option<Vec<Pubkey>>,
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
    pub fn dao_withdraw_authority(&self) -> &Pubkey {
        match self {
            SettlementConfig::Bidding {
                dao_withdraw_authority,
                ..
            } => dao_withdraw_authority,
        }
    }
    pub fn dao_stake_authority(&self) -> &Pubkey {
        match self {
            SettlementConfig::Bidding {
                dao_stake_authority,
                ..
            } => dao_stake_authority,
        }
    }
    pub fn dao_fee_split_share_bps(&self) -> &u64 {
        match self {
            SettlementConfig::Bidding {
                dao_fee_split_share_bps,
                ..
            } => dao_fee_split_share_bps,
        }
    }

    /// Converts basis points to decimal percentages for fee calculations
    pub fn fee_percentages(&self) -> FeePercentages {
        FeePercentages {
            marinade_distributor_fee: Decimal::from(*self.marinade_fee_bps())
                / Decimal::from(10_000),
            dao_fee_share: Decimal::from(*self.dao_fee_split_share_bps()) / Decimal::from(10_000),
        }
    }

    pub fn validator_bonds_config(&self) -> &Pubkey {
        match self {
            SettlementConfig::Bidding {
                validator_bonds_config,
                ..
            } => validator_bonds_config,
        }
    }

    pub fn whitelist_stake_authorities_filter(&self) -> Box<dyn Fn(&Pubkey) -> bool> {
        let stake_authorities = match self {
            SettlementConfig::Bidding {
                whitelist_stake_authorities,
                ..
            } => whitelist_stake_authorities,
        };
        stake_authority_filter(stake_authorities.clone())
    }
}
