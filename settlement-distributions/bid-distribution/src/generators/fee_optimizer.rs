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

/// Bisects max_fee_bps (min_fee at min_cap) for the highest fee that keeps global
/// post-fee PMPE (bid + `total_staker_extras`, i.e. penalty + PSR payouts to
/// stakers) at or above the target (`ssr_pmpe + min_yield_premium`). If max_fee
/// pins at max_cap
/// with post-fee still above target there is leftover staker budget — a second
/// phase raises min_fee to extract it. If the target can never be met, min_cap
/// settlements are returned.
#[allow(clippy::too_many_arguments)]
pub fn generate_bid_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &[ValidatorSamMeta],
    rewards_collection: &RewardsCollection,
    settlement_config: &SettlementConfig,
    fee_config: &FeeConfig,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    exiting_stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    ssr_pmpe: Decimal,
    total_staker_extras: Decimal,
) -> anyhow::Result<BidSettlementValues> {
    let max_cap = fee_config.max_fee_bps;
    let min_cap = fee_config.min_fee_bps;
    let target = ssr_pmpe + fee_config.min_yield_premium_over_ssr_pmpe;
    // `current` is the active axis: max_fee_bps, then min_fee_bps once max pins at
    // the feasible ceiling. `overshoot` is its highest known-feasible value,
    // `undershoot` the lowest known-infeasible. Feasible probes only climb, so the
    // last feasible probe is the highest-fee one.
    let mut current = max_cap;
    let mut overshoot = min_cap;
    let mut undershoot = max_cap;
    let mut tuning_max = true;
    let mut adj_max = min_cap;
    let mut best: Option<Vec<Settlement>> = None;
    let mut fallback: Option<Vec<Settlement>> = None;
    let mut fc = fee_config.clone();
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
            ssr_pmpe,
        )?;
        let totals = calculate_bid_settlement_totals(&settlements);
        let (post_fee, feasible) = if totals.stake.is_zero() {
            (Decimal::ZERO, false)
        } else {
            let post_fee_pmpe = (totals.rewards + total_staker_extras - totals.fees) / totals.stake
                * Decimal::ONE_THOUSAND;
            (post_fee_pmpe, target <= post_fee_pmpe)
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
                "Adjusted {}_fee_bps: {} -> {} (post_fee_pmpe {}, target {})",
                if tuning_max { "max" } else { "min" },
                current,
                next,
                post_fee,
                target,
            );
            current = next;
            continue;
        }
        // Active axis converged. If max_fee pinned at the feasible ceiling there is
        // leftover budget; switch to raising min_fee. Otherwise done.
        if tuning_max && feasible && current == max_cap {
            adj_max = current;
            tuning_max = false;
            current = max_cap;
            overshoot = min_cap;
            undershoot = max_cap;
            continue;
        }
        break;
    }
    Ok(BidSettlementValues {
        settlements: best.or(fallback).expect("MAX_ADJ_ITER = 0"),
        adj_max_fee_bps: if tuning_max { overshoot } else { adj_max },
        adj_min_fee_bps: if tuning_max {
            fc.min_fee_bps
        } else {
            overshoot
        },
    })
}
