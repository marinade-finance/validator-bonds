use crate::constants::{MARINADE_CONFIG_ADDRESS, MARINADE_INSTITUTIONAL_CONFIG_ADDRESS};
use anchor_client::anchor_lang::prelude::Pubkey;
use anyhow::bail;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum BondType {
    #[serde(rename = "bidding")]
    Bidding,
    #[serde(rename = "institutional")]
    Institutional,
}

impl BondType {
    pub fn as_str(&self) -> &'static str {
        match self {
            BondType::Bidding => "bidding",
            BondType::Institutional => "institutional",
        }
    }

    pub fn parse_from_str(s: &str) -> anyhow::Result<Self> {
        match s.to_lowercase().as_str() {
            "bidding" => Ok(BondType::Bidding),
            "institutional" => Ok(BondType::Institutional),
            _ => bail!("Unknown bond type: {s}"),
        }
    }

    pub fn config_address(&self) -> Pubkey {
        match self {
            BondType::Bidding => Pubkey::from_str(MARINADE_CONFIG_ADDRESS)
                .unwrap_or_else(|_| panic!("not expected: failed to convert marinade config address to pubkey: {MARINADE_CONFIG_ADDRESS}")),
            BondType::Institutional => Pubkey::from_str(MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
                .unwrap_or_else(|_| panic!("not expected: failed to convert marinade institutional config address to pubkey: {MARINADE_INSTITUTIONAL_CONFIG_ADDRESS}")),
        }
    }
}

impl FromStr for BondType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        BondType::parse_from_str(s)
    }
}

impl fmt::Display for BondType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidatorBondRecord {
    pub pubkey: String,
    pub vote_account: String,
    pub authority: String,
    pub cpmpe: Decimal,
    pub max_stake_wanted: Decimal,
    pub epoch: u64,
    pub funded_amount: Decimal,
    pub effective_amount: Decimal,
    pub remaining_witdraw_request_amount: Decimal,
    pub remainining_settlement_claim_amount: Decimal,
    pub updated_at: DateTime<Utc>,
    pub bond_type: BondType,
    pub inflation_commission_bps: Option<i64>,
    pub mev_commission_bps: Option<i64>,
    pub block_commission_bps: Option<i64>,
}
