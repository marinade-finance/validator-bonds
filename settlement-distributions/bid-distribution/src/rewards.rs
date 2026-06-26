use log::info;
use merkle_tree::serde_serialize::pubkey_string_conversion;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::utils::{file_error, read_from_json_file};
use snapshot_parser_validator_cli::stake_meta::StakeMetaCollection;
use solana_sdk::clock::Epoch;
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

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

impl VoteAccountRewards {
    // commission rate actually applied at rewards distribution; None when there were no rewards
    pub fn realized_inflation_commission_dec(&self) -> Option<Decimal> {
        realized_commission_dec(self.inflation_rewards, self.stakers_inflation_rewards)
    }

    pub fn realized_mev_commission_dec(&self) -> Option<Decimal> {
        realized_commission_dec(self.mev_rewards, self.stakers_mev_rewards)
    }

    pub fn realized_block_commission_dec(&self) -> Option<Decimal> {
        realized_commission_dec(self.block_rewards, self.stakers_priority_fee_rewards)
    }

    /// Reward types whose realized commission came out negative — the stakers' share recorded for
    /// the type exceeds the validator's gross. commission_eff clamps these (bonds are never
    /// overcharged) but the validator's commission is silently dropped, and the aggregate rewards
    /// assert can't catch them since per-validator excesses net out across the set.
    fn negative_realized_commissions(&self) -> Vec<(&'static str, Decimal)> {
        [
            ("inflation", self.realized_inflation_commission_dec()),
            ("mev", self.realized_mev_commission_dec()),
            ("block", self.realized_block_commission_dec()),
        ]
        .into_iter()
        .filter_map(|(kind, c)| match c {
            Some(c) if c < Decimal::ZERO => Some((kind, c)),
            _ => None,
        })
        .collect()
    }
}

fn realized_commission_dec(gross_rewards: u64, stakers_rewards: u64) -> Option<Decimal> {
    if gross_rewards == 0 {
        return None;
    }
    Some(
        (Decimal::from(gross_rewards) - Decimal::from(stakers_rewards))
            / Decimal::from(gross_rewards),
    )
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
    let mut epochs: Vec<_> = entries.iter().map(get_epoch).collect();
    epochs.sort_by(|a, b| b.cmp(a));
    epochs.dedup();

    match epochs.as_slice() {
        [] => Ok(None),
        [epoch] => Ok(Some(*epoch)),
        _ => Err(anyhow::anyhow!("Epoch mismatch {epochs:?} in {file_name}")),
    }
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
                    "Epoch mismatch: {file_name} has epoch {epoch}, but expected epoch {expected_epoch}"
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
    info!("All reward files match epoch {epoch}");

    verify_stakers_rewards_present(
        &inflation_rewards,
        &mev_rewards,
        &validators_inflation,
        &validators_mev,
    )?;

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

// an empty stakers' rewards file with a populated validators' counterpart would derive 100% commissions and overcharge bonds
fn verify_stakers_rewards_present(
    inflation_rewards: &[StakeRewardEntry],
    mev_rewards: &[StakeRewardEntry],
    validators_inflation: &[VoteRewardEntry],
    validators_mev: &[VoteRewardEntry],
) -> anyhow::Result<()> {
    if !validators_inflation.is_empty() && inflation_rewards.is_empty() {
        return Err(anyhow::anyhow!(
            "{VALIDATORS_INFLATION_REWARDS_FILE} has entries but {INFLATION_REWARDS_FILE} is empty - either the stakers' inflation rewards export is incomplete or no stakers received inflation rewards; refusing to derive 100% commissions"
        ));
    }
    if !validators_mev.is_empty() && mev_rewards.is_empty() {
        return Err(anyhow::anyhow!(
            "{VALIDATORS_MEV_REWARDS_FILE} has entries but {MEV_REWARDS_FILE} is empty - either the stakers' MEV rewards export is incomplete or no stakers received MEV rewards; refusing to derive 100% commissions"
        ));
    }
    Ok(())
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
    let mut unmatched_inflation: u64 = 0;
    let mut unmatched_mev: u64 = 0;
    let mut unmatched_jito: u64 = 0;

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
            unmatched_inflation = unmatched_inflation.saturating_add(reward.amount);
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
            unmatched_mev = unmatched_mev.saturating_add(reward.amount);
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
            unmatched_jito = unmatched_jito.saturating_add(reward.amount);
            log::warn!(
                "No vote account found for stake account {} in Jito priority fee rewards",
                reward.stake_account
            );
        }
    }

    // unmatched stakers' rewards would inflate the derived onchain commissions and overcharge validator bonds
    if unmatched_inflation > 0 || unmatched_mev > 0 || unmatched_jito > 0 {
        return Err(anyhow::anyhow!(
            "Unmatched stake accounts in rewards files (lamports): inflation {unmatched_inflation}, mev {unmatched_mev}, jito priority fee {unmatched_jito}"
        ));
    }

    let total_rewards = rewards_map.values().map(|r| r.total_amount).sum::<u64>();
    let total_stakers_rewards = rewards_map
        .values()
        .map(|r| r.stakers_total_amount)
        .sum::<u64>();
    let total_validators_rewards = rewards_map
        .values()
        .map(|r| r.validators_total_amount)
        .sum::<u64>();
    // 1-SOL tolerance (divide before abs_diff) — matches the pre-fix threshold,
    // tolerating sub-SOL rounding in the input data.
    let total_rewards_sol = total_rewards / LAMPORTS_PER_SOL;
    let total_stakers_sol = total_stakers_rewards / LAMPORTS_PER_SOL;
    let total_validators_sol = total_validators_rewards / LAMPORTS_PER_SOL;
    assert!(
        total_rewards_sol.abs_diff(total_stakers_sol + total_validators_sol) <= 1,
        "Rewards mismatch: total={total_rewards} stakers={total_stakers_rewards} validators={total_validators_rewards} (SOL: {total_rewards_sol} vs {total_stakers_sol}+{total_validators_sol})"
    );
    info!(
        "Aggregated rewards (total: {total_rewards_sol} SOL, stakers: {total_stakers_sol} SOL, validators: {total_validators_sol} SOL) for {} vote accounts",
        rewards_map.len()
    );

    // commission_eff clamps negative realized commissions so bonds are never overcharged, but the
    // aggregate assert above can't see per-validator excesses (they net out). Surface each offender.
    for rewards in rewards_map.values() {
        for (kind, commission) in rewards.negative_realized_commissions() {
            log::warn!(
                "Negative realized {kind} commission {commission} for vote account {}: stakers' share exceeds validator gross — likely a rewards input discrepancy (validators_blocks.json vs jito_priority_fee.json, or the inflation/mev analogue)",
                rewards.vote_account
            );
        }
    }

    Ok(rewards_map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapshot_parser_validator_cli::stake_meta::StakeMeta;

    fn stake_meta(pubkey: Pubkey, validator: Pubkey) -> StakeMeta {
        StakeMeta {
            pubkey,
            validator: Some(validator),
            withdraw_authority: Pubkey::default(),
            stake_authority: Pubkey::default(),
            active_delegation_lamports: 0,
            balance_lamports: 0,
            activating_delegation_lamports: 0,
            deactivating_delegation_lamports: 0,
        }
    }

    fn stake_entry(stake_account: Pubkey, amount: u64) -> StakeRewardEntry {
        StakeRewardEntry {
            epoch: 1,
            stake_account,
            amount,
        }
    }

    fn vote_entry(vote_account: Pubkey, amount: u64) -> VoteRewardEntry {
        VoteRewardEntry {
            epoch: 1,
            vote_account,
            amount,
        }
    }

    #[test]
    fn test_verify_stakers_rewards_present() {
        let stakers = vec![stake_entry(Pubkey::new_unique(), 90)];
        let validators = vec![vote_entry(Pubkey::new_unique(), 10)];

        assert!(
            verify_stakers_rewards_present(&stakers, &stakers, &validators, &validators).is_ok()
        );
        assert!(verify_stakers_rewards_present(&[], &[], &[], &[]).is_ok());

        let error = verify_stakers_rewards_present(&[], &stakers, &validators, &validators)
            .unwrap_err()
            .to_string();
        assert!(error.contains("inflation.json is empty"), "{error}");

        let error = verify_stakers_rewards_present(&stakers, &[], &validators, &validators)
            .unwrap_err()
            .to_string();
        assert!(error.contains("mev.json is empty"), "{error}");
    }

    #[test]
    fn test_realized_commission_dec() {
        let rewards = VoteAccountRewards {
            inflation_rewards: 100,
            stakers_inflation_rewards: 95,
            mev_rewards: 0,
            stakers_mev_rewards: 0,
            block_rewards: 10,
            stakers_priority_fee_rewards: 12,
            // distinct from stakers_priority_fee_rewards to catch a wrong-field regression
            jito_priority_fee_rewards: 7,
            ..Default::default()
        };
        assert_eq!(
            rewards.realized_inflation_commission_dec(),
            Some(Decimal::new(5, 2))
        );
        assert_eq!(rewards.realized_mev_commission_dec(), None);
        assert_eq!(
            rewards.realized_block_commission_dec(),
            Some(Decimal::new(-2, 1))
        );
    }

    #[test]
    fn test_negative_realized_commissions() {
        let healthy = VoteAccountRewards {
            inflation_rewards: 100,
            stakers_inflation_rewards: 95,
            block_rewards: 10,
            stakers_priority_fee_rewards: 8,
            ..Default::default()
        };
        assert!(healthy.negative_realized_commissions().is_empty());

        // stakers priority fee (12) > block (10) → block commission -0.2
        let block_neg = VoteAccountRewards {
            block_rewards: 10,
            stakers_priority_fee_rewards: 12,
            ..Default::default()
        };
        assert_eq!(
            block_neg.negative_realized_commissions(),
            vec![("block", Decimal::new(-2, 1))]
        );

        // inflation and mev both exceed gross
        let multi = VoteAccountRewards {
            inflation_rewards: 5,
            stakers_inflation_rewards: 9,
            mev_rewards: 3,
            stakers_mev_rewards: 4,
            ..Default::default()
        };
        let kinds: Vec<_> = multi
            .negative_realized_commissions()
            .into_iter()
            .map(|(kind, _)| kind)
            .collect();
        assert_eq!(kinds, vec!["inflation", "mev"]);

        // gross 0 → realized is None (no commission), not flagged
        let zero_gross = VoteAccountRewards {
            block_rewards: 0,
            stakers_priority_fee_rewards: 5,
            ..Default::default()
        };
        assert!(zero_gross.negative_realized_commissions().is_empty());
    }

    #[test]
    fn test_aggregate_rewards_fails_on_unmatched_stake_account() {
        let vote_account = Pubkey::new_unique();
        let known_stake = Pubkey::new_unique();
        let unknown_stake = Pubkey::new_unique();
        let stake_meta_collection = StakeMetaCollection {
            epoch: 1,
            slot: 1,
            stake_metas: vec![stake_meta(known_stake, vote_account)],
        };

        let result = aggregate_rewards(
            vec![
                stake_entry(known_stake, 100),
                stake_entry(unknown_stake, 50),
            ],
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
            &stake_meta_collection,
        );

        let error = result.unwrap_err().to_string();
        assert!(
            error.contains("Unmatched stake accounts") && error.contains("inflation 50"),
            "Unexpected error: {error}"
        );
    }

    #[test]
    fn test_aggregate_rewards_all_matched() {
        let vote_account = Pubkey::new_unique();
        let known_stake = Pubkey::new_unique();
        let stake_meta_collection = StakeMetaCollection {
            epoch: 1,
            slot: 1,
            stake_metas: vec![stake_meta(known_stake, vote_account)],
        };

        let rewards_map = aggregate_rewards(
            vec![stake_entry(known_stake, 100)],
            vec![stake_entry(known_stake, 10)],
            vec![stake_entry(known_stake, 20)],
            vec![ValidatorBlockRewardEntry {
                epoch: 1,
                identity_account: Pubkey::default(),
                node_pubkey: Pubkey::default(),
                authorized_voter: Pubkey::default(),
                vote_account,
                amount: 10,
            }],
            vec![],
            vec![],
            &stake_meta_collection,
        )
        .unwrap();

        let rewards = rewards_map.get(&vote_account).unwrap();
        assert_eq!(rewards.stakers_inflation_rewards, 100);
        assert_eq!(rewards.stakers_mev_rewards, 20);
        assert_eq!(rewards.stakers_priority_fee_rewards, 10);
        assert_eq!(rewards.stakers_total_amount, 130);
        assert_eq!(rewards.inflation_rewards, 100);
        assert_eq!(rewards.mev_rewards, 20);
        assert_eq!(rewards.jito_priority_fee_rewards, 10);
        assert_eq!(rewards.block_rewards, 10);
        // jito redistributes block rewards: stakers gain 10, validators lose 10, total unchanged
        assert_eq!(rewards.validators_total_amount, 0);
        assert_eq!(rewards.total_amount, 130);
    }
}
