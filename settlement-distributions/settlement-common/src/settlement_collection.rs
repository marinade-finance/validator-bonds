#![allow(clippy::type_complexity)]
use crate::protected_events::ProtectedEvent;
use solana_sdk::pubkey::Pubkey;
use std::fmt::Display;

use {
    merkle_tree::serde_serialize::{map_pubkey_string_conversion, pubkey_string_conversion},
    serde::{Deserialize, Serialize},
    std::collections::HashMap,
};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SettlementClaim {
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    /// stake account pubkey -> active_delegation_lamports
    #[serde(with = "map_pubkey_string_conversion")]
    pub stake_accounts: HashMap<Pubkey, u64>,
    pub active_stake: u64,
    pub claim_amount: u64,
}

#[derive(Clone, Deserialize, Serialize, Debug, utoipa::ToSchema)]
pub enum SettlementReason {
    ProtectedEvent(Box<ProtectedEvent>),
    Bidding,
    BidTooLowPenalty,
    BlacklistPenalty,
    InstitutionalPayout,
}

impl Display for SettlementReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettlementReason::ProtectedEvent(_) => write!(f, "ProtectedEvent"),
            SettlementReason::Bidding => write!(f, "Bidding"),
            SettlementReason::BidTooLowPenalty => write!(f, "BidTooLowPenalty"),
            SettlementReason::BlacklistPenalty => write!(f, "BlacklistPenalty"),
            SettlementReason::InstitutionalPayout => {
                write!(f, "InstitutionalPayout")
            }
        }
    }
}

#[derive(
    Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash, Ord, PartialOrd, utoipa::ToSchema,
)]
pub enum SettlementFunder {
    ValidatorBond,
    Marinade,
}

#[derive(Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash, utoipa::ToSchema)]
pub struct SettlementMeta {
    pub funder: SettlementFunder,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct Settlement {
    pub reason: SettlementReason,
    pub meta: SettlementMeta,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub claims_count: usize,
    pub claims_amount: u64,
    pub claims: Vec<SettlementClaim>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct SettlementCollection {
    pub slot: u64,
    pub epoch: u64,
    pub settlements: Vec<Settlement>,
}
