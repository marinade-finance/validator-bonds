use crate::revenue_expectation_meta::{RevenueExpectationMeta, RevenueExpectationMetaCollection};
use crate::settlement_config::SettlementConfig;
use crate::utils::bps_decimal;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

use {
    crate::utils::{bps, bps_to_fraction},
    log::{debug, info},
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    snapshot_parser_validator_cli::validator_meta::{ValidatorMeta, ValidatorMetaCollection},
    solana_sdk::pubkey::Pubkey,
    std::collections::HashMap,
};

#[derive(Clone, Deserialize, Serialize, Debug, utoipa::ToSchema)]
pub enum ProtectedEvent {
    DowntimeRevenueImpact {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        actual_credits: u64,
        expected_credits: u64,
        /// how many lamports per 1 staked lamport was expected to be paid by validator
        expected_epr: Decimal,
        actual_epr: Decimal,
        epr_loss_bps: u64,
        stake: u64,
    },
    CommissionSamIncrease {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        expected_inflation_commission: Decimal,
        actual_inflation_commission: Decimal,
        past_inflation_commission: Decimal,
        expected_mev_commission: Option<Decimal>,
        actual_mev_commission: Option<Decimal>,
        past_mev_commission: Option<Decimal>,
        before_sam_commission_increase_pmpe: Decimal,
        expected_epr: Decimal,
        actual_epr: Decimal,
        epr_loss_bps: u64,
        stake: u64,
    },

    // V1 events (before SAM was introduced) for backward compatibility to parse JSONs
    CommissionIncrease {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        previous_commission: u8,
        current_commission: u8,
        expected_epr: Decimal,
        actual_epr: Decimal,
        epr_loss_bps: u64,
        stake: Decimal,
    },
    LowCredits {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        expected_credits: u64,
        actual_credits: u64,
        commission: u8,
        expected_epr: Decimal,
        actual_epr: Decimal,
        epr_loss_bps: u64,
        stake: Decimal,
    },
}

impl ProtectedEvent {
    pub fn vote_account(&self) -> &Pubkey {
        match self {
            ProtectedEvent::DowntimeRevenueImpact { vote_account, .. } => vote_account,
            ProtectedEvent::CommissionSamIncrease { vote_account, .. } => vote_account,
            ProtectedEvent::CommissionIncrease { vote_account, .. } => vote_account,
            ProtectedEvent::LowCredits { vote_account, .. } => vote_account,
        }
    }
    pub fn expected_epr(&self) -> Decimal {
        *match self {
            ProtectedEvent::DowntimeRevenueImpact { expected_epr, .. } => expected_epr,
            ProtectedEvent::CommissionSamIncrease { expected_epr, .. } => expected_epr,
            ProtectedEvent::CommissionIncrease { expected_epr, .. } => expected_epr,
            ProtectedEvent::LowCredits { expected_epr, .. } => expected_epr,
        }
    }

    fn claim_per_stake(&self, cfg: &SettlementConfig) -> Decimal {
        match self {
            ProtectedEvent::CommissionSamIncrease {
                actual_inflation_commission,
                actual_mev_commission,
                expected_epr,
                actual_epr,
                ..
            } => {
                let base_cps = expected_epr - actual_epr;
                match cfg {
                    SettlementConfig::CommissionSamIncreaseSettlement {
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
            } => expected_epr - actual_epr,
            non_implemented => panic!(
                "Claim per stake is not implemented for event {:?}",
                non_implemented
            ),
        }
    }

    pub fn claim_amount_in_loss_range(&self, cfg: &SettlementConfig, stake: u64) -> u64 {
        let range_bps = cfg.covered_range_bps();
        let lower_bps = range_bps[0];
        let upper_bps = range_bps[1];

        let max_claim_per_stake = bps_to_fraction(upper_bps) * self.expected_epr();
        let ignored_claim_per_stake = bps_to_fraction(lower_bps) * self.expected_epr();
        let claim_per_stake =
            self.claim_per_stake(cfg).min(max_claim_per_stake) - ignored_claim_per_stake;

        (Decimal::from(stake) * claim_per_stake)
            .max(Decimal::ZERO)
            .to_u64()
            .expect("claim_amount_in_loss_range: cannot convert to u64")
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct ProtectedEventCollection {
    pub epoch: u64,
    pub slot: u64,
    pub events: Vec<ProtectedEvent>,
}

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
                if revenue_expectation.actual_non_bid_pmpe < expected_commission_pmpe {
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

pub fn collect_downtime_revenue_impact_events(
    validator_meta_collection: &ValidatorMetaCollection,
    revenue_expectation_map: &HashMap<Pubkey, RevenueExpectationMeta>,
) -> Vec<ProtectedEvent> {
    info!("Collecting downtime revenue impact events...");
    // credits to calculate uptime
    let total_stake_weighted_credits = validator_meta_collection.total_stake_weighted_credits();
    let expected_credits =
        (total_stake_weighted_credits / validator_meta_collection.total_stake() as u128) as u64;
    validator_meta_collection
        .validator_metas
        .iter()
        .filter(|v| v.stake > 0)
        .cloned()
        .filter_map(|ValidatorMeta {vote_account, credits, commission, stake, ..}| {
            let revenue_expectation = revenue_expectation_map.get(&vote_account);
            if let Some(revenue_expectation) = revenue_expectation {
                if credits < expected_credits && commission < 100 {
                    debug!("Validator {vote_account} has got downtime, credits: {credits}, expected credits: {expected_credits}");
                    let uptime = Decimal::from(credits) / Decimal::from(expected_credits);
                    Some(
                        ProtectedEvent::DowntimeRevenueImpact {
                            vote_account,
                            actual_credits: credits,
                            expected_credits,
                            expected_epr: revenue_expectation.actual_non_bid_pmpe / dec!(1000),
                            actual_epr: revenue_expectation.actual_non_bid_pmpe / dec!(1000) * uptime,
                            epr_loss_bps: bps(
                                expected_credits - credits,
                                expected_credits
                            ),
                            stake,
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
        .collect()
}

pub fn generate_protected_event_collection(
    validator_meta_collection: ValidatorMetaCollection,
    revenue_expectation_meta_collection: RevenueExpectationMetaCollection,
) -> ProtectedEventCollection {
    assert_eq!(
        validator_meta_collection.epoch, revenue_expectation_meta_collection.epoch,
        "Validator meta and bids pmpe meta collections have to be of the same epoch"
    );
    assert_eq!(
        validator_meta_collection.slot, revenue_expectation_meta_collection.slot,
        "Validator meta and bids pmpe meta collections have to be of the same slot"
    );

    let revenue_expectation_map = revenue_expectation_meta_collection
        .revenue_expectations
        .iter()
        .map(|expectation_meta| (expectation_meta.vote_account, expectation_meta.clone()))
        .collect::<HashMap<Pubkey, RevenueExpectationMeta>>();

    let commission_increase_events =
        collect_commission_increase_events(&validator_meta_collection, &revenue_expectation_map);
    let downtime_revenue_impact_events = collect_downtime_revenue_impact_events(
        &validator_meta_collection,
        &revenue_expectation_map,
    );

    let mut events: Vec<_> = Default::default();
    events.extend(commission_increase_events);
    events.extend(downtime_revenue_impact_events);

    ProtectedEventCollection {
        epoch: validator_meta_collection.epoch,
        slot: validator_meta_collection.slot,
        events,
    }
}
