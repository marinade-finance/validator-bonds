use crate::settlement_data::{SettlementFunderType, SettlementRecord};
use clap::Args;
use log::info;

/// CLI options for the global reserve that fronts mSOL bid payouts. A zero
/// prefund turns the feature off and the pipeline behaves as it did before.
#[derive(Debug, Clone, Args)]
pub struct ReserveOpts {
    /// Lamports the reserve pre-funds per bond settlement (R). The on-chain
    /// max_total_claim is inflated by exactly this amount so the bond's funding
    /// reimburses the reserve and the leftover is reaped back at close.
    #[arg(long, env, default_value_t = 0)]
    pub reserve_prefund_lamports: u64,
}

/// Resolved reserve configuration; build via [`ReserveConfig::load`].
#[derive(Debug, Clone)]
pub struct ReserveConfig {
    pub prefund_lamports: u64,
}

impl ReserveConfig {
    /// Resolve [`ReserveOpts`]. Returns `None` when the prefund is zero, so
    /// callers skip all reserve behavior.
    pub fn load(opts: &ReserveOpts) -> Option<Self> {
        if opts.reserve_prefund_lamports == 0 {
            return None;
        }
        info!(
            "Reserve enabled for all bond settlements, prefund {} lamports each",
            opts.reserve_prefund_lamports,
        );
        Some(Self {
            prefund_lamports: opts.reserve_prefund_lamports,
        })
    }
}

/// Whether the reserve fronts this settlement. Bond-funded only: Marinade-funded
/// settlements (e.g. PSR) fund from `marinade_wallet` directly, are already
/// claimable on time, and have no bond to reimburse a front.
fn is_reserve_target(record: &SettlementRecord) -> bool {
    matches!(record.funder, SettlementFunderType::ValidatorBond(_))
}

/// Inflate on-chain `max_total_claim` by the reserve prefund for every bond-funded
/// settlement. The merkle root still commits to the real claims (their sum is
/// unchanged); the extra `prefund_lamports` headroom is funded by the validator
/// bond, never claimed (no merkle node covers it), and reaped back to the reserve
/// at close.
///
/// INVARIANT: the inflation MUST equal what [`reserve_front_lamports`] fronts —
/// same target, same `prefund_lamports` — so the bond funds toward exactly the
/// inflated max and the funding assert holds.
pub fn apply_reserve_inflation(records: &mut [SettlementRecord], reserve: &ReserveConfig) {
    for record in records.iter_mut() {
        if is_reserve_target(record) {
            record.max_total_claim_sum += reserve.prefund_lamports;
        }
    }
}

/// Lamports to front from the reserve for this settlement on this funding run.
/// Fronts the prefund R only for a bond-funded settlement with nothing funded yet
/// (`settlement_amount_funded == 0`); otherwise 0. Fronting only on first touch
/// keeps front-by-R == inflate-by-R: later runs see `settlement_amount_funded > 0`
/// (the bond's FundSettlement CPI bumped `lamports_funded`), so the normal funding
/// target already accounts for the front.
pub fn reserve_front_lamports(
    reserve: Option<&ReserveConfig>,
    record: &SettlementRecord,
    settlement_amount_funded: u64,
) -> u64 {
    match reserve {
        Some(reserve) if settlement_amount_funded == 0 && is_reserve_target(record) => {
            reserve.prefund_lamports
        }
        _ => 0,
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
            reserve_front_lamports: 0,
        }
    }

    fn cfg(prefund: u64) -> ReserveConfig {
        ReserveConfig {
            prefund_lamports: prefund,
        }
    }

    #[test]
    fn load_off_when_zero_prefund() {
        assert!(ReserveConfig::load(&ReserveOpts {
            reserve_prefund_lamports: 0
        })
        .is_none());
        assert!(ReserveConfig::load(&ReserveOpts {
            reserve_prefund_lamports: 1
        })
        .is_some());
    }

    #[test]
    fn inflation_targets_only_bond_settlements() {
        let reserve = cfg(1_000);
        let mut records = vec![
            record(SettlementFunderType::ValidatorBond(vec![]), 100),
            record(SettlementFunderType::Marinade(None), 100),
        ];
        apply_reserve_inflation(&mut records, &reserve);
        assert_eq!(records[0].max_total_claim_sum, 1_100, "bond inflated by R");
        assert_eq!(records[1].max_total_claim_sum, 100, "marinade not inflated");
    }

    #[test]
    fn front_only_on_first_touch_of_bond() {
        let reserve = cfg(1_000);
        let bond = record(SettlementFunderType::ValidatorBond(vec![]), 100);
        let marinade = record(SettlementFunderType::Marinade(None), 100);
        assert_eq!(
            reserve_front_lamports(Some(&reserve), &bond, 0),
            1_000,
            "bond + unfunded"
        );
        assert_eq!(
            reserve_front_lamports(Some(&reserve), &bond, 1),
            0,
            "already funded: no front"
        );
        assert_eq!(
            reserve_front_lamports(Some(&reserve), &marinade, 0),
            0,
            "marinade: no front"
        );
        assert_eq!(
            reserve_front_lamports(None, &bond, 0),
            0,
            "reserve off: no front"
        );
    }
}
