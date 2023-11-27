use {
    log::{error, info},
    serde::{Deserialize, Serialize},
    solana_program::stake_history::Epoch,
    solana_runtime::bank::Bank,
    solana_sdk::epoch_info::EpochInfo,
    std::{fmt::Debug, sync::Arc},
};

#[derive(Clone, Deserialize, Serialize, Debug, Eq, PartialEq)]
pub struct ValidatorMeta {
    pub vote_account: String,
    pub commission: u8,
    pub stake: u64,
    pub credits: u64,
}

impl ValidatorMeta {
    pub fn estimated_stake_rewards_per_sol(
        &self,
        total_stake_weighted_credits: u128,
        validator_rewards: u64,
    ) -> f64 {
        let rewards = (self.credits as u128 * self.stake as u128 * validator_rewards as u128)
            / total_stake_weighted_credits;
        let staker_rewards = rewards as f64 * (100.0 - self.commission as f64) / 100.0;

        staker_rewards / self.stake as f64
    }
}

impl Ord for ValidatorMeta {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.vote_account.cmp(&other.vote_account)
    }
}

impl PartialOrd<Self> for ValidatorMeta {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct ValidatorMetaCollection {
    pub epoch: Epoch,
    pub slot: u64,
    pub capitalization: u64,
    pub epoch_duration_in_years: f64,
    pub validator_rate: f64,
    pub validator_rewards: u64,
    pub validator_metas: Vec<ValidatorMeta>,
}

impl ValidatorMetaCollection {
    pub fn total_stake_weighted_credits(&self) -> u128 {
        self.validator_metas
            .iter()
            .map(|v| v.credits as u128 * v.stake as u128)
            .sum()
    }

    pub fn total_stake(&self) -> u64 {
        self.validator_metas.iter().map(|v| v.stake).sum()
    }

    pub fn expected_rewards_per_sol(&self) -> f64 {
        self.validator_rewards as f64 / self.total_stake() as f64
    }

    pub fn expected_stake_rewards_per_sol_calculator(&self) -> impl Fn(u8) -> f64 {
        let expected_rewards_per_sol = self.expected_rewards_per_sol();

        move |commission: u8| expected_rewards_per_sol * (100.0 - commission as f64) / 100.0
    }
}

pub fn generate_validator_collection(bank: &Arc<Bank>) -> anyhow::Result<ValidatorMetaCollection> {
    assert!(bank.is_frozen());

    let EpochInfo {
        epoch,
        absolute_slot,
        ..
    } = bank.get_epoch_info();

    let validator_rate = bank
        .inflation()
        .validator(bank.slot_in_year_for_inflation());
    let capitalization = bank.capitalization();
    let epoch_duration_in_years = bank.epoch_duration_in_years(epoch);
    let validator_rewards =
        (validator_rate * capitalization as f64 * epoch_duration_in_years) as u64;

    let mut validator_metas: Vec<ValidatorMeta> = bank
        .vote_accounts()
        .iter()
        .filter_map(
            |(pubkey, (stake, vote_account))| match vote_account.vote_state() {
                Ok(vote_state) => {
                    let credits = vote_state
                        .epoch_credits
                        .iter()
                        .find_map(|(credits_epoch, _, prev_credits)| {
                            if *credits_epoch == epoch {
                                Some(vote_state.credits() - *prev_credits)
                            } else {
                                None
                            }
                        })
                        .unwrap_or(0);

                    Some(ValidatorMeta {
                        vote_account: pubkey.to_string(),
                        commission: vote_state.commission,
                        stake: *stake,
                        credits,
                    })
                }
                Err(err) => {
                    error!("Failed to get the vote state for: {}: {}", pubkey, err);
                    None
                }
            },
        )
        .collect();

    info!(
        "Collected all vote account metas: {}",
        validator_metas.len()
    );
    info!(
        "Vote accounts with some credits earned: {}",
        validator_metas.iter().filter(|v| v.credits > 0).count()
    );

    validator_metas.sort();
    info!("Sorted vote account metas");

    Ok(ValidatorMetaCollection {
        epoch,
        slot: absolute_slot,
        capitalization,
        epoch_duration_in_years,
        validator_rate,
        validator_rewards,
        validator_metas,
    })
}
