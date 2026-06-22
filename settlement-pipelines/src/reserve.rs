use crate::arguments::load_pubkey;
use crate::settlement_data::{SettlementFunderType, SettlementRecord};
use anchor_client::anchor_lang::prelude::Pubkey;
use anyhow::anyhow;
use clap::Args;
use log::info;
use std::collections::{HashMap, HashSet};
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
        if enabled_vote_accounts.is_empty() || opts.reserve_prefund_lamports == 0 {
            return Ok(None);
        }
        info!(
            "Reserve enabled for {} vote accounts, prefund {} lamports each",
            enabled_vote_accounts.len(),
            opts.reserve_prefund_lamports,
        );
        Ok(Some(Self {
            enabled_vote_accounts,
            prefund_lamports: opts.reserve_prefund_lamports,
        }))
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
/// INVARIANT: the inflation MUST equal the amount the reserve actually pre-funds
/// (see the early pre-fund pass). If the reserve fronts less, the bond over-funds
/// and the reserve over-recovers. Apply this in every binary that reads the
/// on-chain `max_total_claim` (init sets it; fund targets it), so both sides stay
/// consistent and the funding assert holds.
pub fn apply_reserve_inflation(
    records_by_epoch: &mut HashMap<u64, Vec<SettlementRecord>>,
    reserve: &ReserveConfig,
) {
    for records in records_by_epoch.values_mut() {
        for record in records.iter_mut() {
            if reserve.is_enabled(&record.vote_account_address)
                && matches!(record.funder, SettlementFunderType::ValidatorBond(_))
            {
                record.max_total_claim_sum += reserve.prefund_lamports;
            }
        }
    }
}
