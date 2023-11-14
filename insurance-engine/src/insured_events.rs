use std::collections::HashMap;

use {
    serde::{Deserialize, Serialize},
    snapshot_parser::validator_meta::ValidatorMetaCollection,
};

#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum InsuredEvent {
    LowStakeRewards {
        expected_stake_rewards_per_sol: f64,
        actual_stake_rewards_per_sol: f64,
        claim_per_sol: f64,
    },
}

impl InsuredEvent {
    fn maybe_low_stake_rewards(
        expected_stake_rewards_per_sol: f64,
        estimated_stake_rewards_per_sol: f64,
        threshold: f64,
    ) -> Option<InsuredEvent> {
        if estimated_stake_rewards_per_sol < threshold * expected_stake_rewards_per_sol {
            Some(InsuredEvent::LowStakeRewards {
                expected_stake_rewards_per_sol,
                actual_stake_rewards_per_sol: estimated_stake_rewards_per_sol,
                claim_per_sol: threshold * expected_stake_rewards_per_sol
                    - estimated_stake_rewards_per_sol,
            })
        } else {
            None
        }
    }

    pub fn claim_amount(&self, stake: u64) -> u64 {
        match self {
            InsuredEvent::LowStakeRewards { claim_per_sol, .. } => {
                (claim_per_sol * stake as f64) as u64
            }
        }
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct InsuredEventCollection {
    pub epoch: u64,
    pub slot: u64,
    pub low_rewards_threshold_pct: f64,
    pub events: HashMap</* vote_account */ String, Vec<InsuredEvent>>,
}

impl InsuredEventCollection {
    pub fn events_by_validator(&self, vote_account: &str) -> Option<&Vec<InsuredEvent>> {
        self.events.get(vote_account)
    }
}

pub fn generate_insured_event_collection(
    validator_meta_collection: ValidatorMetaCollection,
    low_rewards_threshold_pct: f64,
) -> InsuredEventCollection {
    let expected_stake_rewards_per_sol_calculator =
        validator_meta_collection.expected_stake_rewards_per_sol_calculator();

    let total_stake_weighted_credits = validator_meta_collection.total_stake_weighted_credits();

    let events: HashMap<_, _> = validator_meta_collection
        .validator_metas
        .iter()
        .filter_map(|v| {
            let estimated_stake_rewards_per_sol = v.estimated_stake_rewards_per_sol(
                total_stake_weighted_credits,
                validator_meta_collection.validator_rewards,
            );
            let expected_stake_rewards_per_sol =
                expected_stake_rewards_per_sol_calculator(v.commission);

            let events: Vec<_> = vec![InsuredEvent::maybe_low_stake_rewards(
                expected_stake_rewards_per_sol,
                estimated_stake_rewards_per_sol,
                low_rewards_threshold_pct,
            )]
            .into_iter()
            .flatten()
            .collect();

            if events.len() > 0 {
                Some((v.vote_account.clone(), events))
            } else {
                None
            }
        })
        .collect();

    InsuredEventCollection {
        epoch: validator_meta_collection.epoch,
        slot: validator_meta_collection.slot,
        low_rewards_threshold_pct,
        events,
    }
}
