use crate::revenue_expectation_meta::{RevenueExpectationMeta, RevenueExpectationMetaCollection};
use crate::utils::bps_f64;

use {
    crate::utils::{bps, bps_to_fraction},
    log::{debug, info},
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    snapshot_parser::validator_meta::{ValidatorMeta, ValidatorMetaCollection},
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
        expected_epr: f64,
        actual_epr: f64,
        epr_loss_bps: u64,
        stake: u64,
    },
    CommissionIncrease {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        expected_inflation_commission: f64,
        actual_inflation_commission: f64,
        expected_mev_commission: Option<f64>,
        actual_mev_commission: Option<f64>,
        expected_epr: f64,
        actual_epr: f64,
        epr_loss_bps: u64,
        stake: u64,
    },
}

impl ProtectedEvent {
    pub fn vote_account(&self) -> &Pubkey {
        match self {
            ProtectedEvent::DowntimeRevenueImpact { vote_account, .. } => vote_account,
            ProtectedEvent::CommissionIncrease { vote_account, .. } => vote_account,
        }
    }
    pub fn expected_epr(&self) -> f64 {
        *match self {
            ProtectedEvent::DowntimeRevenueImpact { expected_epr, .. } => expected_epr,
            ProtectedEvent::CommissionIncrease { expected_epr, .. } => expected_epr,
        }
    }

    fn claim_per_stake(&self) -> f64 {
        match self {
            ProtectedEvent::CommissionIncrease {
                expected_epr,
                actual_epr,
                ..
            } => expected_epr - actual_epr,

            ProtectedEvent::DowntimeRevenueImpact {
                expected_epr,
                actual_epr,
                ..
            } => expected_epr - actual_epr,
        }
    }

    pub fn claim_amount(&self, stake: u64) -> u64 {
        (self.claim_per_stake() * (stake as f64)) as u64
    }

    pub fn claim_amount_in_loss_range(&self, range_bps: &[u64; 2], stake: u64) -> u64 {
        let lower_bps = range_bps[0];
        let upper_bps = range_bps[1];

        let max_claim_per_stake = bps_to_fraction(upper_bps) * self.expected_epr();
        let ignored_claim_per_stake = bps_to_fraction(lower_bps) * self.expected_epr();
        let claim_per_stake =
            self.claim_per_stake().min(max_claim_per_stake) - ignored_claim_per_stake;

        (stake as f64 * claim_per_stake).max(0.0).round() as u64
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
                if revenue_expectation.actual_non_bid_pmpe < revenue_expectation.expected_non_bid_pmpe {
                    debug!(
                        "Validator {vote_account} increased commission, expected non bid PMPE: {}, actual non bid PMPE: {}",
                        revenue_expectation.expected_non_bid_pmpe,
                        revenue_expectation.actual_non_bid_pmpe
                    );
                    // TODO: fix use of rust decimal instead of f64 and then re-enable this check
                    // revenue_expectation.check_commission_loss_per_stake();
                    Some(
                        ProtectedEvent::CommissionIncrease {
                            vote_account,
                            expected_inflation_commission: revenue_expectation.expected_inflation_commission,
                            actual_inflation_commission: revenue_expectation.actual_inflation_commission,
                            expected_mev_commission: revenue_expectation.expected_mev_commission,
                            actual_mev_commission: revenue_expectation.actual_mev_commission,
                            // expected_non_bid_pmpe is what how many SOLs was expected to gain per 1000 of staked SOLs
                            // expected_epr is ratio of how many SOLS to pay for 1 staked SOL (it does not matter if in loampors or SOLs when ratio)
                            expected_epr: revenue_expectation.expected_non_bid_pmpe / 1000.0,
                            actual_epr: revenue_expectation.actual_non_bid_pmpe / 1000.0,
                            epr_loss_bps: bps_f64(
                                revenue_expectation.expected_non_bid_pmpe - revenue_expectation.actual_non_bid_pmpe,
                                revenue_expectation.expected_non_bid_pmpe
                            ),
                            stake,
                        },
                    )
                } else {
                    debug!("[OK] Validator {vote_account} has not increased commission");
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
                    let uptime = credits as f64 / expected_credits as f64;
                    Some(
                        ProtectedEvent::DowntimeRevenueImpact {
                            vote_account,
                            actual_credits: credits,
                            expected_credits,
                            expected_epr: revenue_expectation.actual_non_bid_pmpe / 1000.0,
                            actual_epr: (revenue_expectation.actual_non_bid_pmpe / 1000.0) * uptime,
                            epr_loss_bps: bps(
                                expected_credits - credits,
                                expected_credits
                            ),
                            stake,
                        },
                    )
                } else {
                    debug!("No commission increase found for validator {vote_account}");
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
