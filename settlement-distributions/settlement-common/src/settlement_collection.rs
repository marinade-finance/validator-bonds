use crate::protected_events::ProtectedEvent;
use solana_sdk::pubkey::Pubkey;
use std::fmt::Display;

use {
    merkle_tree::serde_serialize::{
        map_pubkey_u64_number_or_string, pubkey_string_conversion, u64_number_or_string,
    },
    serde::{Deserialize, Serialize},
    std::collections::HashMap,
};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SettlementClaim {
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    #[serde(with = "u64_number_or_string")]
    pub claim_amount: u64,
    #[serde(flatten)]
    pub detail: ClaimDetail,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "kind")]
pub enum ClaimDetail {
    // Invariant: a nonzero stake field is the basis claim_amount was calculated from
    StakerPayout {
        #[serde(with = "u64_number_or_string")]
        active_stake: u64,
        #[serde(with = "u64_number_or_string")]
        activating_stake: u64,
        #[serde(with = "map_pubkey_u64_number_or_string")]
        stake_accounts: HashMap<Pubkey, u64>,
    },
    FeeDeposit,
    // Zero-amount placeholder splitting Marinade- vs ValidatorBond-funded merkle roots; TODO enforce claim_amount == 0 on deserialize
    Marker,
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

    pub fn marker() -> Self {
        Self {
            withdraw_authority: Pubkey::default(),
            stake_authority: Pubkey::default(),
            claim_amount: 0,
            detail: ClaimDetail::Marker,
        }
    }

    pub fn stake_accounts(&self) -> Option<&HashMap<Pubkey, u64>> {
        match &self.detail {
            ClaimDetail::StakerPayout { stake_accounts, .. } => Some(stake_accounts),
            ClaimDetail::FeeDeposit | ClaimDetail::Marker => None,
        }
    }

    pub fn active_stake(&self) -> Option<u64> {
        match &self.detail {
            ClaimDetail::StakerPayout { active_stake, .. } => Some(*active_stake),
            ClaimDetail::FeeDeposit | ClaimDetail::Marker => None,
        }
    }

    pub fn activating_stake(&self) -> Option<u64> {
        match &self.detail {
            ClaimDetail::StakerPayout {
                activating_stake, ..
            } => Some(*activating_stake),
            ClaimDetail::FeeDeposit | ClaimDetail::Marker => None,
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

// Off-chain product attribution; the wire value matches portfolio-api's StrategySlug so analytics join without a mapping table.
#[derive(Clone, Deserialize, Serialize, Debug, Eq, PartialEq)]
pub enum SettlementProduct {
    #[serde(rename = "single-validator")]
    SingleValidator,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct Settlement {
    pub reason: SettlementReason,
    pub funder: SettlementFunder,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub claims_count: usize,
    #[serde(with = "u64_number_or_string")]
    pub claims_amount: u64,
    pub claims: Vec<SettlementClaim>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<crate::settlement_details::SettlementDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product: Option<SettlementProduct>,
}

#[derive(Clone, Deserialize, Serialize, Debug, Default)]
pub struct SettlementCollection {
    pub slot: u64,
    pub epoch: u64,
    pub settlements: Vec<Settlement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adj_max_fee_bps: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adj_min_fee_bps: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssr_pmpe: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // u64_number_or_string tolerance: lamport fields must deserialize from both a
    // plain JSON number and a decimal string (the JS-exact form above 2^53-1),
    // including through the #[serde(flatten)] + internally-tagged ClaimDetail path.
    #[test]
    fn claim_lamports_deserialize_from_number_and_string() {
        let as_number = r#"{
            "withdraw_authority": "9ZQfsc7NkNWQvUyjV2mVCLeMzWJcAdG5D9SjoxNsMhVs",
            "stake_authority": "4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk",
            "claim_amount": 9007199254740993,
            "kind": "StakerPayout",
            "active_stake": 9007199254740995,
            "activating_stake": 0,
            "stake_accounts": {"9ZQfsc7NkNWQvUyjV2mVCLeMzWJcAdG5D9SjoxNsMhVs": 9007199254740997}
        }"#;
        let as_string = r#"{
            "withdraw_authority": "9ZQfsc7NkNWQvUyjV2mVCLeMzWJcAdG5D9SjoxNsMhVs",
            "stake_authority": "4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk",
            "claim_amount": "9007199254740993",
            "kind": "StakerPayout",
            "active_stake": "9007199254740995",
            "activating_stake": "0",
            "stake_accounts": {"9ZQfsc7NkNWQvUyjV2mVCLeMzWJcAdG5D9SjoxNsMhVs": "9007199254740997"}
        }"#;

        let from_number: SettlementClaim = serde_json::from_str(as_number).unwrap();
        let from_string: SettlementClaim = serde_json::from_str(as_string).unwrap();

        assert_eq!(from_number.claim_amount, 9007199254740993);
        assert_eq!(from_string.claim_amount, from_number.claim_amount);
        match (&from_number.detail, &from_string.detail) {
            (
                ClaimDetail::StakerPayout {
                    active_stake: a1,
                    stake_accounts: s1,
                    ..
                },
                ClaimDetail::StakerPayout {
                    active_stake: a2,
                    stake_accounts: s2,
                    ..
                },
            ) => {
                assert_eq!(*a1, 9007199254740995);
                assert_eq!(a1, a2);
                assert_eq!(s1.values().sum::<u64>(), 9007199254740997);
                assert_eq!(s1, s2);
            }
            other => panic!("expected StakerPayout on both sides, got {other:?}"),
        }

        // Wire format is unchanged: serializes back to a plain JSON number.
        let json = serde_json::to_value(&from_string).unwrap();
        assert!(json["claim_amount"].is_u64());
        assert_eq!(json["claim_amount"].as_u64(), Some(9007199254740993));
    }

    const SETTLEMENT_WITHOUT_PRODUCT: &str = r#"{
        "reason": "Bidding",
        "funder": "ValidatorBond",
        "vote_account": "We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb",
        "claims_count": 0,
        "claims_amount": 0,
        "claims": []
    }"#;

    // The product tag is additive: files written before it stay readable, and untagged
    // settlements must not start emitting the key.
    #[test]
    fn settlement_product_is_optional_on_the_wire() {
        let untagged: Settlement = serde_json::from_str(SETTLEMENT_WITHOUT_PRODUCT).unwrap();
        assert_eq!(untagged.product, None);

        let round_tripped = serde_json::to_value(&untagged).unwrap();
        assert!(
            round_tripped.get("product").is_none(),
            "an untagged settlement must serialize without the key"
        );

        let mut tagged = untagged;
        tagged.product = Some(SettlementProduct::SingleValidator);
        let json = serde_json::to_value(&tagged).unwrap();
        assert_eq!(json["product"], serde_json::json!("single-validator"));

        let reparsed: Settlement = serde_json::from_value(json).unwrap();
        assert_eq!(
            reparsed.product,
            Some(SettlementProduct::SingleValidator),
            "the portfolio-api slug must survive a round trip verbatim"
        );
    }
}
