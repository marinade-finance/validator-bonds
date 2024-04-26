use {
    crate::utils::{bps, bps_to_fraction},
    log::{debug, info},
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    snapshot_parser::validator_meta::{ValidatorMeta, ValidatorMetaCollection},
    solana_sdk::{native_token::lamports_to_sol, pubkey::Pubkey},
    std::collections::HashMap,
};

#[derive(Clone, Deserialize, Serialize, Debug, utoipa::ToSchema)]
pub enum ProtectedEvent {
    CommissionIncrease {
        #[serde(with = "pubkey_string_conversion")]
        vote_account: Pubkey,
        previous_commission: u8,
        current_commission: u8,
        expected_epr: f64,
        actual_epr: f64,
        epr_loss_bps: u64,
        stake: f64,
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
        stake: f64,
    },
}

impl ProtectedEvent {
    pub fn vote_account(&self) -> &Pubkey {
        match self {
            ProtectedEvent::CommissionIncrease { vote_account, .. } => vote_account,
            ProtectedEvent::LowCredits { vote_account, .. } => vote_account,
        }
    }
    pub fn expected_epr(&self) -> f64 {
        *match self {
            ProtectedEvent::CommissionIncrease { expected_epr, .. } => expected_epr,
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

            ProtectedEvent::CommissionIncrease {
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
        .filter_map(|ValidatorMeta {vote_account, commission, credits, stake}| {
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
                        stake: lamports_to_sol(stake),
                    },
                )
            } else {
                None
            }
        })
        .collect()
}

pub fn collect_commission_increase_events(
    validator_meta_collection: &ValidatorMetaCollection,
    past_validator_meta_collection: &ValidatorMetaCollection,
) -> Vec<ProtectedEvent> {
    assert_eq!(
        validator_meta_collection.epoch,
        past_validator_meta_collection.epoch + 1,
        "Validator meta collections have to be one epoch apart!"
    );
    info!("Collecting commission increase events...");
    let expected_epr_calculator = validator_meta_collection.expected_epr_calculator();
    let past_validator_metas: HashMap<_, _> = past_validator_meta_collection
        .validator_metas
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
        .filter_map(|ValidatorMeta {vote_account, commission: current_commission, stake, ..}| {
            let past_meta = past_validator_metas.get(&vote_account);
            let previous_commission = past_meta.map(|past| past.commission);

            if let Some(previous_commission) = previous_commission {
                let current_commission = current_commission.clamp(0, 100);
                let previous_commission = previous_commission.clamp(0, 100);
                if previous_commission < current_commission {
                    debug!("Commission increase found for validator {vote_account}: {previous_commission} % -> {current_commission} %");
                    return Some(
                        ProtectedEvent::CommissionIncrease {
                          vote_account,
                            previous_commission,
                            current_commission,
                            expected_epr: expected_epr_calculator(previous_commission),
                            actual_epr: expected_epr_calculator(current_commission),
                            epr_loss_bps: 10000 - bps((100 - current_commission).into(), (100 - previous_commission).into()),
                            stake: lamports_to_sol(stake),
                        },
                    );
                }
            } else {
                debug!("Past commission not found for validator {vote_account}");
            }
            None
        })
        .collect()
}

pub fn generate_protected_event_collection(
    validator_meta_collection: ValidatorMetaCollection,
    past_validator_meta_collection: Option<ValidatorMetaCollection>,
) -> ProtectedEventCollection {
    let commission_increase_events = past_validator_meta_collection
        .map(|past_validator_meta_collection| {
            collect_commission_increase_events(
                &validator_meta_collection,
                &past_validator_meta_collection,
            )
        })
        .unwrap_or_default();
    let low_credits_events = collect_low_credits_events(&validator_meta_collection);

    let mut events: Vec<_> = Default::default();
    events.extend(commission_increase_events);
    events.extend(low_credits_events);

    ProtectedEventCollection {
        epoch: validator_meta_collection.epoch,
        slot: validator_meta_collection.slot,
        events,
    }
}
