use crate::jito_mev::fetch_jito_mev_metas;
use solana_program::pubkey::Pubkey;
use {
    log::{error, info, warn},
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    solana_program::stake_history::Epoch,
    solana_runtime::bank::Bank,
    solana_sdk::epoch_info::EpochInfo,
    std::{fmt::Debug, sync::Arc},
};

#[derive(Clone, Deserialize, Serialize, Debug, Eq, PartialEq)]
pub struct ValidatorMeta {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub commission: u8,
    /// jito-tip-distribution // TipDistributionAccount // validator_commission_bps
    pub mev_commission: Option<u16>,
    pub stake: u64,
    pub credits: u64,
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

#[derive(Clone, Deserialize, Serialize, Debug, Default)]
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

    /// sum of lamports staked to all validators
    pub fn total_stake(&self) -> u64 {
        self.validator_metas.iter().map(|v| v.stake).sum()
    }

    // TODO: DELETE ME? (not used anymore)
    /// expected staker commission (MEV not calculated) reward for a staked lamport to be delivered by a validator
    pub fn expected_epr(&self) -> f64 {
        self.validator_rewards as f64 / self.total_stake() as f64
    }

    /// calculates expected staker reward per one staked lamport when particular commission is set
    pub fn expected_epr_calculator(&self) -> impl Fn(u8) -> f64 {
        let expected_epr = self.expected_epr();

        move |commission: u8| expected_epr * (100.0 - commission as f64) / 100.0
    }
}

struct VoteAccountMeta {
    vote_account: Pubkey,
    commission: u8,
    stake: u64,
    credits: u64,
}

fn fetch_vote_account_metas(bank: &Arc<Bank>, epoch: Epoch) -> Vec<VoteAccountMeta> {
    bank.vote_accounts()
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

                    Some(VoteAccountMeta {
                        vote_account: *pubkey,
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
        .collect()
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

    let vote_account_metas = fetch_vote_account_metas(bank, epoch);
    let jito_mev_metas = fetch_jito_mev_metas(bank, epoch)?;

    let mut validator_metas = vote_account_metas
        .into_iter()
        .map(|vote_account_meta| ValidatorMeta {
            vote_account: vote_account_meta.vote_account,
            commission: vote_account_meta.commission,
            mev_commission: jito_mev_metas
                .iter()
                .find(|jito_mev_meta| jito_mev_meta.vote_account == vote_account_meta.vote_account)
                .map(|jito_mev_meta| Some(jito_mev_meta.mev_commission))
                .unwrap_or_else(|| {
                    warn!(
                        "No Jito MEV commission found for vote account: {}",
                        vote_account_meta.vote_account
                    );
                    None
                }),
            stake: vote_account_meta.stake,
            credits: vote_account_meta.credits,
        })
        .collect::<Vec<_>>();

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
