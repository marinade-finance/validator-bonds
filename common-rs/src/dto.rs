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

/// Stake routed to a validator through one Marinade product, identified by its staker authority.
/// `deactivating` is a subset of `effective`, not an addend — see `stake_accounts::StakeAggregate`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectedStakeRecord {
    pub epoch: u64,
    pub slot: u64,
    pub label: String,
    pub stake_authority: String,
    pub vote_account: String,
    pub effective: u64,
    pub activating: u64,
    pub deactivating: u64,
    pub stake_accounts: u32,
    pub updated_at: DateTime<Utc>,
}

/// Which bond paid a validator's direct-staking claims, or that none could. Modelled as an enum so
/// a routed record cannot be built without the bond it routed to, and a dropped one cannot claim a
/// bond it never had — the same invariant `direct_staking_allocation`'s CHECK constraints enforce
/// from the database side.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum AllocationOutcome {
    Routed {
        bond_type: BondType,
        effective_amount: Decimal,
        /// Share of the chosen bond these claims alone consume. The same epoch's SAM claims against
        /// the same bond are not counted.
        exposure_bps: u64,
    },
    /// Both amounts are `<= 0`: a validator is dropped only when neither bond has a positive
    /// effective amount, so the row records "no usable bond at all", not "a bond that was too small".
    Dropped {
        bidding_effective_amount: Decimal,
        institutional_effective_amount: Decimal,
    },
}

/// One validator's routing outcome for one epoch. `updated_at` is stamped by the store — the
/// allocator's report carries no timestamp.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirectStakingAllocationRecord {
    pub epoch: u64,
    pub slot: u64,
    pub vote_account: String,
    pub settlements: u32,
    pub claims_amount: u64,
    /// The bond snapshots the allocator actually routed against. They can legitimately differ, and a
    /// stale one pushes validators to the other config, so these are the only record of which was used.
    pub bidding_bonds_epoch: Option<u64>,
    pub institutional_bonds_epoch: Option<u64>,
    #[serde(flatten)]
    pub outcome: AllocationOutcome,
    pub updated_at: DateTime<Utc>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use rust_decimal_macros::dec;

    fn stamp() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 8, 12, 0, 0).unwrap()
    }

    fn record(outcome: AllocationOutcome) -> DirectStakingAllocationRecord {
        DirectStakingAllocationRecord {
            epoch: 1030,
            slot: 445_356_003,
            vote_account: "voteA".to_string(),
            settlements: 1,
            claims_amount: 37_316_490,
            bidding_bonds_epoch: Some(1030),
            institutional_bonds_epoch: None,
            outcome,
            updated_at: stamp(),
        }
    }

    // The endpoint publishes one flat object per validator, discriminated by `outcome`. A nested
    // or externally tagged shape would be a silent contract change for every generated client.
    #[test]
    fn a_routed_record_publishes_flat() {
        let json = serde_json::to_value(record(AllocationOutcome::Routed {
            bond_type: BondType::Bidding,
            effective_amount: dec!(5000000000),
            exposure_bps: 75,
        }))
        .unwrap();
        assert_eq!(json["outcome"], "routed");
        assert_eq!(json["bond_type"], "bidding");
        assert_eq!(json["exposure_bps"], 75);
        assert_eq!(json["effective_amount"], 5_000_000_000.0);
        assert!(json.get("bidding_effective_amount").is_none());
    }

    #[test]
    fn a_dropped_record_publishes_both_amounts_and_no_bond_type() {
        let json = serde_json::to_value(record(AllocationOutcome::Dropped {
            bidding_effective_amount: Decimal::ZERO,
            institutional_effective_amount: Decimal::ZERO,
        }))
        .unwrap();
        assert_eq!(json["outcome"], "dropped");
        assert_eq!(json["bidding_effective_amount"], 0.0);
        assert_eq!(json["institutional_effective_amount"], 0.0);
        assert!(json.get("bond_type").is_none());
        assert!(json.get("exposure_bps").is_none());
    }

    // `serde-float` is enabled for this crate, so every amount must reach a client as a JSON
    // number; a string here would be the only string amount the API serves.
    #[test]
    fn amounts_publish_as_json_numbers() {
        let json = serde_json::to_value(record(AllocationOutcome::Routed {
            bond_type: BondType::Institutional,
            effective_amount: dec!(0.5),
            exposure_bps: 1,
        }))
        .unwrap();
        assert!(json["effective_amount"].is_f64(), "{json}");
        assert_eq!(json["effective_amount"], 0.5);
    }

    #[test]
    fn a_record_reads_back_as_it_was_written() {
        for outcome in [
            AllocationOutcome::Routed {
                bond_type: BondType::Bidding,
                effective_amount: dec!(5000000000),
                exposure_bps: 75,
            },
            AllocationOutcome::Dropped {
                bidding_effective_amount: Decimal::ZERO,
                institutional_effective_amount: Decimal::ZERO,
            },
        ] {
            let written = serde_json::to_string(&record(outcome)).unwrap();
            let parsed: DirectStakingAllocationRecord = serde_json::from_str(&written).unwrap();
            assert_eq!(serde_json::to_string(&parsed).unwrap(), written);
        }
    }

    #[test]
    fn an_outcome_missing_its_bond_is_rejected() {
        let routed_without_exposure =
            r#"{"outcome":"routed","bond_type":"bidding","effective_amount":5.0}"#;
        serde_json::from_str::<AllocationOutcome>(routed_without_exposure).unwrap_err();

        let dropped_with_bond_type = r#"{"outcome":"dropped","bond_type":"bidding","bidding_effective_amount":0.0,"institutional_effective_amount":0.0}"#;
        let parsed: AllocationOutcome = serde_json::from_str(dropped_with_bond_type).unwrap();
        assert!(
            matches!(parsed, AllocationOutcome::Dropped { .. }),
            "an extra field is ignored, but it cannot turn a dropped outcome into a routed one"
        );
    }
}
