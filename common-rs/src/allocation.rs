//! Wire format of `direct-staking-allocation-report.json`, written by `settlement-bond-allocator`
//! and read back by the bonds API store. Shared rather than duplicated because the two sides must
//! agree byte for byte: `stakes-etl` loads the same file into BigQuery with `jq`, and
//! `scripts/generate-direct-staking-report.bash` reads it too.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AllocationReport {
    pub epoch: u64,
    pub slot: u64,
    pub totals: ReportTotals,
    pub routed: Vec<RoutedValidator>,
    pub dropped_no_usable_bond: Vec<DroppedValidator>,
    pub exposure_warnings: Vec<ExposureWarning>,
    /// Bond snapshots are resolved per bond type, so the two files can legitimately differ by an epoch.
    pub bidding_bonds_epoch: Option<u64>,
    pub institutional_bonds_epoch: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReportTotals {
    pub settlements_in: usize,
    pub claims_amount_in: u64,
    pub bidding_settlements: usize,
    pub bidding_claims_amount: u64,
    pub institutional_settlements: usize,
    pub institutional_claims_amount: u64,
    pub dropped_settlements: usize,
    pub dropped_claims_amount: u64,
}

/// The amounts are quoted decimals, not numbers: BigQuery ingests them into NUMERIC exactly
/// instead of rounding through a double.
#[derive(Debug, Serialize, Deserialize)]
pub struct RoutedValidator {
    pub vote_account: String,
    pub bond_type: String,
    pub settlements: usize,
    pub claims_amount: u64,
    pub effective_amount: String,
    pub exposure_bps: u64,
}

/// Both amounts are `<= 0` by construction — a validator is dropped only when neither bond has a
/// positive effective amount.
#[derive(Debug, Serialize, Deserialize)]
pub struct DroppedValidator {
    pub vote_account: String,
    pub settlements: usize,
    pub claims_amount: u64,
    pub bidding_effective_amount: String,
    pub institutional_effective_amount: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExposureWarning {
    pub vote_account: String,
    pub bond_type: String,
    pub claims_amount: u64,
    pub effective_amount: String,
    pub exposure_bps: u64,
    pub threshold_bps: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captured from the allocator before these types moved out of `bond_allocator.rs`. Three
    /// consumers parse this file by field name, so a rename here is a silent break in all of them.
    const GOLDEN: &str = r#"{"epoch":1030,"slot":445356003,"totals":{"settlements_in":3,"claims_amount_in":600,"bidding_settlements":1,"bidding_claims_amount":100,"institutional_settlements":1,"institutional_claims_amount":200,"dropped_settlements":1,"dropped_claims_amount":300},"routed":[{"vote_account":"voteR","bond_type":"bidding","settlements":1,"claims_amount":100,"effective_amount":"5000000000.5","exposure_bps":1}],"dropped_no_usable_bond":[{"vote_account":"voteD","settlements":1,"claims_amount":300,"bidding_effective_amount":"0","institutional_effective_amount":"0"}],"exposure_warnings":[{"vote_account":"voteW","bond_type":"institutional","claims_amount":200,"effective_amount":"700","exposure_bps":2858,"threshold_bps":2500}],"bidding_bonds_epoch":1030,"institutional_bonds_epoch":null}"#;

    fn golden_report() -> AllocationReport {
        AllocationReport {
            epoch: 1030,
            slot: 445_356_003,
            totals: ReportTotals {
                settlements_in: 3,
                claims_amount_in: 600,
                bidding_settlements: 1,
                bidding_claims_amount: 100,
                institutional_settlements: 1,
                institutional_claims_amount: 200,
                dropped_settlements: 1,
                dropped_claims_amount: 300,
            },
            routed: vec![RoutedValidator {
                vote_account: "voteR".to_string(),
                bond_type: "bidding".to_string(),
                settlements: 1,
                claims_amount: 100,
                effective_amount: "5000000000.5".to_string(),
                exposure_bps: 1,
            }],
            dropped_no_usable_bond: vec![DroppedValidator {
                vote_account: "voteD".to_string(),
                settlements: 1,
                claims_amount: 300,
                bidding_effective_amount: "0".to_string(),
                institutional_effective_amount: "0".to_string(),
            }],
            exposure_warnings: vec![ExposureWarning {
                vote_account: "voteW".to_string(),
                bond_type: "institutional".to_string(),
                claims_amount: 200,
                effective_amount: "700".to_string(),
                exposure_bps: 2858,
                threshold_bps: 2500,
            }],
            bidding_bonds_epoch: Some(1030),
            institutional_bonds_epoch: None,
        }
    }

    #[test]
    fn the_wire_format_is_unchanged() {
        assert_eq!(serde_json::to_string(&golden_report()).unwrap(), GOLDEN);
    }

    #[test]
    fn the_report_reads_back_as_it_was_written() {
        let parsed: AllocationReport = serde_json::from_str(GOLDEN).unwrap();
        assert_eq!(serde_json::to_string(&parsed).unwrap(), GOLDEN);
    }

    #[test]
    fn a_report_with_no_routing_at_all_is_valid() {
        let empty = r#"{"epoch":1020,"slot":1,"totals":{"settlements_in":0,"claims_amount_in":0,"bidding_settlements":0,"bidding_claims_amount":0,"institutional_settlements":0,"institutional_claims_amount":0,"dropped_settlements":0,"dropped_claims_amount":0},"routed":[],"dropped_no_usable_bond":[],"exposure_warnings":[],"bidding_bonds_epoch":null,"institutional_bonds_epoch":null}"#;
        let parsed: AllocationReport = serde_json::from_str(empty).unwrap();
        assert_eq!(parsed.epoch, 1020);
        assert!(parsed.routed.is_empty());
        assert!(parsed.dropped_no_usable_bond.is_empty());
    }
}
