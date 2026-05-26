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
    pub claim_amount: u64,
    #[serde(flatten)]
    pub detail: ClaimDetail,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "kind")]
pub enum ClaimDetail {
    StakerPayout {
        active_stake: u64,
        activating_stake: u64,
        #[serde(with = "map_pubkey_string_conversion")]
        stake_accounts: HashMap<Pubkey, u64>,
    },
    FeeDeposit,
}

impl SettlementClaim {
    pub fn staker_payout(
        withdraw_authority: Pubkey,
        stake_authority: Pubkey,
        active_stake: u64,
        activating_stake: u64,
        claim_amount: u64,
        stake_accounts: HashMap<Pubkey, u64>,
    ) -> Self {
        Self {
            withdraw_authority,
            stake_authority,
            claim_amount,
            detail: ClaimDetail::StakerPayout {
                active_stake,
                activating_stake,
                stake_accounts,
            },
        }
    }

    pub fn fee_deposit(
        withdraw_authority: Pubkey,
        stake_authority: Pubkey,
        claim_amount: u64,
    ) -> Self {
        Self {
            withdraw_authority,
            stake_authority,
            claim_amount,
            detail: ClaimDetail::FeeDeposit,
        }
    }

    pub fn stake_accounts(&self) -> Option<&HashMap<Pubkey, u64>> {
        match &self.detail {
            ClaimDetail::StakerPayout { stake_accounts, .. } => Some(stake_accounts),
            ClaimDetail::FeeDeposit => None,
        }
    }

    pub fn active_stake(&self) -> Option<u64> {
        match &self.detail {
            ClaimDetail::StakerPayout { active_stake, .. } => Some(*active_stake),
            ClaimDetail::FeeDeposit => None,
        }
    }

    pub fn activating_stake(&self) -> Option<u64> {
        match &self.detail {
            ClaimDetail::StakerPayout {
                activating_stake, ..
            } => Some(*activating_stake),
            ClaimDetail::FeeDeposit => None,
        }
    }
}

#[derive(Hash, Eq, PartialEq, Clone)]
pub struct SettlementKey {
    pub withdraw_authority: Pubkey,
    pub stake_authority: Pubkey,
}

#[derive(Clone, Deserialize, Serialize, Debug, utoipa::ToSchema)]
pub enum SettlementReason {
    ProtectedEvent(Box<ProtectedEvent>),
    Bidding,
    PriorityFee,
    BidTooLowPenalty,
    BlacklistPenalty,
    BondRiskFee,
    InstitutionalPayout,
}

impl Display for SettlementReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettlementReason::ProtectedEvent(_) => write!(f, "ProtectedEvent"),
            SettlementReason::Bidding => write!(f, "Bidding"),
            SettlementReason::PriorityFee => write!(f, "PriorityFee"),
            SettlementReason::BidTooLowPenalty => write!(f, "BidTooLowPenalty"),
            SettlementReason::BlacklistPenalty => write!(f, "BlacklistPenalty"),
            SettlementReason::BondRiskFee => write!(f, "BondRiskFee"),
            SettlementReason::InstitutionalPayout => write!(f, "InstitutionalPayout"),
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
