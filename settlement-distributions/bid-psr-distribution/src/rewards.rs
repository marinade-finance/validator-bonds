use crate::utils::{file_error, read_from_json_file};
use log::info;
use merkle_tree::serde_serialize::pubkey_string_conversion;
use serde::{Deserialize, Serialize};
use snapshot_parser_validator_cli::stake_meta::StakeMetaCollection;
use solana_sdk::clock::Epoch;
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::ops::Div;
use std::path::Path;

// Reward file name constants
const INFLATION_REWARDS_FILE: &str = "inflation.json";
const JITO_PRIORITY_FEE_FILE: &str = "jito_priority_fee.json";
const MEV_REWARDS_FILE: &str = "mev.json";
const VALIDATORS_BLOCKS_REWARDS_FILE: &str = "validators_blocks.json";
const VALIDATORS_INFLATION_REWARDS_FILE: &str = "validators_inflation.json";
const VALIDATORS_MEV_REWARDS_FILE: &str = "validators_mev.json";

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct StakeRewardEntry {
    pub epoch: u64,
    #[serde(with = "pubkey_string_conversion")]
    pub stake_account: Pubkey,
    #[serde(deserialize_with = "deserialize_amount")]
    pub amount: u64,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct VoteRewardEntry {
    pub epoch: u64,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    #[serde(deserialize_with = "deserialize_amount")]
    pub amount: u64,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct ValidatorBlockRewardEntry {
    pub epoch: u64,
    #[serde(with = "pubkey_string_conversion")]
    pub identity_account: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub node_pubkey: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub authorized_voter: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    #[serde(deserialize_with = "deserialize_amount")]
    pub amount: u64,
}

/// Aggregated rewards for a single vote account
#[derive(Debug, Clone, Default)]
pub struct VoteAccountRewards {
    pub vote_account: Pubkey,
    pub total_amount: u64,
    pub inflation_rewards: u64,
    pub mev_rewards: u64,
    pub block_rewards: u64,
    pub jito_priority_fee_rewards: u64,
    pub validators_total_amount: u64,
    // Rewards already shared with stakers (from non-validators_ prefixed files)
    pub stakers_inflation_rewards: u64,
    pub stakers_mev_rewards: u64,
    pub stakers_priority_fee_rewards: u64,
    pub stakers_total_amount: u64,
}

/// Collection of rewards aggregated by vote account
#[derive(Debug, Clone)]
pub struct RewardsCollection {
    pub epoch: Epoch,
    pub rewards_by_vote_account: HashMap<Pubkey, VoteAccountRewards>,
}

impl RewardsCollection {
    /// Get rewards for a specific vote account
    pub fn get(&self, vote_account: &Pubkey) -> Option<&VoteAccountRewards> {
        self.rewards_by_vote_account.get(vote_account)
    }

    /// Check if there are any rewards for a vote account
    pub fn has_rewards(&self, vote_account: &Pubkey) -> bool {
        self.rewards_by_vote_account.contains_key(vote_account)
    }

    /// Get total rewards across all vote accounts
    pub fn total_rewards(&self) -> u64 {
        self.rewards_by_vote_account
            .values()
            .map(|r| r.total_amount)
            .sum()
    }
}

/// Helper function to deserialize amount as string or number
fn deserialize_amount<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrU64 {
        String(String),
        U64(u64),
    }

    match StringOrU64::deserialize(deserializer)? {
        StringOrU64::String(s) => s.parse::<u64>().map_err(Error::custom),
        StringOrU64::U64(n) => Ok(n),
    }
}

/// Verify that all entries in a collection have the same epoch
fn verify_epoch_consistency<T>(
    entries: &[T],
    get_epoch: impl Fn(&T) -> u64,
    file_name: &str,
) -> anyhow::Result<Option<u64>> {
    if entries.is_empty() {
        return Ok(None);
    }

    let first_epoch = get_epoch(&entries[0]);
    for entry in entries.iter().skip(1) {
        let epoch = get_epoch(entry);
        if epoch != first_epoch {
            return Err(anyhow::anyhow!(
                "Epoch mismatch in {}: found epochs {} and {}",
                file_name,
                first_epoch,
                epoch
            ));
        }
    }

    Ok(Some(first_epoch))
}

/// Verify that all files contain data for the same epoch
fn verify_all_epochs_match(
    inflation_epoch: Option<u64>,
    jito_epoch: Option<u64>,
    mev_epoch: Option<u64>,
    blocks_epoch: Option<u64>,
    validators_inflation_epoch: Option<u64>,
    validators_mev_epoch: Option<u64>,
) -> anyhow::Result<u64> {
    let epochs = [
        ("inflation", inflation_epoch),
        ("jito_priority_fee", jito_epoch),
        ("mev", mev_epoch),
        ("validators_blocks", blocks_epoch),
        ("validators_inflation", validators_inflation_epoch),
        ("validators_mev", validators_mev_epoch),
    ];

    // Find the first non-empty file's epoch
    let expected_epoch = epochs
        .iter()
        .find_map(|(_, epoch)| *epoch)
        .ok_or_else(|| anyhow::anyhow!("All reward files are empty"))?;

    // Check that all non-empty files have the same epoch
    for (file_name, epoch) in epochs.iter() {
        if let Some(epoch) = epoch {
            if *epoch != expected_epoch {
                return Err(anyhow::anyhow!(
                    "Epoch mismatch: {} has epoch {}, but expected epoch {}",
                    file_name,
                    epoch,
                    expected_epoch
                ));
            }
        }
    }

    Ok(expected_epoch)
}

pub fn load_rewards_from_directory(
    rewards_dir: &Path,
    stake_meta_collection: &StakeMetaCollection,
) -> anyhow::Result<RewardsCollection> {
    // Define expected file paths using constants
    let inflation_file = rewards_dir.join(INFLATION_REWARDS_FILE);
    let jito_priority_fee_file = rewards_dir.join(JITO_PRIORITY_FEE_FILE);
    let mev_file = rewards_dir.join(MEV_REWARDS_FILE);
    let validators_blocks_file = rewards_dir.join(VALIDATORS_BLOCKS_REWARDS_FILE);
    let validators_inflation_file = rewards_dir.join(VALIDATORS_INFLATION_REWARDS_FILE);
    let validators_mev_file = rewards_dir.join(VALIDATORS_MEV_REWARDS_FILE);

    // Validate that all required files exist
    for file_path in [
        &inflation_file,
        &jito_priority_fee_file,
        &mev_file,
        &validators_blocks_file,
        &validators_inflation_file,
        &validators_mev_file,
    ] {
        if !file_path.exists() {
            return Err(anyhow::anyhow!(
                "Required reward file not found: {}",
                file_path.display()
            ));
        }
    }

    info!("Loading stakers' inflation rewards...");
    let inflation_rewards: Vec<StakeRewardEntry> = read_from_json_file(&inflation_file)
        .map_err(file_error("inflation", &inflation_file.to_string_lossy()))?;

    info!("Loading Jito priority fee rewards...");
    let jito_priority_fee_rewards: Vec<StakeRewardEntry> =
        read_from_json_file(&jito_priority_fee_file).map_err(file_error(
            "jito-priority-fee",
            &jito_priority_fee_file.to_string_lossy(),
        ))?;

    info!("Loading MEV stakers rewards...");
    let mev_rewards: Vec<StakeRewardEntry> =
        read_from_json_file(&mev_file).map_err(file_error("mev", &mev_file.to_string_lossy()))?;

    info!("Loading validator block rewards...");
    let validators_blocks: Vec<ValidatorBlockRewardEntry> =
        read_from_json_file(&validators_blocks_file).map_err(file_error(
            "validators-blocks",
            &validators_blocks_file.to_string_lossy(),
        ))?;

    info!("Loading validator inflation rewards...");
    let validators_inflation: Vec<VoteRewardEntry> =
        read_from_json_file(&validators_inflation_file).map_err(file_error(
            "validators-inflation",
            &validators_inflation_file.to_string_lossy(),
        ))?;

    info!("Loading validator MEV rewards...");
    let validators_mev: Vec<VoteRewardEntry> = read_from_json_file(&validators_mev_file).map_err(
        file_error("validators-mev", &validators_mev_file.to_string_lossy()),
    )?;

    let inflation_epoch =
        verify_epoch_consistency(&inflation_rewards, |e| e.epoch, INFLATION_REWARDS_FILE)?;
    let jito_epoch = verify_epoch_consistency(
        &jito_priority_fee_rewards,
        |e| e.epoch,
        JITO_PRIORITY_FEE_FILE,
    )?;
    let mev_epoch = verify_epoch_consistency(&mev_rewards, |e| e.epoch, MEV_REWARDS_FILE)?;
    let blocks_epoch = verify_epoch_consistency(
        &validators_blocks,
        |e| e.epoch,
        VALIDATORS_BLOCKS_REWARDS_FILE,
    )?;
    let validators_inflation_epoch = verify_epoch_consistency(
        &validators_inflation,
        |e| e.epoch,
        VALIDATORS_INFLATION_REWARDS_FILE,
    )?;
    let validators_mev_epoch =
        verify_epoch_consistency(&validators_mev, |e| e.epoch, VALIDATORS_MEV_REWARDS_FILE)?;

    let epoch = verify_all_epochs_match(
        inflation_epoch,
        jito_epoch,
        mev_epoch,
        blocks_epoch,
        validators_inflation_epoch,
        validators_mev_epoch,
    )?;
    info!("All reward files match epoch {}", epoch);

    info!("Aggregating rewards by vote account...");
    let rewards_by_vote_account = aggregate_rewards(
        inflation_rewards,
        jito_priority_fee_rewards,
        mev_rewards,
        validators_blocks,
        validators_inflation,
        validators_mev,
        stake_meta_collection,
    )?;

    Ok(RewardsCollection {
        epoch,
        rewards_by_vote_account,
    })
}

/// Aggregate all reward types by vote account
fn aggregate_rewards(
    inflation_rewards: Vec<StakeRewardEntry>,
    jito_priority_fee_rewards: Vec<StakeRewardEntry>,
    mev_rewards: Vec<StakeRewardEntry>,
    validators_blocks: Vec<ValidatorBlockRewardEntry>,
    validators_inflation: Vec<VoteRewardEntry>,
    validators_mev: Vec<VoteRewardEntry>,
    stake_meta_collection: &StakeMetaCollection,
) -> anyhow::Result<HashMap<Pubkey, VoteAccountRewards>> {
    let stake_to_vote: HashMap<Pubkey, Pubkey> = stake_meta_collection
        .stake_metas
        .iter()
        .filter_map(|stake_meta| {
            stake_meta
                .validator
                .as_ref()
                .map(|vote_account| (stake_meta.pubkey, *vote_account))
        })
        .collect();

    let mut rewards_map: HashMap<Pubkey, VoteAccountRewards> = HashMap::new();

    info!(" > Processing stakers' inflation rewards...");
    for reward in inflation_rewards {
        if let Some(vote_account) = stake_to_vote.get(&reward.stake_account) {
            let entry = rewards_map
                .entry(*vote_account)
                .or_insert_with(|| VoteAccountRewards {
                    vote_account: *vote_account,
                    ..Default::default()
                });
            entry.stakers_inflation_rewards = entry
                .stakers_inflation_rewards
                .saturating_add(reward.amount);
            entry.stakers_total_amount = entry.stakers_total_amount.saturating_add(reward.amount);
            entry.inflation_rewards = entry.inflation_rewards.saturating_add(reward.amount);
            entry.total_amount = entry.total_amount.saturating_add(reward.amount);
        } else {
            log::warn!(
                "No vote account found for stake account {} in inflation rewards",
                reward.stake_account
            );
        }
    }

    info!(" > Processing MEV stakers rewards...");
    for reward in mev_rewards {
        if let Some(vote_account) = stake_to_vote.get(&reward.stake_account) {
            let entry = rewards_map
                .entry(*vote_account)
                .or_insert_with(|| VoteAccountRewards {
                    vote_account: *vote_account,
                    ..Default::default()
                });
            entry.stakers_mev_rewards = entry.stakers_mev_rewards.saturating_add(reward.amount);
            entry.stakers_total_amount = entry.stakers_total_amount.saturating_add(reward.amount);
            entry.mev_rewards = entry.mev_rewards.saturating_add(reward.amount);
            entry.total_amount = entry.total_amount.saturating_add(reward.amount);
        } else {
            log::warn!(
                "No vote account found for stake account {} in MEV rewards",
                reward.stake_account
            );
        }
    }

    info!(" > Processing validator block rewards...");
    for reward in validators_blocks {
        let entry = rewards_map
            .entry(reward.vote_account)
            .or_insert_with(|| VoteAccountRewards {
                vote_account: reward.vote_account,
                ..Default::default()
            });
        entry.block_rewards = entry.block_rewards.saturating_add(reward.amount);
        entry.validators_total_amount = entry.validators_total_amount.saturating_add(reward.amount);
        entry.total_amount = entry.total_amount.saturating_add(reward.amount);
    }

    info!(" > Processing validator inflation rewards...");
    for reward in validators_inflation {
        let entry = rewards_map
            .entry(reward.vote_account)
            .or_insert_with(|| VoteAccountRewards {
                vote_account: reward.vote_account,
                ..Default::default()
            });
        entry.inflation_rewards = entry.inflation_rewards.saturating_add(reward.amount);
        entry.validators_total_amount = entry.validators_total_amount.saturating_add(reward.amount);
        entry.total_amount = entry.total_amount.saturating_add(reward.amount);
    }

    info!(" > Processing validator MEV rewards...");
    for reward in validators_mev {
        let entry = rewards_map
            .entry(reward.vote_account)
            .or_insert_with(|| VoteAccountRewards {
                vote_account: reward.vote_account,
                ..Default::default()
            });
        entry.mev_rewards = entry.mev_rewards.saturating_add(reward.amount);
        entry.validators_total_amount = entry.validators_total_amount.saturating_add(reward.amount);
        entry.total_amount = entry.total_amount.saturating_add(reward.amount);
    }

    info!(" > Processing Jito priority fee rewards...");
    // Note: jito_priority_fee is NOT included in total_amount as they are for re-distributing
    //       validators' block rewards already gained by the validators.
    for reward in jito_priority_fee_rewards {
        if let Some(vote_account) = stake_to_vote.get(&reward.stake_account) {
            let entry = rewards_map
                .entry(*vote_account)
                .or_insert_with(|| VoteAccountRewards {
                    vote_account: *vote_account,
                    ..Default::default()
                });
            entry.stakers_priority_fee_rewards = entry
                .stakers_priority_fee_rewards
                .saturating_add(reward.amount);
            entry.stakers_total_amount = entry.stakers_total_amount.saturating_add(reward.amount);
            entry.jito_priority_fee_rewards = entry
                .jito_priority_fee_rewards
                .saturating_add(reward.amount);
            // what stakers got from jito was what validators lost
            entry.validators_total_amount =
                entry.validators_total_amount.saturating_sub(reward.amount);
        } else {
            log::warn!(
                "No vote account found for stake account {} in Jito priority fee rewards",
                reward.stake_account
            );
        }
    }

    let total_rewards = rewards_map
        .values()
        .map(|r| r.total_amount)
        .sum::<u64>()
        .div(LAMPORTS_PER_SOL);
    let total_stakers_rewards = rewards_map
        .values()
        .map(|r| r.stakers_total_amount)
        .sum::<u64>()
        .div(LAMPORTS_PER_SOL);
    let total_validators_rewards = rewards_map
        .values()
        .map(|r| r.validators_total_amount)
        .sum::<u64>()
        .div(LAMPORTS_PER_SOL);
    assert_eq!(
        total_rewards,
        total_stakers_rewards + total_validators_rewards
    );
    info!(
        "Aggregated rewards (total: {} SOL, stakers: {} SOL, validators: {} SOL) for {} vote accounts",
        total_rewards, total_stakers_rewards, total_validators_rewards,
        rewards_map.len()
    );

    Ok(rewards_map)
}
