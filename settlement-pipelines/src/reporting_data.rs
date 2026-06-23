use crate::settlement_data::{SettlementFunderType, SettlementRecord};
use settlement_common::settlement_collection::SettlementReasonKind;
use solana_sdk::pubkey::Pubkey;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Display;

#[derive(Default)]
pub struct SettlementsReportData {
    pub settlements_count: u64,
    pub settlements_max_claim_sum: u64,
    pub max_merkle_nodes_sum: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ReportingReasonSettlement {
    ProtectedEvent,
    Bidding,
    PriorityFee,
    BidTooLowPenalty,
    BlacklistPenalty,
    BondRiskFee,
    InstitutionalPayout,
    Unknown,
}

impl From<SettlementReasonKind> for ReportingReasonSettlement {
    fn from(kind: SettlementReasonKind) -> Self {
        match kind {
            SettlementReasonKind::ProtectedEvent => ReportingReasonSettlement::ProtectedEvent,
            SettlementReasonKind::Bidding => ReportingReasonSettlement::Bidding,
            SettlementReasonKind::PriorityFee => ReportingReasonSettlement::PriorityFee,
            SettlementReasonKind::BidTooLowPenalty => ReportingReasonSettlement::BidTooLowPenalty,
            SettlementReasonKind::BlacklistPenalty => ReportingReasonSettlement::BlacklistPenalty,
            SettlementReasonKind::BondRiskFee => ReportingReasonSettlement::BondRiskFee,
            SettlementReasonKind::InstitutionalPayout => {
                ReportingReasonSettlement::InstitutionalPayout
            }
        }
    }
}

impl Display for ReportingReasonSettlement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReportingReasonSettlement::ProtectedEvent => write!(f, "ProtectedEvent"),
            ReportingReasonSettlement::Bidding => write!(f, "Bidding"),
            ReportingReasonSettlement::PriorityFee => write!(f, "PriorityFee"),
            ReportingReasonSettlement::BidTooLowPenalty => write!(f, "BidTooLowPenalty"),
            ReportingReasonSettlement::BlacklistPenalty => write!(f, "BlacklistPenalty"),
            ReportingReasonSettlement::BondRiskFee => write!(f, "BondRiskFee"),
            ReportingReasonSettlement::InstitutionalPayout => write!(f, "InstitutionalPayout"),
            ReportingReasonSettlement::Unknown => write!(f, "Unknown"),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Hash)]
pub enum ReportingFunderSettlement {
    ValidatorBond,
    Marinade,
}

impl ReportingFunderSettlement {
    pub fn items() -> Vec<ReportingFunderSettlement> {
        vec![
            ReportingFunderSettlement::ValidatorBond,
            ReportingFunderSettlement::Marinade,
        ]
    }
}

impl Display for ReportingFunderSettlement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReportingFunderSettlement::ValidatorBond => write!(f, "ValidatorBond"),
            ReportingFunderSettlement::Marinade => write!(f, "Marinade"),
        }
    }
}

impl SettlementsReportData {
    pub fn calculate(settlement_records: &[&SettlementRecord]) -> SettlementsReportData {
        let settlements_count = settlement_records.len() as u64;
        let settlements_max_claim_sum = settlement_records
            .iter()
            .map(|s| s.max_total_claim_sum)
            .sum();
        let max_merkle_nodes_sum = settlement_records.iter().map(|s| s.max_total_claim).sum();
        SettlementsReportData {
            settlements_count,
            settlements_max_claim_sum,
            max_merkle_nodes_sum,
        }
    }

    /// Desired claim lamports per reason summed across the given settlement records.
    /// Funding/claiming is tracked only per settlement on-chain, and a unified settlement may
    /// merge several reasons, so only the desired (intended) amount can be split by reason.
    /// Records without a reason split (e.g. legacy merkle-only data) bucket under `Unknown`.
    pub fn desired_amount_by_reason(
        settlement_records: &HashSet<SettlementRecord>,
    ) -> BTreeMap<ReportingReasonSettlement, u64> {
        let mut amounts: BTreeMap<ReportingReasonSettlement, u64> = BTreeMap::new();
        for record in settlement_records {
            if record.reason_amounts.is_empty() {
                *amounts
                    .entry(ReportingReasonSettlement::Unknown)
                    .or_default() += record.max_total_claim_sum;
            } else {
                for (kind, amount) in &record.reason_amounts {
                    *amounts
                        .entry(ReportingReasonSettlement::from(*kind))
                        .or_default() += amount;
                }
            }
        }
        amounts
    }

    pub fn calculate_for_funder(
        funder: &ReportingFunderSettlement,
        settlement_records: &HashSet<SettlementRecord>,
    ) -> SettlementsReportData {
        let filtered: Vec<&SettlementRecord> = settlement_records
            .iter()
            .filter(|s| Self::matches_funder(funder, &s.funder))
            .collect();
        Self::calculate(&filtered)
    }

    pub fn calculate_sum_amount_for_funder(
        funder: &ReportingFunderSettlement,
        settlement_records: &HashMap<Pubkey, (SettlementRecord, u64)>,
    ) -> (SettlementsReportData, u64) {
        let mut sum_amount: u64 = 0;
        let filtered: Vec<&SettlementRecord> = settlement_records
            .iter()
            .filter(|(_, (_, amount))| *amount > 0)
            .filter(|(_, (s, _))| Self::matches_funder(funder, &s.funder))
            .map(|(_, (s, amount))| {
                sum_amount += amount;
                s
            })
            .collect();
        (Self::calculate(&filtered), sum_amount)
    }

    fn matches_funder(
        funder: &ReportingFunderSettlement,
        record_funder: &SettlementFunderType,
    ) -> bool {
        matches!(
            (funder, record_funder),
            (
                ReportingFunderSettlement::Marinade,
                SettlementFunderType::Marinade(_)
            ) | (
                ReportingFunderSettlement::ValidatorBond,
                SettlementFunderType::ValidatorBond(_)
            )
        )
    }
}
