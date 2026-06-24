use crate::rewards::RewardsCollection;
use crate::sam_meta::ValidatorSamMeta;
use crate::settlement_config::{FeeConfig, SettlementConfig};
use log::info;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::Serialize;
use settlement_common::settlement_collection::{Settlement, SettlementReason};
use settlement_common::settlement_details::SettlementDetails;
use settlement_common::stake_meta_index::StakeMetaIndex;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;

use super::bidding::{
    build_staker_stake_groups, generate_bid_settlements_worker, StakerStakeGroup,
};

const MAX_ADJ_ITER: u32 = 20;

#[derive(Serialize)]
pub struct BidSettlementValues {
    pub settlements: Vec<Settlement>,
    pub adj_max_fee_bps: u64,
    pub adj_min_fee_bps: u64,
}

#[derive(Default)]
pub struct BidSettlementTotals {
    pub stake: Decimal,
    pub rewards: Decimal,
    pub fees: Decimal,
}

pub fn calculate_bid_settlement_totals(settlements: &[Settlement]) -> BidSettlementTotals {
    let mut totals = BidSettlementTotals::default();
    let bidding_votes: HashSet<Pubkey> = settlements
        .iter()
        .filter(|s| matches!(s.reason, SettlementReason::Bidding))
        .map(|s| s.vote_account)
        .collect();
    for settlement in settlements {
        match (&settlement.reason, &settlement.details) {
            (SettlementReason::Bidding, Some(SettlementDetails::Bidding(value))) => {
                totals.stake += Decimal::from(value.total_marinade_active_stake)
                    + Decimal::from(value.total_marinade_redelegation_stake);
                totals.rewards += Decimal::from_str(&value.total_marinade_stakers_rewards)
                    .unwrap_or(Decimal::ZERO);
                totals.fees += Decimal::from(value.marinade_fee_claim + value.dao_fee_claim);
            }
            (SettlementReason::PriorityFee, Some(SettlementDetails::PriorityFee(value))) => {
                // Only use PriorityFee stake/rewards as fallback for validators where no
                // Bidding settlement was generated (active stakers earned nothing).
                if !bidding_votes.contains(&settlement.vote_account) {
                    totals.stake += Decimal::from(value.total_marinade_active_stake);
                    totals.rewards +=
                        Decimal::from_str(&value.activating_bid_claim).unwrap_or(Decimal::ZERO);
                }
                totals.fees += Decimal::from(value.marinade_fee_claim + value.dao_fee_claim);
            }
            _ => {}
        }
    }
    totals
}

/// Whether the bisection targets a minimum staker rate or a minimum SOL profit.
///
/// `TargetStakerPmpe`: keeps global post-fee PMPE at or above `target_pmpe`.
///   Phase 1 raises max_fee to the feasible ceiling; Phase 2 raises min_fee.
///
/// `TargetSolRevenue`: `target_pmpe` is derived from the SOL revenue target.
///   Bisection inverts — Phase 1 raises min_fee to the feasible floor; Phase 2
///   lowers max_fee to the lowest feasible value.
#[derive(PartialEq, Debug)]
pub enum BisectMode {
    TargetStakerPmpe,
    TargetSolRevenue,
}

/// Bisects the fee bounds to hit a fee target. See [`BisectMode`] for modes.
/// If the target can never be met, fallback settlements are returned.
#[allow(clippy::too_many_arguments)]
pub fn generate_bid_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &[ValidatorSamMeta],
    rewards_collection: &RewardsCollection,
    settlement_config: &SettlementConfig,
    fee_config: &FeeConfig,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    exiting_stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    // Staker PMPE floor. None = no constraint; bisection converges to max_fee_bps.
    target_pmpe: Option<Decimal>,
    // PSR + penalty payouts already committed this epoch — deducted from available fee budget.
    total_staker_extras: Decimal,
    // Bisection direction: TargetStakerPmpe tunes max_fee first; TargetSolRevenue tunes min_fee first.
    mode: BisectMode,
) -> anyhow::Result<BidSettlementValues> {
    let min_first = mode == BisectMode::TargetSolRevenue;
    let max_cap = fee_config.max_fee_bps;
    let min_cap = fee_config.min_fee_bps;

    // `current` is the active axis. `overshoot` tracks the best known-feasible
    // value, `undershoot` the best known-infeasible. PMPE mode probes climb (max
    // fee up) so feasible values are the floor; SOL Phase 1 also climbs (min fee
    // up). SOL Phase 2 inverts to find the lowest feasible max_fee.
    //
    // SOL mode inverts the bisection: Phase 1 raises min_fee (so tuning_max
    // starts false), Phase 2 lowers max_fee. Overshoot/undershoot start values
    // are also swapped.
    let mut overshoot = if min_first { max_cap } else { min_cap };
    let mut undershoot = if min_first { min_cap } else { max_cap };
    let mut current = undershoot;
    let mut tuning_max = !min_first;
    // adj_phase1 stores the Phase 1 result when switching to Phase 2.
    // In PMPE mode this is the max_fee result; in SOL mode the min_fee result.
    let mut adj_phase1 = overshoot;
    let mut best: Option<Vec<Settlement>> = None;
    let mut fallback: Option<Vec<Settlement>> = None;
    let mut fc = fee_config.clone();
    let target_pmpe = target_pmpe.unwrap_or(Decimal::ZERO);
    // Stake-account grouping depends only on the stake metas, not on the fee caps the
    // bisection mutates, so build it once instead of on every probe.
    let epoch = stake_meta_index.stake_meta_collection.epoch;
    let validator_groups: Vec<(&ValidatorSamMeta, Vec<StakerStakeGroup>)> = sam_validator_metas
        .iter()
        .filter_map(|v| {
            stake_meta_index
                .iter_grouped_stake_metas(&v.vote_account)
                .map(|grouped| (v, build_staker_stake_groups(grouped)))
        })
        .collect();
    for _ in 0..MAX_ADJ_ITER {
        if tuning_max {
            fc.max_fee_bps = current;
        } else {
            fc.min_fee_bps = current;
        }
        let settlements = generate_bid_settlements_worker(
            &validator_groups,
            epoch,
            rewards_collection,
            settlement_config,
            &fc,
            stake_authority_filter,
            exiting_stake_authority_filter,
            target_pmpe,
        )?;
        let totals = calculate_bid_settlement_totals(&settlements);
        let post_fee = if totals.stake.is_zero() {
            Decimal::ZERO
        } else {
            (totals.rewards + total_staker_extras - totals.fees) / totals.stake
                * Decimal::ONE_THOUSAND
        };
        let feasible = if totals.stake.is_zero() {
            false
        } else if min_first {
            post_fee <= target_pmpe
        } else {
            post_fee >= target_pmpe
        };
        if feasible {
            overshoot = current;
            best = Some(settlements);
        } else {
            undershoot = current;
            fallback = Some(settlements);
        }
        let next = (overshoot.saturating_add(undershoot) / 2).clamp(min_cap, max_cap);
        if next != current {
            info!(
                "Adjusted {}_fee_bps: {} -> {} (post_fee_pmpe {}, target_pmpe {}, fees {})",
                if tuning_max { "max" } else { "min" },
                current,
                next,
                post_fee,
                target_pmpe,
                totals.fees,
            );
            current = next;
            continue;
        }
        // Active axis converged. Check whether to switch to Phase 2.
        //
        // PMPE mode: max_fee pinned at feasible ceiling → leftover staker budget
        //            → raise min_fee.
        // SOL  mode: min_fee pinned at feasible floor   → target already met
        //            → lower max_fee.
        let at_extreme = current == if min_first { min_cap } else { max_cap };
        if feasible && at_extreme && (tuning_max != min_first) {
            adj_phase1 = current;
            tuning_max = !tuning_max;
            // Phase 2 bisection state. SOL Phase 2 finds the LOWEST feasible
            // max_fee, so overshoot/undershoot are inverted vs PMPE Phase 2.
            current = max_cap;
            overshoot = if min_first { max_cap } else { min_cap };
            undershoot = if min_first { min_cap } else { max_cap };
            info!(
                "{}_fee_bps converged at {adj_phase1}, switching to tuning {}_fee_bps",
                if min_first { "min" } else { "max" },
                if min_first { "max" } else { "min" },
            );
            continue;
        }
        break;
    }
    // overshoot → the active (just-tuned) side.
    // inactive side: Phase 1 result (adj_phase1) if Phase 2 ran, else original bound.
    let adj_max_fee_bps = if tuning_max {
        overshoot
    } else if min_first {
        fc.max_fee_bps
    } else {
        adj_phase1
    };
    let adj_min_fee_bps = if !tuning_max {
        overshoot
    } else if min_first {
        adj_phase1
    } else {
        fc.min_fee_bps
    };
    info!("adj_max_fee_bps: {adj_max_fee_bps}, adj_min_fee_bps: {adj_min_fee_bps}");
    Ok(BidSettlementValues {
        settlements: best.or(fallback).expect("MAX_ADJ_ITER = 0"),
        adj_max_fee_bps,
        adj_min_fee_bps,
    })
}
