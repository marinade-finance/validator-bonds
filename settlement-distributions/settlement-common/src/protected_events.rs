use crate::leader_schedule::LeaderSlots;
use crate::revenue_expectation_meta::{RevenueExpectationMeta, RevenueExpectationMetaCollection};
use crate::settlement_config::SettlementConfig;
use crate::utils::bps_decimal;
use anyhow::{ensure, Context};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

const MAX_VAT_UNADMITTED_STAKE_BPS: u128 = 100;

use {
    crate::utils::{bps, bps_to_fraction},
    log::{debug, info, warn},
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    snapshot_parser_validator_cli::{
        inflation_rewards_points::AlpenglowEpochType,
        validator_meta::{ValidatorMeta, ValidatorMetaCollection},
    },
    solana_sdk::pubkey::Pubkey,
    std::collections::{HashMap, HashSet},
};

// serde-float makes these Decimals serialize as JSON numbers, not utoipa's default string.
#[derive(Clone, Deserialize, Serialize, Debug, utoipa::ToSchema)]
pub enum ProtectedEvent {
    DowntimeRevenueImpact {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        actual_credits: u64,
        expected_credits: u64,
        /// how many lamports per 1 staked lamport was expected to be paid by validator
        #[schema(value_type = f64)]
        expected_epr: Decimal,
        #[schema(value_type = f64)]
        actual_epr: Decimal,
        epr_loss_bps: u64,
        stake: u64,
    },
    CommissionSamIncrease {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        #[schema(value_type = f64)]
        expected_inflation_commission: Decimal,
        #[schema(value_type = f64)]
        actual_inflation_commission: Decimal,
        #[schema(value_type = f64)]
        past_inflation_commission: Decimal,
        #[schema(value_type = Option<f64>)]
        expected_mev_commission: Option<Decimal>,
        #[schema(value_type = Option<f64>)]
        actual_mev_commission: Option<Decimal>,
        #[schema(value_type = Option<f64>)]
        past_mev_commission: Option<Decimal>,
        #[schema(value_type = f64)]
        before_sam_commission_increase_pmpe: Decimal,
        #[schema(value_type = f64)]
        expected_epr: Decimal,
        #[schema(value_type = f64)]
        actual_epr: Decimal,
        epr_loss_bps: u64,
        stake: u64,
    },
    /// SIMD-0357: the validator voted, but its stakers got no inflation rewards
    VatUnadmitted {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        actual_credits: u64,
        #[schema(value_type = f64)]
        expected_epr: Decimal,
        #[schema(value_type = f64)]
        actual_epr: Decimal,
        epr_loss_bps: u64,
        stake: u64,
        inflation_rewards_admitted: Option<bool>,
    },

    // V1 events (before SAM was introduced) for backward compatibility to parse JSONs
    CommissionIncrease {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        previous_commission: u8,
        current_commission: u8,
        #[schema(value_type = f64)]
        expected_epr: Decimal,
        #[schema(value_type = f64)]
        actual_epr: Decimal,
        epr_loss_bps: u64,
        #[schema(value_type = f64)]
        stake: Decimal,
    },
    LowCredits {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        expected_credits: u64,
        actual_credits: u64,
        commission: u8,
        #[schema(value_type = f64)]
        expected_epr: Decimal,
        #[schema(value_type = f64)]
        actual_epr: Decimal,
        epr_loss_bps: u64,
        #[schema(value_type = f64)]
        stake: Decimal,
    },
}

impl ProtectedEvent {
    pub fn vote_account(&self) -> &Pubkey {
        match self {
            ProtectedEvent::DowntimeRevenueImpact { vote_account, .. } => vote_account,
            ProtectedEvent::CommissionSamIncrease { vote_account, .. } => vote_account,
            ProtectedEvent::VatUnadmitted { vote_account, .. } => vote_account,
            ProtectedEvent::CommissionIncrease { vote_account, .. } => vote_account,
            ProtectedEvent::LowCredits { vote_account, .. } => vote_account,
        }
    }
    pub fn expected_epr(&self) -> Decimal {
        *match self {
            ProtectedEvent::DowntimeRevenueImpact { expected_epr, .. } => expected_epr,
            ProtectedEvent::CommissionSamIncrease { expected_epr, .. } => expected_epr,
            ProtectedEvent::VatUnadmitted { expected_epr, .. } => expected_epr,
            ProtectedEvent::CommissionIncrease { expected_epr, .. } => expected_epr,
            ProtectedEvent::LowCredits { expected_epr, .. } => expected_epr,
        }
    }

    fn claim_per_stake(&self, cfg: &SettlementConfig) -> Decimal {
        use crate::settlement_config::SettlementConfigKind;
        match self {
            ProtectedEvent::CommissionSamIncrease {
                actual_inflation_commission,
                actual_mev_commission,
                expected_epr,
                actual_epr,
                ..
            } => {
                let base_cps = expected_epr - actual_epr;
                match &cfg.kind {
                    SettlementConfigKind::CommissionSamIncreaseSettlement {
                        base_markup_bps,
                        penalty_markup_bps,
                        extra_penalty_threshold_bps,
                        ..
                    } => {
                        let threshold = bps_to_fraction(*extra_penalty_threshold_bps);
                        let markup = if *actual_inflation_commission <= threshold
                            && actual_mev_commission.unwrap_or(Decimal::ZERO) <= threshold
                        {
                            *base_markup_bps
                        } else {
                            *penalty_markup_bps
                        };
                        base_cps + base_cps * bps_to_fraction(markup)
                    }
                    _ => {
                        panic!("Can not process CommissionSamIncrease settlement with wrong config: {cfg:?}")
                    }
                }
            }
            ProtectedEvent::DowntimeRevenueImpact {
                expected_epr,
                actual_epr,
                ..
            }
            | ProtectedEvent::VatUnadmitted {
                expected_epr,
                actual_epr,
                ..
            } => expected_epr - actual_epr,
            non_implemented => {
                panic!("Claim per stake is not implemented for event {non_implemented:?}")
            }
        }
    }

    pub fn claim_amount_in_loss_range(
        &self,
        cfg: &SettlementConfig,
        stake: u64,
    ) -> anyhow::Result<u64> {
        let range_bps = cfg.kind.covered_range_bps();
        let lower_bps = range_bps[0];
        let upper_bps = range_bps[1];

        let max_claim_per_stake = bps_to_fraction(upper_bps) * self.expected_epr();
        let ignored_claim_per_stake = bps_to_fraction(lower_bps) * self.expected_epr();
        let claim_per_stake =
            self.claim_per_stake(cfg).min(max_claim_per_stake) - ignored_claim_per_stake;

        let amount = (Decimal::from(stake) * claim_per_stake).max(Decimal::ZERO);
        amount.to_u64().with_context(|| {
            format!("claim_amount_in_loss_range: cannot convert {amount} to u64 (stake={stake})")
        })
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct ProtectedEventCollection {
    pub epoch: u64,
    pub slot: u64,
    pub events: Vec<ProtectedEvent>,
}

// ds-sam hands over float sums, so a shortfall below this is rounding noise, not a commission increase.
const COMMISSION_INCREASE_TOLERANCE_PMPE: Decimal = dec!(0.000000000001);

pub fn collect_commission_increase_events(
    validator_meta_collection: &ValidatorMetaCollection,
    revenue_expectation_map: &HashMap<Pubkey, RevenueExpectationMeta>,
) -> Vec<ProtectedEvent> {
    info!("Collecting commission increase events...");
    validator_meta_collection
        .validator_metas
        .iter()
        .filter(|v| v.stake > 0)
        .cloned()
        .filter_map(|ValidatorMeta {vote_account, stake, ..}| {
            let revenue_expectation = revenue_expectation_map.get(&vote_account);

            if let Some(revenue_expectation) = revenue_expectation {
                let expected_commission_pmpe = revenue_expectation.expected_non_bid_pmpe + revenue_expectation.before_sam_commission_increase_pmpe;
                if expected_commission_pmpe - revenue_expectation.actual_non_bid_pmpe > COMMISSION_INCREASE_TOLERANCE_PMPE {
                    debug!(
                        "Validator {vote_account} increased commission, expected non bid: {}, actual non bid: {}, no bid commission increase: {}",
                        revenue_expectation.expected_non_bid_pmpe,
                        revenue_expectation.actual_non_bid_pmpe,
                        revenue_expectation.before_sam_commission_increase_pmpe
                    );
                    Some(
                        ProtectedEvent::CommissionSamIncrease {
                            vote_account,
                            expected_inflation_commission: revenue_expectation.expected_inflation_commission,
                            past_inflation_commission: revenue_expectation.past_inflation_commission,
                            actual_inflation_commission: revenue_expectation.actual_inflation_commission,
                            expected_mev_commission: revenue_expectation.expected_mev_commission,
                            actual_mev_commission: revenue_expectation.actual_mev_commission,
                            past_mev_commission: revenue_expectation.past_mev_commission,
                            before_sam_commission_increase_pmpe: revenue_expectation.before_sam_commission_increase_pmpe,
                            // expected_non_bid_pmpe is what how many SOLs was expected to gain per 1000 of staked SOLs
                            // expected_epr is ratio of how many SOLS to pay for 1 staked SOL (it does not matter if in lamports or SOLs when ratio)
                            expected_epr: expected_commission_pmpe / dec!(1000),
                            actual_epr: revenue_expectation.actual_non_bid_pmpe / dec!(1000),
                            epr_loss_bps: bps_decimal(
                                expected_commission_pmpe - revenue_expectation.actual_non_bid_pmpe,
                                expected_commission_pmpe
                            ),
                            stake,
                        },
                    )
                } else {
                    debug!("Validator {vote_account} has not increased commission");
                    None
                }
            } else {
                debug!("Revenue expectation data not found for validator {vote_account}");
                None
            }

        })
        .collect()
}

fn epoch_type(validator_meta_collection: &ValidatorMetaCollection) -> AlpenglowEpochType {
    validator_meta_collection
        .alpenglow_epoch_type
        .unwrap_or(AlpenglowEpochType::Tower)
}

pub fn applied_commission_bps(validator_meta: &ValidatorMeta) -> u16 {
    validator_meta
        .inflation_rewards_commission_bps
        .unwrap_or(validator_meta.commission as u16 * 100)
}

/// (actual, expected) credits per vote account; Alpenglow credits are lamports, not vote credits
fn expected_credits(
    validator_meta_collection: &ValidatorMetaCollection,
    leader_slots: Option<&LeaderSlots>,
) -> anyhow::Result<HashMap<Pubkey, (u64, u64)>> {
    match epoch_type(validator_meta_collection) {
        AlpenglowEpochType::Tower => {
            let mut total_stake_weighted_credits: u128 = 0;
            let mut total_stake: u128 = 0;
            for meta in &validator_meta_collection.validator_metas {
                let credits = meta.credits.with_context(|| {
                    format!(
                        "Validator {} has no credits in a Tower epoch",
                        meta.vote_account
                    )
                })?;
                total_stake_weighted_credits += credits as u128 * meta.stake as u128;
                total_stake += meta.stake as u128;
            }
            let expected = (total_stake_weighted_credits / total_stake) as u64;
            Ok(validator_meta_collection
                .validator_metas
                .iter()
                .map(|meta| {
                    (
                        meta.vote_account,
                        (meta.credits.expect("checked above"), expected),
                    )
                })
                .collect())
        }
        AlpenglowEpochType::Migration => {
            unreachable!("the caller returns early for the migration epoch")
        }
        AlpenglowEpochType::Alpenglow => {
            let leader_slots = leader_slots.with_context(|| {
                format!(
                    "Alpenglow epoch {} needs the leader schedule to expect credits",
                    validator_meta_collection.epoch
                )
            })?;
            let epoch_total_stake = validator_meta_collection
                .epoch_total_stake
                .filter(|s| *s > 0)
                .with_context(|| {
                    format!(
                        "Alpenglow epoch {} has no epoch_total_stake",
                        validator_meta_collection.epoch
                    )
                })? as u128;
            let total_slots = leader_slots.total_slots as u128;
            // w = s/S + L/N scaled by S·N is an integer, so the floor of w·Σcredits/Σw is exact
            let mut scaled_weights: Vec<(&ValidatorMeta, u128)> = vec![];
            let mut total_credits: u128 = 0;
            let mut total_scaled_weight: u128 = 0;
            for meta in &validator_meta_collection.validator_metas {
                let Some(epoch_stake) = meta.epoch_stake else {
                    continue;
                };
                let slots = *leader_slots
                    .per_vote_account
                    .get(&meta.vote_account)
                    .unwrap_or(&0) as u128;
                let scaled_weight = epoch_stake as u128 * total_slots + slots * epoch_total_stake;
                scaled_weights.push((meta, scaled_weight));
                total_credits += meta.alpenglow_credits.unwrap_or(0) as u128;
                total_scaled_weight += scaled_weight;
            }
            scaled_weights
                .into_iter()
                .map(|(meta, scaled_weight)| {
                    let expected = scaled_weight
                        .checked_mul(total_credits)
                        .with_context(|| {
                            format!("Expected credits of {} overflow u128", meta.vote_account)
                        })?
                        .checked_div(total_scaled_weight)
                        .unwrap_or(0);
                    Ok((
                        meta.vote_account,
                        (
                            meta.alpenglow_credits.unwrap_or(0),
                            u64::try_from(expected)?,
                        ),
                    ))
                })
                .collect()
        }
    }
}

pub fn collect_downtime_revenue_impact_events(
    validator_meta_collection: &ValidatorMetaCollection,
    revenue_expectation_map: &HashMap<Pubkey, RevenueExpectationMeta>,
    leader_slots: Option<&LeaderSlots>,
) -> anyhow::Result<Vec<ProtectedEvent>> {
    info!("Collecting downtime revenue impact events...");
    if epoch_type(validator_meta_collection) == AlpenglowEpochType::Migration {
        info!(
            "Epoch {} is the Alpenglow migration epoch, no downtime events",
            validator_meta_collection.epoch
        );
        return Ok(vec![]);
    }
    let credits = expected_credits(validator_meta_collection, leader_slots)?;
    Ok(validator_meta_collection
        .validator_metas
        .iter()
        .filter(|v| v.stake > 0)
        .filter_map(|meta| {
            let vote_account = meta.vote_account;
            let Some(&(actual_credits, expected_credits)) = credits.get(&vote_account) else {
                debug!("Validator {vote_account} is not in the reward committee, no downtime");
                return None;
            };
            let revenue_expectation = revenue_expectation_map.get(&vote_account);
            if let Some(revenue_expectation) = revenue_expectation {
                if actual_credits < expected_credits && applied_commission_bps(meta) < 10000 {
                    debug!("Validator {vote_account} has got downtime, credits: {actual_credits}, expected credits: {expected_credits}");
                    let uptime = Decimal::from(actual_credits) / Decimal::from(expected_credits);
                    Some(
                        ProtectedEvent::DowntimeRevenueImpact {
                            vote_account,
                            actual_credits,
                            expected_credits,
                            expected_epr: revenue_expectation.actual_non_bid_pmpe / dec!(1000),
                            actual_epr: revenue_expectation.actual_non_bid_pmpe / dec!(1000) * uptime,
                            epr_loss_bps: bps(
                                expected_credits - actual_credits,
                                expected_credits
                            ),
                            stake: meta.stake,
                        },
                    )
                } else {
                    debug!("No downtime found for validator {vote_account}");
                    None
                }
            } else {
                debug!("Revenue expectation data not found for validator {vote_account}");
                None
            }
        })
        .collect())
}

/// SIMD-0357: `unpaid` holds the vote accounts whose stakers got no inflation rewards for the epoch
pub fn collect_vat_unadmitted_events(
    validator_meta_collection: &ValidatorMetaCollection,
    unpaid: &HashSet<Pubkey>,
) -> anyhow::Result<Vec<ProtectedEvent>> {
    if validator_meta_collection
        .features
        .inflation_rewards_validator_admission_ticket_active
        != Some(true)
    {
        info!("Validator admission ticket is not active, no VAT-unadmitted events");
        return Ok(vec![]);
    }
    if epoch_type(validator_meta_collection) == AlpenglowEpochType::Migration {
        info!(
            "Epoch {} is the Alpenglow migration epoch, no VAT-unadmitted events",
            validator_meta_collection.epoch
        );
        return Ok(vec![]);
    }
    info!("Collecting VAT-unadmitted events...");
    let total_stake: u64 = validator_meta_collection
        .validator_metas
        .iter()
        .map(|v| v.stake)
        .sum();
    if total_stake == 0 {
        return Ok(vec![]);
    }
    let rewards_per_stake =
        Decimal::from(validator_meta_collection.validator_rewards) / Decimal::from(total_stake);
    let mut unadmitted_stake: u128 = 0;
    let events: Vec<ProtectedEvent> = validator_meta_collection
        .validator_metas
        .iter()
        .filter_map(|meta| {
            let actual_credits = meta.credits.or(meta.alpenglow_credits).unwrap_or(0);
            let commission_bps = applied_commission_bps(meta);
            if !unpaid.contains(&meta.vote_account)
                || meta.stake == 0
                || actual_credits == 0
                || commission_bps >= 10000
            {
                return None;
            }
            if meta.inflation_rewards_admitted == Some(true) {
                warn!(
                    "Validator {} stakers got no inflation rewards though the snapshot admitted it",
                    meta.vote_account
                );
            }
            unadmitted_stake += meta.stake as u128;
            Some(ProtectedEvent::VatUnadmitted {
                vote_account: meta.vote_account,
                actual_credits,
                expected_epr: rewards_per_stake * Decimal::from(10000 - commission_bps)
                    / dec!(10000),
                actual_epr: Decimal::ZERO,
                epr_loss_bps: 10000,
                stake: meta.stake,
                inflation_rewards_admitted: meta.inflation_rewards_admitted,
            })
        })
        .collect();
    // real refusals are a handful of validators; a larger share means rows are missing from the input
    ensure!(
        unadmitted_stake * 10_000 <= total_stake as u128 * MAX_VAT_UNADMITTED_STAKE_BPS,
        "{} VAT-unadmitted validators hold {unadmitted_stake} of {total_stake} staked lamports in epoch {}, over the {MAX_VAT_UNADMITTED_STAKE_BPS} bps limit; the inflation rewards input looks incomplete",
        events.len(),
        validator_meta_collection.epoch
    );
    Ok(events)
}

/// |validator_rewards − M| / M against the Alpenglow vote reward pot M; None in a Tower epoch
pub fn inflation_baseline_divergence(
    validator_meta_collection: &ValidatorMetaCollection,
) -> Option<Decimal> {
    if epoch_type(validator_meta_collection) == AlpenglowEpochType::Tower {
        return None;
    }
    let max_possible_validator_reward = validator_meta_collection
        .epoch_inflation_account
        .as_ref()?
        .current
        .max_possible_validator_reward;
    if max_possible_validator_reward == 0 {
        return None;
    }
    let max = Decimal::from(max_possible_validator_reward);
    Some((Decimal::from(validator_meta_collection.validator_rewards) - max).abs() / max)
}

pub fn generate_protected_event_collection(
    validator_meta_collection: ValidatorMetaCollection,
    revenue_expectation_meta_collection: RevenueExpectationMetaCollection,
    leader_slots: Option<&LeaderSlots>,
    unpaid: Option<&HashSet<Pubkey>>,
) -> anyhow::Result<ProtectedEventCollection> {
    assert_eq!(
        validator_meta_collection.epoch, revenue_expectation_meta_collection.epoch,
        "Validator meta and bids pmpe meta collections have to be of the same epoch"
    );
    assert_eq!(
        validator_meta_collection.slot, revenue_expectation_meta_collection.slot,
        "Validator meta and bids pmpe meta collections have to be of the same slot"
    );
    if let Some(divergence) = inflation_baseline_divergence(&validator_meta_collection) {
        if divergence > dec!(0.05) {
            warn!(
                "Epoch {} validator_rewards diverge from the epoch inflation account max possible validator reward by {divergence}",
                validator_meta_collection.epoch
            );
        }
    }

    let revenue_expectation_map = revenue_expectation_meta_collection
        .revenue_expectations
        .iter()
        .map(|expectation_meta| (expectation_meta.vote_account, expectation_meta.clone()))
        .collect::<HashMap<Pubkey, RevenueExpectationMeta>>();

    let commission_increase_events =
        collect_commission_increase_events(&validator_meta_collection, &revenue_expectation_map);
    let vat_unadmitted_events: Vec<_> = unpaid
        .map(|unpaid| collect_vat_unadmitted_events(&validator_meta_collection, unpaid))
        .transpose()?
        .unwrap_or_default()
        .into_iter()
        .filter(|e| {
            let evaluated = revenue_expectation_map.contains_key(e.vote_account());
            if !evaluated {
                debug!(
                    "Revenue expectation data not found for VAT-unadmitted validator {}",
                    e.vote_account()
                );
            }
            evaluated
        })
        .collect();
    let vat_unadmitted: HashSet<Pubkey> = vat_unadmitted_events
        .iter()
        .map(|e| *e.vote_account())
        .collect();
    let mut downtime_revenue_impact_events = collect_downtime_revenue_impact_events(
        &validator_meta_collection,
        &revenue_expectation_map,
        leader_slots,
    )?;
    downtime_revenue_impact_events.retain(|e| !vat_unadmitted.contains(e.vote_account()));

    let mut events: Vec<_> = Default::default();
    events.extend(commission_increase_events);
    events.extend(vat_unadmitted_events);
    events.extend(downtime_revenue_impact_events);

    Ok(ProtectedEventCollection {
        epoch: validator_meta_collection.epoch,
        slot: validator_meta_collection.slot,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    const TOWER_1048: &str = include_str!("../fixtures/validators-tower-1048.json");

    fn revenue_expectation(vote_account: Pubkey, non_bid_pmpe: Decimal) -> RevenueExpectationMeta {
        RevenueExpectationMeta {
            vote_account,
            expected_inflation_commission: Decimal::ZERO,
            actual_inflation_commission: Decimal::ZERO,
            past_inflation_commission: Decimal::ZERO,
            expected_mev_commission: None,
            actual_mev_commission: None,
            past_mev_commission: None,
            expected_non_bid_pmpe: non_bid_pmpe,
            actual_non_bid_pmpe: non_bid_pmpe,
            expected_sam_pmpe: non_bid_pmpe,
            max_sam_stake: None,
            sam_stake_share: Decimal::ONE,
            loss_per_stake: Decimal::ZERO,
            before_sam_commission_increase_pmpe: Decimal::ZERO,
        }
    }

    fn revenue_map(
        collection: &ValidatorMetaCollection,
    ) -> HashMap<Pubkey, RevenueExpectationMeta> {
        collection
            .validator_metas
            .iter()
            .map(|v| (v.vote_account, revenue_expectation(v.vote_account, dec!(7))))
            .collect()
    }

    #[test]
    fn tower_downtime_keeps_the_stake_weighted_mean_formula() {
        let collection: ValidatorMetaCollection = serde_json::from_str(TOWER_1048).unwrap();
        let events =
            collect_downtime_revenue_impact_events(&collection, &revenue_map(&collection), None)
                .unwrap();

        // Σ(credits·stake)/Σstake over the four fixture rows, the 100% commission one included
        let expected_credits = 6_486_690;
        let low = Pubkey::from_str("3jkJVgfz1zrHSy6YLK6g96eTj49kCnDj2i8AbbKLZhkk").unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            ProtectedEvent::DowntimeRevenueImpact {
                vote_account,
                actual_credits,
                expected_credits: event_expected_credits,
                expected_epr,
                actual_epr,
                epr_loss_bps,
                stake,
            } => {
                assert_eq!(*vote_account, low);
                assert_eq!(*actual_credits, 2_965_104);
                assert_eq!(*event_expected_credits, expected_credits);
                assert_eq!(*expected_epr, dec!(0.007));
                assert_eq!(
                    *actual_epr,
                    dec!(0.007) * Decimal::from(2_965_104u64) / Decimal::from(expected_credits)
                );
                assert_eq!(
                    *epr_loss_bps,
                    bps(expected_credits - 2_965_104, expected_credits)
                );
                assert_eq!(*stake, 65_261_168_528_583);
            }
            other => panic!("unexpected event {other:?}"),
        }
    }

    #[test]
    fn tower_downtime_rejects_null_credits() {
        let mut collection: ValidatorMetaCollection = serde_json::from_str(TOWER_1048).unwrap();
        collection.validator_metas[0].credits = None;
        let err =
            collect_downtime_revenue_impact_events(&collection, &revenue_map(&collection), None)
                .unwrap_err();
        assert!(err.to_string().contains("has no credits"), "{err}");
    }

    const A: &str = "Mar1111111111111111111111111111111111111111";
    const B: &str = "Mar1111111111111111111111111111111111111112";
    const C: &str = "Mar1111111111111111111111111111111111111113";
    const D: &str = "Mar1111111111111111111111111111111111111114";

    fn pk(v: &str) -> Pubkey {
        Pubkey::from_str(v).unwrap()
    }

    fn meta(
        vote_account: &str,
        stake: u64,
        alpenglow_credits: Option<u64>,
        epoch_stake: Option<u64>,
        commission_bps: u16,
    ) -> serde_json::Value {
        serde_json::json!({
            "vote_account": vote_account,
            "commission": 5,
            "mev_commission": null,
            "jito_priority_fee_commission": null,
            "jito_priority_fee_lamports": 0,
            "stake": stake,
            "credits": null,
            "inflation_rewards_commission_bps": commission_bps,
            "alpenglow_credits": alpenglow_credits,
            "epoch_stake": epoch_stake,
        })
    }

    /// A, B, C stake 100 each with 3, 2 and 1 leader slots; D is staked but not in the committee
    /// and keeps any one VAT-unadmitted validator under the stake share limit
    fn alpenglow_collection(epoch_type: &str) -> ValidatorMetaCollection {
        serde_json::from_value(serde_json::json!({
            "epoch": 1100,
            "slot": 475199999,
            "capitalization": 1,
            "epoch_duration_in_years": 0.0027,
            "validator_rate": 0.04,
            "validator_rewards": 10_000,
            "alpenglow_epoch_type": epoch_type,
            "epoch_total_stake": 300,
            "features": {
                "block_revenue_custom_collector_active": false,
                "block_revenue_sharing_active": false,
                "inflation_rewards_validator_admission_ticket_active": true,
            },
            "validator_metas": [
                meta(A, 100, Some(1000), Some(100), 500),
                meta(B, 100, Some(1000), Some(100), 500),
                meta(C, 100, Some(400), Some(100), 500),
                meta(D, 99_700, None, None, 500),
            ],
        }))
        .unwrap()
    }

    fn leader_slots() -> LeaderSlots {
        LeaderSlots {
            per_vote_account: HashMap::from([(pk(A), 3), (pk(B), 2), (pk(C), 1)]),
            total_slots: 6,
        }
    }

    #[test]
    fn alpenglow_downtime_weights_expected_credits_by_stake_and_leader_slots() {
        let collection = alpenglow_collection("alpenglow");
        let events = collect_downtime_revenue_impact_events(
            &collection,
            &revenue_map(&collection),
            Some(&leader_slots()),
        )
        .unwrap();
        // w = s/S + L/N: A 1/3+3/6, B 1/3+2/6, C 1/3+1/6, Σw = 2, Σcredits = 2400 -> C expects 600
        assert_eq!(events.len(), 1);
        match &events[0] {
            ProtectedEvent::DowntimeRevenueImpact {
                vote_account,
                actual_credits,
                expected_credits,
                expected_epr,
                actual_epr,
                epr_loss_bps,
                stake,
            } => {
                assert_eq!(*vote_account, pk(C));
                assert_eq!(*actual_credits, 400);
                assert_eq!(*expected_credits, 600);
                assert_eq!(*expected_epr, dec!(0.007));
                assert_eq!(*actual_epr, dec!(0.007) * dec!(400) / dec!(600));
                assert_eq!(*epr_loss_bps, 3333);
                assert_eq!(*stake, 100);
            }
            other => panic!("unexpected event {other:?}"),
        }
    }

    #[test]
    fn alpenglow_downtime_needs_the_leader_schedule() {
        let collection = alpenglow_collection("alpenglow");
        let err =
            collect_downtime_revenue_impact_events(&collection, &revenue_map(&collection), None)
                .unwrap_err();
        assert!(
            err.to_string().contains("needs the leader schedule"),
            "{err}"
        );
    }

    #[test]
    fn migration_epoch_has_no_downtime() {
        let collection = alpenglow_collection("migration");
        let events = collect_downtime_revenue_impact_events(
            &collection,
            &revenue_map(&collection),
            Some(&leader_slots()),
        )
        .unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn full_applied_commission_gets_no_downtime_even_with_a_low_u8_commission() {
        let mut collection: ValidatorMetaCollection = serde_json::from_str(TOWER_1048).unwrap();
        let low = pk("3jkJVgfz1zrHSy6YLK6g96eTj49kCnDj2i8AbbKLZhkk");
        let low_meta = collection
            .validator_metas
            .iter_mut()
            .find(|m| m.vote_account == low)
            .unwrap();
        // raised to 100% inside the anti-rug window: the u8 still reads 0, the applied bps do not
        assert_eq!(low_meta.commission, 0);
        low_meta.inflation_rewards_commission_bps = Some(10000);
        let events =
            collect_downtime_revenue_impact_events(&collection, &revenue_map(&collection), None)
                .unwrap();
        assert!(events.is_empty(), "{events:?}");
    }

    #[test]
    fn baseline_divergence_is_relative_to_the_vote_reward_pot() {
        let tower: ValidatorMetaCollection = serde_json::from_str(TOWER_1048).unwrap();
        assert_eq!(inflation_baseline_divergence(&tower), None);

        let mut collection = alpenglow_collection("alpenglow");
        collection.validator_rewards = 3_500_000_000;
        let pot = |max: u64| {
            serde_json::from_value(serde_json::json!({
                "current": {"max_possible_validator_reward": max, "slots_per_epoch": 432000, "epoch": 1100},
                "prev": null,
            }))
            .unwrap()
        };
        collection.epoch_inflation_account = Some(pot(3_500_000_000));
        assert_eq!(
            inflation_baseline_divergence(&collection),
            Some(Decimal::ZERO)
        );
        collection.validator_rewards = 3_850_000_000;
        assert_eq!(inflation_baseline_divergence(&collection), Some(dec!(0.1)));
        collection.epoch_inflation_account = None;
        assert_eq!(inflation_baseline_divergence(&collection), None);
    }

    fn vat_event(events: &[ProtectedEvent]) -> Vec<(Pubkey, Decimal)> {
        events
            .iter()
            .filter_map(|e| match e {
                ProtectedEvent::VatUnadmitted {
                    vote_account,
                    expected_epr,
                    actual_epr,
                    epr_loss_bps,
                    ..
                } => {
                    assert_eq!(*actual_epr, Decimal::ZERO);
                    assert_eq!(*epr_loss_bps, 10000);
                    Some((*vote_account, *expected_epr))
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn vat_unadmitted_needs_stake_votes_and_a_commission_below_100_percent() {
        let mut collection = alpenglow_collection("alpenglow");
        // Σstake = 100,000: 10,000 lamports of validator rewards is 0.1 per lamport, 95% to stakers
        let unpaid = HashSet::from([pk(A), pk(D)]);
        assert_eq!(
            vat_event(&collect_vat_unadmitted_events(&collection, &unpaid).unwrap()),
            vec![(pk(A), dec!(0.095))]
        );

        // voted zero
        collection.validator_metas[0].alpenglow_credits = Some(0);
        assert!(collect_vat_unadmitted_events(&collection, &unpaid)
            .unwrap()
            .is_empty());

        // 100% commission
        collection.validator_metas[0].alpenglow_credits = Some(1000);
        collection.validator_metas[0].inflation_rewards_commission_bps = Some(10000);
        assert!(collect_vat_unadmitted_events(&collection, &unpaid)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn vat_unadmitted_fires_in_a_tower_epoch_once_the_admission_ticket_is_active() {
        let mut collection: ValidatorMetaCollection = serde_json::from_str(TOWER_1048).unwrap();
        // the paid validator's stake keeps the unadmitted one under the stake share limit
        collection.validator_metas[0].stake *= 1000;
        let low = pk("3jkJVgfz1zrHSy6YLK6g96eTj49kCnDj2i8AbbKLZhkk");
        // the 100% commission and zero-credit row is left out
        let unpaid = HashSet::from([low, pk("13hxMxYwu3g9tpFfS1oAGR42stai75QfE4q5pUE8B9P7")]);
        let vote_accounts: Vec<Pubkey> =
            vat_event(&collect_vat_unadmitted_events(&collection, &unpaid).unwrap())
                .into_iter()
                .map(|(vote_account, _)| vote_account)
                .collect();
        assert_eq!(vote_accounts, vec![low]);

        collection
            .features
            .inflation_rewards_validator_admission_ticket_active = None;
        assert!(collect_vat_unadmitted_events(&collection, &unpaid)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn vat_unadmitted_over_one_percent_of_stake_means_incomplete_inflation_input() {
        let collection: ValidatorMetaCollection = serde_json::from_str(TOWER_1048).unwrap();
        let unpaid: HashSet<Pubkey> = collection
            .validator_metas
            .iter()
            .map(|m| m.vote_account)
            .collect();
        let err = collect_vat_unadmitted_events(&collection, &unpaid).unwrap_err();
        assert!(err.to_string().contains("over the 100 bps limit"), "{err}");
    }

    #[test]
    fn vat_unadmitted_never_fires_in_the_migration_epoch() {
        let collection = alpenglow_collection("migration");
        let unpaid = HashSet::from([pk(A), pk(B), pk(C)]);
        assert!(collect_vat_unadmitted_events(&collection, &unpaid)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn vat_unadmitted_replaces_the_downtime_event() {
        let collection = alpenglow_collection("alpenglow");
        let revenue = RevenueExpectationMetaCollection {
            epoch: collection.epoch,
            slot: collection.slot,
            revenue_expectations: revenue_map(&collection).into_values().collect(),
        };
        let unpaid = HashSet::from([pk(C)]);
        let events = generate_protected_event_collection(
            collection,
            revenue,
            Some(&leader_slots()),
            Some(&unpaid),
        )
        .unwrap()
        .events;
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(vat_event(&events), vec![(pk(C), dec!(0.095))]);
    }

    #[test]
    fn vat_unadmitted_needs_a_revenue_expectation() {
        let collection = alpenglow_collection("alpenglow");
        let revenue = RevenueExpectationMetaCollection {
            epoch: collection.epoch,
            slot: collection.slot,
            revenue_expectations: revenue_map(&collection)
                .into_values()
                .filter(|r| r.vote_account != pk(C))
                .collect(),
        };
        let unpaid = HashSet::from([pk(C)]);
        let events = generate_protected_event_collection(
            collection,
            revenue,
            Some(&leader_slots()),
            Some(&unpaid),
        )
        .unwrap()
        .events;
        assert!(events.is_empty(), "{events:?}");
    }

    #[test]
    fn vat_unadmitted_matches_only_its_settlement_config() {
        use crate::settlement_collection::{SettlementFunder, SettlementMeta};
        use crate::settlement_config::{build_protected_event_matcher, SettlementConfigKind};
        let event = ProtectedEvent::VatUnadmitted {
            vote_account: pk(A),
            actual_credits: 1000,
            expected_epr: dec!(0.0095),
            actual_epr: Decimal::ZERO,
            epr_loss_bps: 10000,
            stake: 100,
            inflation_rewards_admitted: None,
        };
        let config = |kind| SettlementConfig {
            meta: SettlementMeta {
                funder: SettlementFunder::ValidatorBond,
            },
            kind,
        };
        let vat = config(SettlementConfigKind::VatUnadmittedSettlement {
            min_settlement_lamports: 0,
            covered_range_bps: [0, 10000],
        });
        let downtime = config(SettlementConfigKind::DowntimeRevenueImpactSettlement {
            min_settlement_lamports: 0,
            grace_downtime_bps: None,
            covered_range_bps: [0, 10000],
        });
        assert!(build_protected_event_matcher(&vat)(&event));
        assert!(!build_protected_event_matcher(&downtime)(&event));
        assert_eq!(event.claim_amount_in_loss_range(&vat, 1000).unwrap(), 9);
    }

    fn validator_metas(vote_account: Pubkey) -> ValidatorMetaCollection {
        ValidatorMetaCollection {
            validator_metas: vec![serde_json::from_value(meta(
                &vote_account.to_string(),
                1_000_000_000_000,
                None,
                None,
                300,
            ))
            .unwrap()],
            ..Default::default()
        }
    }

    // Parsed from the float JSON ds-sam writes, the same way bid-distribution-cli reads it.
    fn float_revenue_expectation(
        vote_account: Pubkey,
        actual: &str,
        expected: &str,
        before_sam: &str,
    ) -> RevenueExpectationMeta {
        serde_json::from_str(&format!(
            r#"{{"voteAccount":"{vote_account}","expectedInflationCommission":0.08,"actualInflationCommission":0.03,
            "pastInflationCommission":0.03,"expectedMevCommission":0.1,"actualMevCommission":0.1,"pastMevCommission":0.1,
            "expectedNonBidPmpe":{expected},"actualNonBidPmpe":{actual},"expectedSamPmpe":{expected},"maxSamStake":null,
            "samStakeShare":1,"lossPerStake":0,"beforeSamCommissionIncreasePmpe":{before_sam}}}"#
        ))
        .unwrap()
    }

    fn events_for(actual: &str, expected: &str, before_sam: &str) -> usize {
        let vote_account = Pubkey::new_unique();
        let expectations = HashMap::from([(
            vote_account,
            float_revenue_expectation(vote_account, actual, expected, before_sam),
        )]);
        collect_commission_increase_events(&validator_metas(vote_account), &expectations).len()
    }

    #[test]
    fn float_noise_at_the_boundary_is_not_a_commission_increase() {
        // ds-sam's actual equals expected + beforeSam algebraically; the floats differ by about 3e-18
        assert_eq!(
            events_for("0.33626577999999996", "0.32125208", "0.015013699999999963"),
            0
        );
    }

    #[test]
    fn a_real_shortfall_is_still_a_commission_increase() {
        assert_eq!(
            events_for("0.3362", "0.32125208", "0.015013699999999963"),
            1
        );
    }
}
