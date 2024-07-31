use crate::bids_pmpe_meta::BidsPmpeMetaCollection;
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
    StakerRevenueImpact {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        expected_epr: f64,
        actual_epr: f64,
        epr_loss_bps: u64,
        // TODO: I believe the currency value should be in lamports, is f64 because of displaying?
        stake: u64,
        // TODO: some detail data about the event
        // previous_commission: u8,
        // current_commission: u8,
        // previous_jito_mev: u8,
        // current_jito_mev: u8,
    },
    LowCredits {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        expected_credits: u64,
        actual_credits: u64,
        commission: u8,
        expected_epr: f64,
        actual_epr: f64,
        epr_loss_bps: u64,
        stake: u64,
    },
}

impl ProtectedEvent {
    pub fn vote_account(&self) -> &Pubkey {
        match self {
            ProtectedEvent::StakerRevenueImpact { vote_account, .. } => vote_account,
            ProtectedEvent::LowCredits { vote_account, .. } => vote_account,
        }
    }
    pub fn expected_epr(&self) -> f64 {
        *match self {
            ProtectedEvent::StakerRevenueImpact { expected_epr, .. } => expected_epr,
            ProtectedEvent::LowCredits { expected_epr, .. } => expected_epr,
        }
    }

    fn claim_per_stake(&self) -> f64 {
        match self {
            ProtectedEvent::LowCredits {
                expected_epr,
                actual_epr,
                ..
            } => expected_epr - actual_epr,

            ProtectedEvent::StakerRevenueImpact {
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

        // TODO: by interest, should not we use some big decimal library for calculations?
        (stake as f64 * claim_per_stake).max(0.0).round() as u64
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct ProtectedEventCollection {
    pub epoch: u64,
    pub slot: u64,
    pub events: Vec<ProtectedEvent>,
}

pub fn collect_low_credits_events(
    validator_meta_collection: &ValidatorMetaCollection,
) -> Vec<ProtectedEvent> {
    info!("Collecting low credits events...");
    let expected_epr_calculator = validator_meta_collection.expected_epr_calculator();

    let total_stake_weighted_credits = validator_meta_collection.total_stake_weighted_credits();
    let expected_credits =
        (total_stake_weighted_credits / validator_meta_collection.total_stake() as u128) as u64;

    validator_meta_collection
        .validator_metas
        .iter()
        .filter(|v| v.stake > 0)
        .cloned()
        .filter_map(|ValidatorMeta {vote_account, commission, credits, stake, mev_commission: _}| {
            if credits < expected_credits && commission < 100 {
              debug!("Validator {vote_account} has low credits: {credits}, expected: {expected_credits}");
                Some(
                  ProtectedEvent::LowCredits {
                        vote_account,
                        expected_credits,
                        actual_credits: credits,
                        commission,
                        expected_epr: expected_epr_calculator(commission),
                        actual_epr: expected_epr_calculator(commission) * credits as f64
                            / expected_credits as f64,
                        epr_loss_bps: bps(expected_credits - credits, expected_credits),
                        stake,
                    },
                )
            } else {
                None
            }
        })
        .collect()
}

pub fn collect_staker_revenue_impact_events(
    validator_meta_collection: &ValidatorMetaCollection,
    bids_pmpe_meta_collection: &BidsPmpeMetaCollection,
) -> Vec<ProtectedEvent> {
    assert_eq!(
        validator_meta_collection.epoch, bids_pmpe_meta_collection.epoch,
        "Validator meta and bids pmpe meta collections have to be of the same epoch"
    );
    assert_eq!(
        validator_meta_collection.slot, bids_pmpe_meta_collection.slot,
        "Validator meta and bids pmpe meta collections have to be of the same slot"
    );
    info!("Collecting staker revenue impact events...");
    let pmpe_epr_calculator = BidsPmpeMetaCollection::epr_calculator();
    let bids_pmpe_map: HashMap<_, _> = bids_pmpe_meta_collection
        .bid_pmpe_metas
        .iter()
        .map(|past_validator_meta| {
            (
                past_validator_meta.vote_account,
                past_validator_meta.clone(),
            )
        })
        .collect();
    validator_meta_collection
        .validator_metas
        .iter()
        .filter(|v| v.stake > 0)
        .cloned()
        .filter_map(|ValidatorMeta {vote_account, stake, ..}| {
            let bids_pmpe = bids_pmpe_map.get(&vote_account);

            if let Some(bids_pmpe) = bids_pmpe {
                // TODO: should here to be considered somehow the effective bid to bound the bid pmpe values?
                if bids_pmpe.actual_bid_pmpe < bids_pmpe.expected_bid_pmpe {
                    debug!(
                        "Staker revenue impact PMPE decrease found for validator {vote_account}: {} -> {}",
                        bids_pmpe.expected_bid_pmpe,
                        bids_pmpe.actual_bid_pmpe
                    );
                    return Some(
                        ProtectedEvent::StakerRevenueImpact {
                            vote_account,
                            expected_epr: pmpe_epr_calculator(bids_pmpe.expected_bid_pmpe),
                            actual_epr: pmpe_epr_calculator(bids_pmpe.actual_bid_pmpe),
                            epr_loss_bps: 10000 - bps(bids_pmpe.actual_bid_pmpe, bids_pmpe.expected_bid_pmpe),
                            stake,
                        },
                    );
                }
            } else {
                debug!("PMPE calculation data not found for validator {vote_account}");
            }
            None
        })
        .collect()
}

pub fn generate_protected_event_collection(
    validator_meta_collection: ValidatorMetaCollection,
    bids_pmpe_meta_collection: BidsPmpeMetaCollection,
) -> ProtectedEventCollection {
    let staker_revenue_impact_events = collect_staker_revenue_impact_events(
        &validator_meta_collection,
        &bids_pmpe_meta_collection,
    );
    let low_credits_events = collect_low_credits_events(&validator_meta_collection);

    let mut events: Vec<_> = Default::default();
    events.extend(staker_revenue_impact_events);
    events.extend(low_credits_events);

    ProtectedEventCollection {
        epoch: validator_meta_collection.epoch,
        slot: validator_meta_collection.slot,
        events,
    }
}
