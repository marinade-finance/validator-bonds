use crate::rewards::{RewardsCollection, VoteAccountRewards};
use crate::sam_meta::{AuctionValidatorValues, ValidatorSamMeta};
use crate::settlement_config::{FeeConfig, FeePercentages, SettlementConfig};
use anyhow::{anyhow, ensure};
use log::{debug, info, warn};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::Serialize;
use settlement_common::settlement_collection::{Settlement, SettlementClaim, SettlementReason};
use settlement_common::settlement_details::{
    BidSettlementDetails, PriorityFeeSettlementDetails, SettlementDetails,
};
use snapshot_parser_validator_cli::stake_meta::StakeMeta;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::fmt;
use std::ops::Mul;

use super::add_to_settlement_collection;

#[derive(Serialize, Debug, Default)]
pub struct ResultSettlementClaims {
    pub inflation_commission_claim: Decimal,
    pub mev_commission_claim: Decimal,
    pub block_commission_claim: Decimal,
    pub static_bid_claim: Decimal,
    pub activating_bid_claim: Decimal,
}

impl ResultSettlementClaims {
    pub fn sum(&self) -> Decimal {
        self.inflation_commission_claim
            .saturating_add(self.mev_commission_claim)
            .saturating_add(self.block_commission_claim)
            .saturating_add(self.static_bid_claim)
            .saturating_add(self.activating_bid_claim)
    }

    pub fn sum_u64(&self) -> anyhow::Result<u64> {
        self.sum()
            .to_u64()
            .ok_or_else(|| anyhow!("Failed to_u64 for total settlement claims: {}", self.sum()))
    }
}

impl fmt::Display for ResultSettlementClaims {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "static_bid_claim={}, activating_bid_claim={}, inflation_commission_claim={}, mev_commission_claim={}, block_commission_claim={}, total={}",
            self.static_bid_claim,
            self.activating_bid_claim,
            self.inflation_commission_claim,
            self.mev_commission_claim,
            self.block_commission_claim,
            self.sum()
        )
    }
}

pub(crate) struct StakerStakeGroup {
    withdraw_authority: Pubkey,
    stake_authority: Pubkey,
    active_accounts: HashMap<Pubkey, u64>,
    activating_accounts: HashMap<Pubkey, u64>,
    deactivating_lamports: u64,
}

#[derive(Default)]
struct StakeTotals {
    total_active: u64,
    marinade_active: u64,
    marinade_redelegation: u64,
    marinade_activating: u64,
}

struct MarinadeRewards {
    stake_share: Decimal,
    inflation: Decimal,
    mev: Decimal,
    block: Decimal,
}

struct StakerRewards {
    active_total: Decimal,
    inflation: Option<Decimal>,
    mev: Option<Decimal>,
    block: Option<Decimal>,
    bid: Option<Decimal>,
}

struct FeeSplit {
    settlement_claim_sum: u64,
    stakers_total_claim: u64,
    active_pool: u64,
    activating_pool: u64,
    marinade_fee: u64,
    dao_fee: u64,
    activating_fraction: Decimal,
}

#[derive(Clone, Copy)]
enum PoolKind {
    Active,
    Activating,
}

fn checked_fraction(numerator: Decimal, denominator: Decimal) -> Option<Decimal> {
    if denominator > Decimal::ZERO {
        Some(numerator / denominator)
    } else {
        None
    }
}

pub(crate) fn build_staker_stake_groups<'a>(
    grouped_stake_metas: impl Iterator<Item = (&'a (&'a Pubkey, &'a Pubkey), &'a Vec<&'a StakeMeta>)>,
) -> Vec<StakerStakeGroup> {
    grouped_stake_metas
        .map(|(&(withdraw_authority, stake_authority), metas)| {
            let active_accounts = metas
                .iter()
                .filter(|s| s.active_delegation_lamports > 0)
                .map(|s| (s.pubkey, s.active_delegation_lamports))
                .collect();
            let activating_accounts = metas
                .iter()
                .filter(|s| {
                    s.active_delegation_lamports == 0 && s.activating_delegation_lamports > 0
                })
                .map(|s| (s.pubkey, s.activating_delegation_lamports))
                .collect();
            StakerStakeGroup {
                withdraw_authority: *withdraw_authority,
                stake_authority: *stake_authority,
                active_accounts,
                activating_accounts,
                deactivating_lamports: metas
                    .iter()
                    .map(|s| s.deactivating_delegation_lamports)
                    .sum(),
            }
        })
        .collect()
}

fn compute_stake_totals(
    groups: &[StakerStakeGroup],
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    exiting_stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
) -> StakeTotals {
    let mut totals = StakeTotals::default();
    for group in groups {
        let active_sum: u64 = group.active_accounts.values().sum();
        totals.total_active += active_sum;
        if stake_authority_filter(&group.stake_authority) {
            totals.marinade_active += active_sum;
            if !exiting_stake_authority_filter(&group.stake_authority) {
                totals.marinade_redelegation += group.deactivating_lamports;
            }
            totals.marinade_activating += group.activating_accounts.values().sum::<u64>();
        }
    }
    totals
}

fn marinade_reward_shares(
    rewards: &VoteAccountRewards,
    totals: &StakeTotals,
    vote_account: &Pubkey,
) -> MarinadeRewards {
    let stake_share = if totals.total_active > 0 {
        Decimal::from(totals.marinade_active) / Decimal::from(totals.total_active)
    } else {
        Decimal::ZERO
    };
    debug!(
        "Validator {} marinade stake share: {stake_share}, total: {}, marinade stake: {}",
        vote_account, totals.total_active, totals.marinade_active
    );
    let inflation = Decimal::from(rewards.inflation_rewards).mul(stake_share);
    let mev = Decimal::from(rewards.mev_rewards).mul(stake_share);
    let block = Decimal::from(rewards.block_rewards).mul(stake_share);
    debug!(
        "Validator {vote_account} marinade rewards: inflation {inflation}, mev {mev}, block {block}"
    );
    MarinadeRewards {
        stake_share,
        inflation,
        mev,
        block,
    }
}

fn build_result_claims(
    validator: &ValidatorSamMeta,
    rewards: &VoteAccountRewards,
    mr: &MarinadeRewards,
    totals: &StakeTotals,
) -> (ResultSettlementClaims, Decimal) {
    let mut settlement_claim = ResultSettlementClaims::default();
    if let Some(AuctionValidatorValues {
        commissions: Some(commissions),
        ..
    }) = &validator.values
    {
        if let Some(in_bond) = commissions.inflation_commission_in_bond_dec {
            settlement_claim.inflation_commission_claim = mr.inflation.mul(commission_eff(
                rewards.realized_inflation_commission_dec(),
                in_bond,
            ));
        }
        if let Some(in_bond) = commissions.mev_commission_in_bond_dec {
            settlement_claim.mev_commission_claim = mr.mev.mul(commission_eff(
                rewards.realized_mev_commission_dec(),
                in_bond,
            ));
        }
        if let Some(in_bond) = commissions.block_rewards_commission_in_bond_dec {
            settlement_claim.block_commission_claim = mr.block.mul(commission_eff(
                rewards.realized_block_commission_dec(),
                in_bond,
            ));
        }
    }

    // The Marinade minimum fee must be at least the percentage derived from the rewards portion promised to stakers (what totalPmpe represents).
    // Based on the promised commission, we recalculate the stakers total share from the rewards earned in the previous epoch.
    let auction_effective_static_bid = validator
        .rev_share
        .auction_effective_static_bid_pmpe
        .unwrap_or(validator.effective_bid);
    // bid per mille, dividing by 1000 gives the ratio per unit - whatever SOL, lamport, etc., since it represents a ratio
    let effective_static_bid = auction_effective_static_bid / Decimal::ONE_THOUSAND;
    settlement_claim.static_bid_claim =
        Decimal::from(totals.marinade_active) * effective_static_bid;
    if let Some(activating_stake_pmpe) = validator.rev_share.activating_stake_pmpe {
        settlement_claim.activating_bid_claim = Decimal::from(totals.marinade_activating)
            * activating_stake_pmpe
            / Decimal::ONE_THOUSAND;
    }
    (settlement_claim, auction_effective_static_bid)
}

fn staker_rewards_breakdown(
    validator: &ValidatorSamMeta,
    mr: &MarinadeRewards,
    result_claims: &ResultSettlementClaims,
    totals: &StakeTotals,
) -> StakerRewards {
    if let Some(AuctionValidatorValues {
        commissions: Some(commissions),
        ..
    }) = &validator.values
    {
        let staker_inflation_rewards =
            mr.inflation * (Decimal::ONE - commissions.inflation_commission_dec);
        let staker_mev_rewards = mr.mev * (Decimal::ONE - commissions.mev_commission_dec);
        let staker_block_rewards =
            mr.block * (Decimal::ONE - commissions.block_rewards_commission_dec);
        let staker_bid_rewards = result_claims.static_bid_claim;
        let active_total = staker_inflation_rewards
            + staker_mev_rewards
            + staker_block_rewards
            + staker_bid_rewards;
        StakerRewards {
            active_total,
            inflation: Some(staker_inflation_rewards),
            mev: Some(staker_mev_rewards),
            block: Some(staker_block_rewards),
            bid: Some(staker_bid_rewards),
        }
    } else {
        let total_rev_share = validator.rev_share.total_pmpe / Decimal::ONE_THOUSAND;
        let active_total = Decimal::from(totals.marinade_active) * total_rev_share;
        StakerRewards {
            active_total,
            inflation: None,
            mev: None,
            block: None,
            bid: None,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn split_distributor_fee(
    result_claims: &ResultSettlementClaims,
    total_marinade_stakers_rewards: Decimal,
    totals: &StakeTotals,
    fee_percentages: &FeePercentages,
    target_pmpe: Decimal,
    vote_account: &Pubkey,
) -> anyhow::Result<FeeSplit> {
    let effective_fee = if total_marinade_stakers_rewards > Decimal::ZERO
        && (totals.marinade_active + totals.marinade_redelegation) > 0
    {
        let staker_yield_pmpe = total_marinade_stakers_rewards
            / (Decimal::from(totals.marinade_active) + Decimal::from(totals.marinade_redelegation))
            * Decimal::ONE_THOUSAND;
        let fee_cap = (Decimal::ONE - target_pmpe / staker_yield_pmpe).max(Decimal::ZERO);
        fee_cap.clamp(fee_percentages.min_fee, fee_percentages.max_fee)
    } else {
        fee_percentages.max_fee
    };
    info!(
        "{} effective fee: {} (configured: {}, min: {}, target_pmpe: {})",
        vote_account, effective_fee, fee_percentages.max_fee, fee_percentages.min_fee, target_pmpe,
    );
    let minimum_distributor_fee_claim = total_marinade_stakers_rewards * effective_fee;
    let distributor_fee_claim = minimum_distributor_fee_claim
        .min(result_claims.sum())
        .to_u64()
        .ok_or_else(|| anyhow!("Failed to_u64 for distributor_fee_claim"))?;

    // minimum is 0 when distributor fee is of amount of total (stakers get nothing)
    let settlement_claim_sum = result_claims.sum_u64()?;
    let stakers_total_claim = settlement_claim_sum.saturating_sub(distributor_fee_claim);
    // Split stakers_total_claim between active stakers (earned rewards + static bid)
    // and activating stakers (activating charge), proportional to each pool's share.
    let activating_fraction =
        checked_fraction(result_claims.activating_bid_claim, result_claims.sum())
            .unwrap_or(Decimal::ZERO);
    let activating_pool: u64 = (Decimal::from(stakers_total_claim) * activating_fraction)
        .to_u64()
        .unwrap_or(0);
    let active_pool = stakers_total_claim.saturating_sub(activating_pool);
    let dao_fee = (Decimal::from(distributor_fee_claim) * fee_percentages.dao_fee_share)
        .to_u64()
        .ok_or_else(|| anyhow!("Failed to_u64 for dao_fee_claim"))?;
    let marinade_fee = distributor_fee_claim - dao_fee;
    ensure!(
        settlement_claim_sum == stakers_total_claim + marinade_fee + dao_fee,
        "Settlement claim sum {settlement_claim_sum} != stakers {stakers_total_claim} + marinade fee {marinade_fee} + dao fee {dao_fee} for validator {vote_account}"
    );
    Ok(FeeSplit {
        settlement_claim_sum,
        stakers_total_claim,
        active_pool,
        activating_pool,
        marinade_fee,
        dao_fee,
        activating_fraction,
    })
}

fn distribute_pool(
    groups: &[StakerStakeGroup],
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    kind: PoolKind,
    pool: u64,
    pool_total: u64,
    vote_account: &Pubkey,
) -> anyhow::Result<(Vec<SettlementClaim>, u64)> {
    let mut claims = vec![];
    let mut amount = 0u64;
    if pool_total == 0 || pool == 0 {
        return Ok((claims, amount));
    }
    for group in groups {
        if !stake_authority_filter(&group.stake_authority) {
            continue;
        }
        let accounts = match kind {
            PoolKind::Active => &group.active_accounts,
            PoolKind::Activating => &group.activating_accounts,
        };
        let sum: u64 = accounts.values().sum();
        if sum == 0 {
            continue;
        }
        let staker_share = Decimal::from(sum) / Decimal::from(pool_total);
        let claim_amount =
            (staker_share * Decimal::from(pool))
                .to_u64()
                .ok_or_else(|| match kind {
                    PoolKind::Active => anyhow!(
                        "claim_amount is not representable as u64 for validator {vote_account}"
                    ),
                    PoolKind::Activating => anyhow!(
                    "activating claim_amount not representable as u64 for validator {vote_account}"
                ),
                })?;
        if claim_amount > 0 {
            let (active_stake, activating_stake) = match kind {
                PoolKind::Active => (sum, 0),
                PoolKind::Activating => (0, sum),
            };
            claims.push(SettlementClaim::staker_payout(
                group.withdraw_authority,
                group.stake_authority,
                active_stake,
                activating_stake,
                claim_amount,
                accounts.clone(),
            ));
            amount += claim_amount;
        }
    }
    Ok((claims, amount))
}

fn split_by_fraction(amount: u64, fraction: Decimal) -> (u64, u64) {
    let priority = (Decimal::from(amount) * fraction).to_u64().unwrap_or(0);
    (priority, amount.saturating_sub(priority))
}

fn push_fee_deposit(
    claims: &mut Vec<SettlementClaim>,
    claims_amount: &mut u64,
    withdraw: Pubkey,
    stake: Pubkey,
    amount: u64,
) {
    if amount > 0 {
        claims.push(SettlementClaim::fee_deposit(withdraw, stake, amount));
        *claims_amount += amount;
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn generate_bid_settlements_worker(
    validator_groups: &[(&ValidatorSamMeta, Vec<StakerStakeGroup>)],
    epoch: u64,
    rewards_collection: &RewardsCollection,
    settlement_config: &SettlementConfig,
    fee_config: &FeeConfig,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    exiting_stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    target_pmpe: Decimal,
) -> anyhow::Result<Vec<Settlement>> {
    info!("Generating bid settlements in epoch {epoch}...");
    let fee_percentages = fee_config.fee_percentages();
    let authorities = fee_config.fee_authorities();
    let funder = settlement_config.meta().funder.clone();
    let mut settlement_claim_collections = vec![];

    for (validator, staker_stake_groups) in validator_groups {
        let validator = *validator;
        let totals = compute_stake_totals(
            staker_stake_groups,
            stake_authority_filter,
            exiting_stake_authority_filter,
        );
        // Marinade stake is a subset of total stake, so this covers both zero-stake cases.
        if totals.marinade_active == 0 && totals.marinade_activating == 0 {
            warn!(
                "Skipping validator {} with zero marinade active and activating stake",
                validator.vote_account
            );
            continue;
        }

        let rewards = if let Some(rewards) = rewards_collection.get(&validator.vote_account) {
            rewards
        } else {
            // This may happen correctly if the validator had no rewards in the epoch with 0 credits
            warn!(
                "No rewards found for validator {} in epoch {}, setting nothing.",
                validator.vote_account, epoch
            );
            &VoteAccountRewards {
                vote_account: validator.vote_account,
                ..VoteAccountRewards::default()
            }
        };

        let mr = marinade_reward_shares(rewards, &totals, &validator.vote_account);
        let (settlement_claim, auction_effective_static_bid) =
            build_result_claims(validator, rewards, &mr, &totals);
        let sr = staker_rewards_breakdown(validator, &mr, &settlement_claim, &totals);
        let total_marinade_stakers_rewards =
            sr.active_total + settlement_claim.activating_bid_claim;
        info!(
            "{} total stakers rewards: {} (inflation: {:?}, mev: {:?}, block: {:?}, bid: {:?}), claims: {}",
            validator.vote_account,
            total_marinade_stakers_rewards,
            mr.inflation,
            mr.mev,
            mr.block,
            sr.bid,
            settlement_claim
        );

        let fee = split_distributor_fee(
            &settlement_claim,
            total_marinade_stakers_rewards,
            &totals,
            &fee_percentages,
            target_pmpe,
            &validator.vote_account,
        )?;

        let (mut bidding_claims, mut bidding_claims_amount) = distribute_pool(
            staker_stake_groups,
            stake_authority_filter,
            PoolKind::Active,
            fee.active_pool,
            totals.marinade_active,
            &validator.vote_account,
        )?;
        let (mut priority_fee_claims, mut priority_fee_claims_amount) = distribute_pool(
            staker_stake_groups,
            stake_authority_filter,
            PoolKind::Activating,
            fee.activating_pool,
            totals.marinade_activating,
            &validator.vote_account,
        )?;
        ensure!(
            bidding_claims_amount + priority_fee_claims_amount <= fee.stakers_total_claim,
            "Claims amount {} exceeded stakers total claim {} for validator {}",
            bidding_claims_amount + priority_fee_claims_amount,
            fee.stakers_total_claim,
            validator.vote_account
        );

        // Split fee claims proportionally between active and activating pools
        let activating_fee_fraction = checked_fraction(
            Decimal::from(fee.activating_pool),
            Decimal::from(fee.stakers_total_claim),
        )
        .unwrap_or(if fee.settlement_claim_sum > 0 {
            fee.activating_fraction
        } else {
            Decimal::ZERO
        });
        let (marinade_fee_for_priority, marinade_fee_for_bidding) =
            split_by_fraction(fee.marinade_fee, activating_fee_fraction);
        let (dao_fee_for_priority, dao_fee_for_bidding) =
            split_by_fraction(fee.dao_fee, activating_fee_fraction);

        push_fee_deposit(
            &mut bidding_claims,
            &mut bidding_claims_amount,
            authorities.marinade_withdraw,
            authorities.marinade_stake,
            marinade_fee_for_bidding,
        );
        push_fee_deposit(
            &mut bidding_claims,
            &mut bidding_claims_amount,
            authorities.dao_withdraw,
            authorities.dao_stake,
            dao_fee_for_bidding,
        );
        ensure!(
            bidding_claims_amount <= fee.settlement_claim_sum,
            "The sum of bidding claims {} exceeds the total claim amount {} after adding bidding fees for validator {}",
            bidding_claims_amount,
            fee.settlement_claim_sum,
            validator.vote_account
        );
        push_fee_deposit(
            &mut priority_fee_claims,
            &mut priority_fee_claims_amount,
            authorities.marinade_withdraw,
            authorities.marinade_stake,
            marinade_fee_for_priority,
        );
        push_fee_deposit(
            &mut priority_fee_claims,
            &mut priority_fee_claims_amount,
            authorities.dao_withdraw,
            authorities.dao_stake,
            dao_fee_for_priority,
        );
        ensure!(
            bidding_claims_amount + priority_fee_claims_amount <= fee.settlement_claim_sum,
            "The sum of total claims {} exceeds the total claim amount {} after adding priority fees for validator {}",
            bidding_claims_amount + priority_fee_claims_amount,
            fee.settlement_claim_sum,
            validator.vote_account
        );

        let settlement_details = BidSettlementDetails {
            total_active_stake: totals.total_active,
            total_marinade_active_stake: totals.marinade_active,
            total_marinade_redelegation_stake: totals.marinade_redelegation,
            auction_effective_static_bid: auction_effective_static_bid.to_string(),
            marinade_stake_share: mr.stake_share.to_string(),
            marinade_inflation_rewards: mr.inflation.to_string(),
            marinade_mev_rewards: mr.mev.to_string(),
            marinade_block_rewards: mr.block.to_string(),
            staker_inflation_rewards: sr.inflation.map(|d| d.to_string()),
            staker_mev_rewards: sr.mev.map(|d| d.to_string()),
            staker_block_rewards: sr.block.map(|d| d.to_string()),
            staker_bid_rewards: sr.bid.map(|d| d.to_string()),
            total_marinade_stakers_rewards: total_marinade_stakers_rewards.to_string(),
            settlement_claims: serde_json::to_value(&settlement_claim)?,
            stakers_total_claim: fee.stakers_total_claim,
            marinade_fee_claim: marinade_fee_for_bidding,
            dao_fee_claim: dao_fee_for_bidding,
        };
        let priority_fee_details = PriorityFeeSettlementDetails {
            total_marinade_active_stake: totals.marinade_active,
            total_marinade_activating_stake: totals.marinade_activating,
            activating_stake_pmpe: validator
                .rev_share
                .activating_stake_pmpe
                .unwrap_or(Decimal::ZERO)
                .to_string(),
            activating_bid_claim: settlement_claim.activating_bid_claim.to_string(),
            activating_stakers_pool: fee.activating_pool,
            marinade_fee_claim: marinade_fee_for_priority,
            dao_fee_claim: dao_fee_for_priority,
        };
        add_to_settlement_collection(
            &mut settlement_claim_collections,
            priority_fee_claims,
            priority_fee_claims_amount,
            SettlementReason::PriorityFee,
            validator.vote_account,
            funder.clone(),
            Some(SettlementDetails::PriorityFee(priority_fee_details)),
        );
        add_to_settlement_collection(
            &mut settlement_claim_collections,
            bidding_claims,
            bidding_claims_amount,
            SettlementReason::Bidding,
            validator.vote_account,
            funder.clone(),
            Some(SettlementDetails::Bidding(Box::new(settlement_details))),
        );
    }
    Ok(settlement_claim_collections)
}

// effective rate of the realized commission from snapshot rewards above the in-bond promise; the auction-time sam-meta value misses commission raised after the auction snapshot
fn commission_eff(
    commission_realized_dec: Option<Decimal>,
    commission_in_bond_dec: Decimal,
) -> Decimal {
    match commission_realized_dec {
        Some(realized) if realized > commission_in_bond_dec => realized - commission_in_bond_dec,
        _ => Decimal::ZERO,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;
    use settlement_common::settlement_collection::ClaimDetail;

    fn pk(b: u8) -> Pubkey {
        Pubkey::new_from_array([b; 32])
    }

    fn group(
        stake_authority: Pubkey,
        active: &[(Pubkey, u64)],
        activating: &[(Pubkey, u64)],
        deactivating_lamports: u64,
    ) -> StakerStakeGroup {
        StakerStakeGroup {
            withdraw_authority: pk(99),
            stake_authority,
            active_accounts: active.iter().copied().collect(),
            activating_accounts: activating.iter().copied().collect(),
            deactivating_lamports,
        }
    }

    #[test]
    fn split_by_fraction_zero_full_and_rounding() {
        assert_eq!(split_by_fraction(100, Decimal::ZERO), (0, 100));
        assert_eq!(split_by_fraction(100, Decimal::ONE), (100, 0));
        assert_eq!(split_by_fraction(101, dec!(0.5)), (50, 51));
    }

    #[test]
    fn distribute_pool_zero_pool_returns_empty() {
        let groups = vec![group(pk(1), &[(pk(10), 100)], &[], 0)];
        let (claims, amount) =
            distribute_pool(&groups, &|_| true, PoolKind::Active, 0, 100, &pk(1)).unwrap();
        assert!(claims.is_empty());
        assert_eq!(amount, 0);

        let (claims, amount) =
            distribute_pool(&groups, &|_| true, PoolKind::Active, 50, 0, &pk(1)).unwrap();
        assert!(claims.is_empty());
        assert_eq!(amount, 0);
    }

    #[test]
    fn distribute_pool_active_vs_activating_field_positions() {
        let groups = vec![group(pk(1), &[(pk(10), 100)], &[(pk(11), 200)], 0)];

        let (active_claims, active_amount) =
            distribute_pool(&groups, &|_| true, PoolKind::Active, 100, 100, &pk(1)).unwrap();
        assert_eq!(active_amount, 100);
        assert_eq!(active_claims.len(), 1);
        match &active_claims[0].detail {
            ClaimDetail::StakerPayout {
                active_stake,
                activating_stake,
                ..
            } => {
                assert_eq!(*active_stake, 100);
                assert_eq!(*activating_stake, 0);
            }
            other => panic!("expected StakerPayout, got {other:?}"),
        }

        let (activating_claims, activating_amount) =
            distribute_pool(&groups, &|_| true, PoolKind::Activating, 200, 200, &pk(1)).unwrap();
        assert_eq!(activating_amount, 200);
        assert_eq!(activating_claims.len(), 1);
        match &activating_claims[0].detail {
            ClaimDetail::StakerPayout {
                active_stake,
                activating_stake,
                ..
            } => {
                assert_eq!(*active_stake, 0);
                assert_eq!(*activating_stake, 200);
            }
            other => panic!("expected StakerPayout, got {other:?}"),
        }
    }

    #[test]
    fn compute_stake_totals_exiting_authority_excluded() {
        let exiting = pk(1);
        let normal = pk(2);
        let groups = vec![
            group(normal, &[(pk(10), 100)], &[], 50),
            group(exiting, &[(pk(11), 200)], &[], 70),
        ];
        let totals = compute_stake_totals(&groups, &|_| true, &|p| *p == exiting);
        assert_eq!(totals.marinade_active, 300);
        // exiting authority's deactivating lamports are excluded from redelegation
        assert_eq!(totals.marinade_redelegation, 50);
    }

    #[test]
    fn compute_stake_totals_non_marinade_counts_total_only() {
        let marinade = pk(1);
        let other = pk(2);
        let groups = vec![
            group(marinade, &[(pk(10), 100)], &[(pk(20), 10)], 0),
            group(other, &[(pk(11), 400)], &[(pk(21), 40)], 0),
        ];
        let totals = compute_stake_totals(&groups, &|p| *p == marinade, &|_| false);
        assert_eq!(totals.total_active, 500);
        assert_eq!(totals.marinade_active, 100);
        assert_eq!(totals.marinade_activating, 10);
    }
}
