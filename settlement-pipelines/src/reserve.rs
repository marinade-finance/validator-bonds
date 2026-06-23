use crate::arguments::load_pubkey;
use crate::settlement_data::{SettlementFunderType, SettlementRecord};
use anchor_client::anchor_lang::prelude::Pubkey;
use anyhow::anyhow;
use clap::Args;
use log::info;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

/// CLI options for the global reserve that fronts mSOL bid payouts (Coord Goal 2).
/// When the gate file is unset/empty or the prefund is zero, the feature is OFF
/// and behavior is identical to today.
#[derive(Debug, Clone, Args)]
pub struct ReserveOpts {
    /// File of vote accounts (one base58 pubkey per line; '#' comments allowed)
    /// whose bond-funded settlements are fronted from the reserve. Absent/empty
    /// => feature off.
    #[arg(long, env)]
    pub reserve_enabled_vote_accounts: Option<PathBuf>,

    /// Lamports the reserve pre-funds per reserve-enabled settlement (R). The
    /// on-chain max_total_claim is inflated by exactly this amount so the bond's
    /// funding reimburses the reserve and the leftover is reaped back at close.
    #[arg(long, env, default_value_t = 0)]
    pub reserve_prefund_lamports: u64,
}

/// Resolved reserve configuration; build via [`ReserveConfig::load`].
#[derive(Debug, Clone)]
pub struct ReserveConfig {
    enabled_vote_accounts: HashSet<Pubkey>,
    pub prefund_lamports: u64,
}

impl ReserveConfig {
    /// Resolve [`ReserveOpts`]. Returns `None` when the feature is off (no gate
    /// file, empty gate, or zero prefund), so callers skip all reserve behavior.
    pub fn load(opts: &ReserveOpts) -> anyhow::Result<Option<Self>> {
        let path = match &opts.reserve_enabled_vote_accounts {
            Some(path) => path,
            None => return Ok(None),
        };
        let contents = fs::read_to_string(path)
            .map_err(|e| anyhow!("Could not read reserve gate file '{}': {e}", path.display()))?;
        let enabled_vote_accounts = contents
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(load_pubkey)
            .collect::<anyhow::Result<HashSet<Pubkey>>>()?;
        let config = Self::from_enabled(enabled_vote_accounts, opts.reserve_prefund_lamports);
        if let Some(config) = &config {
            info!(
                "Reserve enabled for {} vote accounts, prefund {} lamports each",
                config.enabled_vote_accounts.len(),
                config.prefund_lamports,
            );
        }
        Ok(config)
    }

    /// Build a config, returning `None` when the feature is effectively off
    /// (no enabled vote accounts, or zero prefund).
    fn from_enabled(enabled_vote_accounts: HashSet<Pubkey>, prefund_lamports: u64) -> Option<Self> {
        if enabled_vote_accounts.is_empty() || prefund_lamports == 0 {
            None
        } else {
            Some(Self {
                enabled_vote_accounts,
                prefund_lamports,
            })
        }
    }

    pub fn is_enabled(&self, vote_account: &Pubkey) -> bool {
        self.enabled_vote_accounts.contains(vote_account)
    }
}

/// Option B: inflate on-chain `max_total_claim` by the reserve prefund for every
/// reserve-enabled, bond-funded settlement. The merkle root still commits to the
/// real claims (their sum is unchanged); the extra `prefund_lamports` headroom is
/// funded by the validator bond, never claimed (no merkle node covers it), and
/// reaped back to the reserve at close.
///
/// Gated to `ValidatorBond` funder so only the bond-funded staker payout is
/// inflated, not Marinade-funded settlements (e.g. PSR).
///
/// INVARIANT: the inflation MUST equal the amount the reserve actually fronts from
/// `marinade_wallet` during normal funding. If the reserve fronts less, the bond
/// over-funds and the reserve over-recovers. Apply this in every binary that reads
/// the on-chain `max_total_claim` (init sets it; fund targets it), so both sides
/// stay consistent and the funding assert holds.
pub fn apply_reserve_inflation(records: &mut [SettlementRecord], reserve: &ReserveConfig) {
    for record in records.iter_mut() {
        if reserve.is_enabled(&record.vote_account_address)
            && matches!(record.funder, SettlementFunderType::ValidatorBond(_))
        {
            record.max_total_claim_sum += reserve.prefund_lamports;
        }
    }
}

/// Lamports to front from the reserve for this settlement on this funding run. Fronts
/// the prefund R only for a reserve-enabled, bond-funded settlement that has nothing
/// funded yet (`settlement_amount_funded == 0`); otherwise 0. Fronting only on first
/// touch keeps inflate-by-R == front-by-R: later runs see `settlement_amount_funded > 0`,
/// so the bond's normal funding target already accounts for the front.
pub fn reserve_front_lamports(
    reserve: Option<&ReserveConfig>,
    vote_account: &Pubkey,
    is_validator_bond: bool,
    settlement_amount_funded: u64,
) -> u64 {
    match reserve {
        Some(reserve)
            if is_validator_bond
                && settlement_amount_funded == 0
                && reserve.is_enabled(vote_account) =>
        {
            reserve.prefund_lamports
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement_data::{SettlementFunderType, SettlementRecord};
    use std::collections::HashMap;

    fn cfg(votes: &[Pubkey], prefund: u64) -> ReserveConfig {
        ReserveConfig::from_enabled(votes.iter().copied().collect(), prefund).unwrap()
    }

    fn record(vote: Pubkey, funder: SettlementFunderType, claim_sum: u64) -> SettlementRecord {
        SettlementRecord {
            epoch: 0,
            vote_account_address: vote,
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

    #[test]
    fn from_enabled_gates_off_when_empty_or_zero() {
        assert!(ReserveConfig::from_enabled(HashSet::new(), 1_000).is_none());
        assert!(
            ReserveConfig::from_enabled([Pubkey::new_unique()].into_iter().collect(), 0).is_none()
        );
        assert!(
            ReserveConfig::from_enabled([Pubkey::new_unique()].into_iter().collect(), 1).is_some()
        );
    }

    #[test]
    fn inflation_targets_only_enabled_bond_settlements() {
        let on = Pubkey::new_unique();
        let off = Pubkey::new_unique();
        let reserve = cfg(&[on], 1_000);
        let mut records = vec![
            record(on, SettlementFunderType::ValidatorBond(vec![]), 100),
            record(on, SettlementFunderType::Marinade(None), 100),
            record(off, SettlementFunderType::ValidatorBond(vec![]), 100),
        ];
        apply_reserve_inflation(&mut records, &reserve);
        assert_eq!(
            records[0].max_total_claim_sum, 1_100,
            "enabled bond inflated by R"
        );
        assert_eq!(records[1].max_total_claim_sum, 100, "marinade not inflated");
        assert_eq!(
            records[2].max_total_claim_sum, 100,
            "disabled vote not inflated"
        );
    }

    #[test]
    fn front_only_on_first_touch_of_enabled_bond() {
        let on = Pubkey::new_unique();
        let reserve = cfg(&[on], 1_000);
        assert_eq!(
            reserve_front_lamports(Some(&reserve), &on, true, 0),
            1_000,
            "enabled+bond+unfunded"
        );
        assert_eq!(
            reserve_front_lamports(Some(&reserve), &on, true, 1),
            0,
            "already funded: no front"
        );
        assert_eq!(
            reserve_front_lamports(Some(&reserve), &on, false, 0),
            0,
            "marinade: no front"
        );
        assert_eq!(
            reserve_front_lamports(Some(&reserve), &Pubkey::new_unique(), true, 0),
            0,
            "disabled vote: no front"
        );
        assert_eq!(
            reserve_front_lamports(None, &on, true, 0),
            0,
            "reserve off: no front"
        );
    }
}
