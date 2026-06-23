use crate::settlement_data::{SettlementFunderType, SettlementRecord};
use clap::Args;

/// CLI options for the global reserve that fronts mSOL bid payouts. A zero
/// prefund turns the reserve off — inflation and front both compute to zero.
#[derive(Debug, Clone, Args)]
pub struct ReserveOpts {
    /// Lamports the reserve pre-funds per bond settlement (R). The on-chain
    /// max_total_claim is inflated by exactly this amount so the bond's funding
    /// reimburses the reserve and the leftover is reaped back at close.
    #[arg(long, env, default_value_t = 0)]
    pub reserve_prefund_lamports: u64,
}

/// Whether the reserve fronts this settlement. Bond-funded only: Marinade-funded
/// settlements (e.g. PSR) fund from marinade_wallet directly, are already
/// claimable on time, and have no bond to reimburse a front.
pub fn is_reserve_target(record: &SettlementRecord) -> bool {
    matches!(record.funder, SettlementFunderType::ValidatorBond(_))
}

/// Inflate on-chain max_total_claim by the reserve prefund for every bond-funded
/// settlement (a zero prefund is a no-op). The merkle root still commits to the
/// real claims (their sum is unchanged); the extra headroom is funded by the
/// validator bond, never claimed (no merkle node covers it), and reaped back to
/// the reserve at close.
///
/// INVARIANT: this inflation MUST equal what the fund pass fronts from
/// marinade_wallet on first touch — same `is_reserve_target` gate, same prefund —
/// so the bond funds toward exactly the inflated max and the funding assert holds.
pub fn apply_reserve_inflation(records: &mut [SettlementRecord], reserve_prefund_lamports: u64) {
    for record in records.iter_mut() {
        if is_reserve_target(record) {
            record.max_total_claim_sum += reserve_prefund_lamports;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement_data::{SettlementFunderType, SettlementRecord};
    use anchor_client::anchor_lang::prelude::Pubkey;
    use std::collections::HashMap;

    fn record(funder: SettlementFunderType, claim_sum: u64) -> SettlementRecord {
        SettlementRecord {
            epoch: 0,
            vote_account_address: Pubkey::new_unique(),
            bond_address: Pubkey::default(),
            bond_account: None,
            settlement_address: Pubkey::default(),
            settlement_account: None,
            settlement_staker_authority: Pubkey::default(),
            merkle_root: [0u8; 32],
            tree_nodes: vec![],
            max_total_claim_sum: claim_sum,
            max_total_claim: 0,
            funder,
            reason: None,
            funding_sources: HashMap::new(),
            reserve_front: 0,
        }
    }

    #[test]
    fn is_reserve_target_bond_only() {
        assert!(is_reserve_target(&record(
            SettlementFunderType::ValidatorBond(vec![]),
            0
        )));
        assert!(!is_reserve_target(&record(
            SettlementFunderType::Marinade(None),
            0
        )));
    }

    #[test]
    fn inflation_targets_only_bond_settlements() {
        let mut records = vec![
            record(SettlementFunderType::ValidatorBond(vec![]), 100),
            record(SettlementFunderType::Marinade(None), 100),
        ];
        apply_reserve_inflation(&mut records, 1_000);
        assert_eq!(records[0].max_total_claim_sum, 1_100, "bond inflated by R");
        assert_eq!(records[1].max_total_claim_sum, 100, "marinade not inflated");
    }

    #[test]
    fn zero_prefund_is_inert() {
        let mut records = vec![record(SettlementFunderType::ValidatorBond(vec![]), 100)];
        apply_reserve_inflation(&mut records, 0);
        assert_eq!(
            records[0].max_total_claim_sum, 100,
            "zero prefund: no inflation"
        );
    }
}
