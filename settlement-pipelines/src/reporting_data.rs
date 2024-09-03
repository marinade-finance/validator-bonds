use crate::settlement_data::SettlementRecord;
use log::debug;
use protected_event_distribution::settlement_claims::SettlementReason;
use solana_sdk::pubkey::Pubkey;
use std::collections::{HashMap, HashSet};
use std::fmt::Display;

#[derive(Default)]
pub struct SettlementsReportData {
    pub settlements_count: u64,
    pub settlements_max_claim_sum: u64,
    pub max_merkle_nodes_sum: u64,
}

#[derive(Debug, PartialEq, Eq, Hash)]
pub enum ReportingReasonSettlement {
    ProtectedEvent,
    Bidding,
}

impl ReportingReasonSettlement {
    pub fn items() -> Vec<ReportingReasonSettlement> {
        vec![
            ReportingReasonSettlement::ProtectedEvent,
            ReportingReasonSettlement::Bidding,
        ]
    }
}

impl Display for ReportingReasonSettlement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReportingReasonSettlement::ProtectedEvent => write!(f, "ProtectedEvent"),
            ReportingReasonSettlement::Bidding => write!(f, "Bidding"),
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

    pub fn calculate_bidding(
        settlement_records: &HashSet<SettlementRecord>,
    ) -> SettlementsReportData {
        Self::calculate_filter_by_reason(ReportingReasonSettlement::Bidding, settlement_records)
    }

    pub fn calculate_protected_event(
        settlement_records: &HashSet<SettlementRecord>,
    ) -> SettlementsReportData {
        Self::calculate_filter_by_reason(
            ReportingReasonSettlement::ProtectedEvent,
            settlement_records,
        )
    }

    fn calculate_filter_by_reason(
        reason_match: ReportingReasonSettlement,
        settlement_records: &HashSet<SettlementRecord>,
    ) -> SettlementsReportData {
        let filtered_settlement_records = settlement_records
            .iter()
            .filter(|s| {
                matches!(
                    (&reason_match, &s.reason),
                    (
                        ReportingReasonSettlement::ProtectedEvent,
                        SettlementReason::ProtectedEvent(_)
                    ) | (
                        ReportingReasonSettlement::Bidding,
                        SettlementReason::Bidding
                    )
                )
            })
            .collect::<Vec<&SettlementRecord>>();
        Self::calculate(&filtered_settlement_records)
    }

    pub fn calculate_sum_amount_bidding(
        settlement_records: &HashMap<Pubkey, (SettlementRecord, u64)>,
    ) -> (SettlementsReportData, u64) {
        Self::calculate_sum_amount_filter_by_reason(
            ReportingReasonSettlement::Bidding,
            settlement_records,
        )
    }

    pub fn calculate_sum_amount_protected_event(
        settlement_records: &HashMap<Pubkey, (SettlementRecord, u64)>,
    ) -> (SettlementsReportData, u64) {
        Self::calculate_sum_amount_filter_by_reason(
            ReportingReasonSettlement::ProtectedEvent,
            settlement_records,
        )
    }

    fn calculate_sum_amount_filter_by_reason(
        reason_match: ReportingReasonSettlement,
        settlement_records: &HashMap<Pubkey, (SettlementRecord, u64)>,
    ) -> (SettlementsReportData, u64) {
        let mut sum_amount: u64 = 0;
        let filtered_settlement_records = settlement_records
            .iter()
            .filter(|(_, (s, _))| {
                matches!(
                    (&reason_match, &s.reason),
                    (
                        ReportingReasonSettlement::ProtectedEvent,
                        SettlementReason::ProtectedEvent(_)
                    ) | (
                        ReportingReasonSettlement::Bidding,
                        SettlementReason::Bidding
                    )
                )
            })
            .map(|(_, (s, amount))| {
                sum_amount += amount;
                s
            })
            .collect::<Vec<&SettlementRecord>>();
        (Self::calculate(&filtered_settlement_records), sum_amount)
    }

    /// Filter settlement records matching the provided settlement pubkeys
    /// and group them by type.
    pub fn group_by_reason(
        settlement_records: &HashSet<SettlementRecord>,
        pubkeys: &[Pubkey],
    ) -> HashMap<ReportingReasonSettlement, HashSet<Pubkey>> {
        let mut result: HashMap<ReportingReasonSettlement, HashSet<Pubkey>> = HashMap::new();
        result.insert(ReportingReasonSettlement::ProtectedEvent, HashSet::new());
        result.insert(ReportingReasonSettlement::Bidding, HashSet::new());

        // Mapping provided pubkeys to type based on the settlement records
        for pubkey in pubkeys {
            if let Some(settlement_record) = settlement_records
                .iter()
                .find(|&record| &record.settlement_address == pubkey)
            {
                let reason_type = match settlement_record.reason {
                    SettlementReason::ProtectedEvent(_) => {
                        ReportingReasonSettlement::ProtectedEvent
                    }
                    SettlementReason::Bidding => ReportingReasonSettlement::Bidding,
                };
                result.get_mut(&reason_type).unwrap().insert(*pubkey);
            } else {
                debug!("Unknown settlement record for pubkey: {}", pubkey);
            };
        }
        result
    }
}
