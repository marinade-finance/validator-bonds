use crate::settlement_config::BidDistributionConfig;
use anyhow::ensure;
use log::info;
use merkle_tree::serde_serialize::pubkey_string_conversion;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_config::SettlementConfigKind as PsrSettlementConfigKind;
use settlement_common::utils::{file_error, read_from_json_file};
use snapshot_parser::stake_meta::StakeMetaCollection;
use solana_sdk::clock::Epoch;
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;
use std::collections::{HashMap, HashSet};

use std::path::Path;

// Reward file name constants
const INFLATION_REWARDS_FILE: &str = "inflation.json";
const JITO_PRIORITY_FEE_FILE: &str = "jito_priority_fee.json";
const MEV_REWARDS_FILE: &str = "mev.json";
const VALIDATORS_BLOCKS_REWARDS_FILE: &str = "validators_blocks.json";
const VALIDATORS_INFLATION_REWARDS_FILE: &str = "validators_inflation.json";
const VALIDATORS_MEV_REWARDS_FILE: &str = "validators_mev.json";
// SIMD-0232 burns the inflation commission of a validator without a collector; optional before collector attribution
const VALIDATORS_INFLATION_BURNED_FILE: &str = "validators_inflation_burned.json";

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
    pub inflation_commission_burned: u64,
    // stakers earned inflation, but the validator has no commission row, neither paid nor burned
    pub voting_row_missing: bool,
    // the commission agave applied, from validators.json; stands in when the voting row is missing
    pub applied_inflation_commission_bps: Option<u16>,
}

impl VoteAccountRewards {
    // commission rate actually applied at rewards distribution; None when there were no rewards
    pub fn realized_inflation_commission_dec(&self) -> Option<Decimal> {
        if self.voting_row_missing {
            return self
                .applied_inflation_commission_bps
                .map(|bps| Decimal::from(bps) / Decimal::from(10000));
        }
        realized_commission_dec(self.inflation_rewards, self.stakers_inflation_rewards)
    }

    pub fn realized_mev_commission_dec(&self) -> Option<Decimal> {
        realized_commission_dec(self.mev_rewards, self.stakers_mev_rewards)
    }

    pub fn realized_block_commission_dec(&self) -> Option<Decimal> {
        realized_commission_dec(self.block_rewards, self.stakers_priority_fee_rewards)
    }

    /// Reward types where the stakers' recorded share exceeds the validator's gross:
    /// Some(c) — negative realized commission; None — stakers paid while gross is zero.
    fn realized_commission_anomalies(&self) -> Vec<(&'static str, Option<Decimal>)> {
        [
            (
                "inflation",
                self.inflation_rewards,
                self.stakers_inflation_rewards,
            ),
            ("mev", self.mev_rewards, self.stakers_mev_rewards),
            (
                "block",
                self.block_rewards,
                self.stakers_priority_fee_rewards,
            ),
        ]
        .into_iter()
        .filter_map(
            |(kind, gross, stakers)| match realized_commission_dec(gross, stakers) {
                Some(c) if c < Decimal::ZERO => Some((kind, Some(c))),
                None if stakers > 0 => Some((kind, None)),
                _ => None,
            },
        )
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

    /// Sets the applied inflation commission from validators.json for the vote accounts missing a voting row
    pub fn set_applied_inflation_commission(&mut self, applied_bps: &HashMap<Pubkey, u16>) {
        for rewards in self
            .rewards_by_vote_account
            .values_mut()
            .filter(|r| r.voting_row_missing)
        {
            rewards.applied_inflation_commission_bps =
                applied_bps.get(&rewards.vote_account).copied();
            if let Some(bps @ 1..10000) = rewards.applied_inflation_commission_bps {
                rewards.inflation_rewards = (rewards.stakers_inflation_rewards as u128 * 10000
                    / (10000 - bps) as u128) as u64;
            }
            match rewards.applied_inflation_commission_bps {
                Some(0) => {}
                Some(bps) => log::warn!(
                    "Vote account {} has no inflation commission row, using the applied {bps} bps from validators.json",
                    rewards.vote_account
                ),
                None => log::warn!(
                    "Vote account {} has no inflation commission row and no validators.json entry, its realized inflation commission is unknown",
                    rewards.vote_account
                ),
            }
        }
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
    validators_inflation_burned_epoch: Option<u64>,
) -> anyhow::Result<u64> {
    let epochs = [
        ("inflation", inflation_epoch),
        ("jito_priority_fee", jito_epoch),
        ("mev", mev_epoch),
        ("validators_blocks", blocks_epoch),
        ("validators_inflation", validators_inflation_epoch),
        ("validators_mev", validators_mev_epoch),
        (
            "validators_inflation_burned",
            validators_inflation_burned_epoch,
        ),
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

    let validators_inflation_burned_file = rewards_dir.join(VALIDATORS_INFLATION_BURNED_FILE);
    let validators_inflation_burned: Vec<VoteRewardEntry> =
        if validators_inflation_burned_file.exists() {
            info!("Loading validator burned inflation commission...");
            read_from_json_file(&validators_inflation_burned_file).map_err(file_error(
                "validators-inflation-burned",
                &validators_inflation_burned_file.to_string_lossy(),
            ))?
        } else {
            info!("No {VALIDATORS_INFLATION_BURNED_FILE}, no burned inflation commission");
            vec![]
        };

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
    let validators_inflation_burned_epoch = verify_epoch_consistency(
        &validators_inflation_burned,
        |e| e.epoch,
        VALIDATORS_INFLATION_BURNED_FILE,
    )?;

    let epoch = verify_all_epochs_match(
        inflation_epoch,
        jito_epoch,
        mev_epoch,
        blocks_epoch,
        validators_inflation_epoch,
        validators_mev_epoch,
        validators_inflation_burned_epoch,
    )?;
    info!("All reward files match epoch {epoch}");

    verify_stakers_rewards_present(
        &inflation_rewards,
        &mev_rewards,
        &validators_inflation,
        &validators_mev,
    )?;
    verify_block_rewards_present(&validators_blocks)?;

    info!("Aggregating rewards by vote account...");
    let rewards_by_vote_account = aggregate_rewards(
        inflation_rewards,
        jito_priority_fee_rewards,
        mev_rewards,
        validators_blocks,
        validators_inflation,
        validators_mev,
        validators_inflation_burned,
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

// unlike inflation and mev, block rewards have no stakers' counterpart file to cross-check against
fn verify_block_rewards_present(
    validators_blocks: &[ValidatorBlockRewardEntry],
) -> anyhow::Result<()> {
    if validators_blocks.is_empty() {
        return Err(anyhow::anyhow!(
            "{VALIDATORS_BLOCKS_REWARDS_FILE} is empty - every bond would be charged zero block commission and the stakers' block rewards would drop out of the payout"
        ));
    }
    Ok(())
}

/// Aggregate all reward types by vote account
#[allow(clippy::too_many_arguments)]
fn aggregate_rewards(
    inflation_rewards: Vec<StakeRewardEntry>,
    jito_priority_fee_rewards: Vec<StakeRewardEntry>,
    mev_rewards: Vec<StakeRewardEntry>,
    validators_blocks: Vec<ValidatorBlockRewardEntry>,
    validators_inflation: Vec<VoteRewardEntry>,
    validators_mev: Vec<VoteRewardEntry>,
    validators_inflation_burned: Vec<VoteRewardEntry>,
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
    let mut with_voting_row: HashSet<Pubkey> = HashSet::new();
    for reward in validators_inflation {
        with_voting_row.insert(reward.vote_account);
        let entry = rewards_map
            .entry(reward.vote_account)
            .or_insert_with(|| VoteAccountRewards {
                vote_account: reward.vote_account,
                ..Default::default()
            });
        if entry.stakers_inflation_rewards == 0 {
            log::warn!(
                "Vote account {} has an inflation commission row but no stakers' inflation rewards",
                reward.vote_account
            );
        }
        entry.inflation_rewards = entry.inflation_rewards.saturating_add(reward.amount);
        entry.validators_total_amount = entry.validators_total_amount.saturating_add(reward.amount);
        entry.total_amount = entry.total_amount.saturating_add(reward.amount);
    }

    info!(" > Processing validator burned inflation commission...");
    for reward in validators_inflation_burned {
        with_voting_row.insert(reward.vote_account);
        let entry = rewards_map
            .entry(reward.vote_account)
            .or_insert_with(|| VoteAccountRewards {
                vote_account: reward.vote_account,
                ..Default::default()
            });
        entry.inflation_commission_burned = entry
            .inflation_commission_burned
            .saturating_add(reward.amount);
        entry.inflation_rewards = entry.inflation_rewards.saturating_add(reward.amount);
        entry.validators_total_amount = entry.validators_total_amount.saturating_add(reward.amount);
        entry.total_amount = entry.total_amount.saturating_add(reward.amount);
    }
    for entry in rewards_map.values_mut() {
        entry.voting_row_missing =
            entry.stakers_inflation_rewards > 0 && !with_voting_row.contains(&entry.vote_account);
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
        for (kind, anomaly) in rewards.realized_commission_anomalies() {
            match anomaly {
                Some(commission) => log::warn!(
                    "Negative realized {kind} commission {commission} for vote account {}: stakers' share exceeds validator gross — likely a rewards input discrepancy (validators_blocks.json vs jito_priority_fee.json, or the inflation/mev analogue)",
                    rewards.vote_account
                ),
                None => log::warn!(
                    "Stakers received {kind} rewards while validator gross is zero for vote account {} — likely a rewards input discrepancy",
                    rewards.vote_account
                ),
            }
        }
    }

    Ok(rewards_map)
}

/// Vote accounts with active stake whose stakers got no inflation rewards (SIMD-0357 refusal)
pub fn unpaid_vote_accounts(
    stake_meta_collection: &StakeMetaCollection,
    rewards_collection: &RewardsCollection,
) -> HashSet<Pubkey> {
    stake_meta_collection
        .stake_metas
        .iter()
        .filter(|s| s.active_delegation_lamports > 0)
        .filter_map(|s| s.validator)
        .filter(|v| {
            rewards_collection
                .get(v)
                .is_none_or(|r| r.stakers_inflation_rewards == 0)
        })
        .collect()
}

pub fn has_sam_configs(config: &BidDistributionConfig) -> bool {
    config.bidding_config().is_some()
        || config.bid_too_low_penalty_config().is_some()
        || config.blacklist_penalty_config().is_some()
        || config.bond_risk_fee_config().is_some()
}

pub fn has_vat_unadmitted_config(config: &BidDistributionConfig) -> bool {
    config.psr_settlements().iter().any(|c| {
        matches!(
            c.kind,
            PsrSettlementConfigKind::VatUnadmittedSettlement { .. }
        )
    })
}

/// --rewards-dir feeds the SAM settlements and the VAT-unadmitted detection, nothing else
pub fn check_rewards_dir(
    config: &BidDistributionConfig,
    rewards_dir_given: bool,
) -> anyhow::Result<()> {
    if has_vat_unadmitted_config(config) {
        ensure!(
            rewards_dir_given,
            "--rewards-dir is required when a VatUnadmittedSettlement config is present"
        );
    }
    if !has_sam_configs(config) && !has_vat_unadmitted_config(config) {
        ensure!(
            !rewards_dir_given,
            "--rewards-dir provided but neither SAM nor VatUnadmittedSettlement configs found in config file"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapshot_parser::stake_meta::StakeMeta;

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
    fn test_verify_block_rewards_present() {
        let blocks = vec![ValidatorBlockRewardEntry {
            epoch: 1,
            identity_account: Pubkey::default(),
            node_pubkey: Pubkey::default(),
            authorized_voter: Pubkey::default(),
            vote_account: Pubkey::new_unique(),
            amount: 10,
        }];
        assert!(verify_block_rewards_present(&blocks).is_ok());

        let error = verify_block_rewards_present(&[]).unwrap_err().to_string();
        assert!(error.contains("validators_blocks.json is empty"), "{error}");
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
    fn test_realized_commission_anomalies() {
        let healthy = VoteAccountRewards {
            inflation_rewards: 100,
            stakers_inflation_rewards: 95,
            block_rewards: 10,
            stakers_priority_fee_rewards: 8,
            ..Default::default()
        };
        assert!(healthy.realized_commission_anomalies().is_empty());

        // stakers priority fee (12) > block (10) → block commission -0.2
        let block_neg = VoteAccountRewards {
            block_rewards: 10,
            stakers_priority_fee_rewards: 12,
            ..Default::default()
        };
        assert_eq!(
            block_neg.realized_commission_anomalies(),
            vec![("block", Some(Decimal::new(-2, 1)))]
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
            .realized_commission_anomalies()
            .into_iter()
            .map(|(kind, _)| kind)
            .collect();
        assert_eq!(kinds, vec!["inflation", "mev"]);

        // stakers paid while gross is 0 → flagged without a finite commission ratio
        let zero_gross = VoteAccountRewards {
            block_rewards: 0,
            stakers_priority_fee_rewards: 5,
            ..Default::default()
        };
        assert_eq!(
            zero_gross.realized_commission_anomalies(),
            vec![("block", None)]
        );

        // no rewards at all → nothing flagged
        assert!(VoteAccountRewards::default()
            .realized_commission_anomalies()
            .is_empty());
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

    fn block_entry(vote_account: Pubkey) -> ValidatorBlockRewardEntry {
        ValidatorBlockRewardEntry {
            epoch: 1,
            identity_account: Pubkey::default(),
            node_pubkey: Pubkey::default(),
            authorized_voter: Pubkey::default(),
            vote_account,
            amount: 0,
        }
    }

    fn aggregate_inflation(
        validators_inflation: Vec<VoteRewardEntry>,
        validators_inflation_burned: Vec<VoteRewardEntry>,
    ) -> (Pubkey, HashMap<Pubkey, VoteAccountRewards>) {
        let vote_account = Pubkey::new_unique();
        let stake = Pubkey::new_unique();
        let stake_meta_collection = StakeMetaCollection {
            epoch: 1,
            slot: 1,
            stake_metas: vec![stake_meta(stake, vote_account)],
        };
        let rewards_map = aggregate_rewards(
            vec![stake_entry(stake, 90)],
            vec![],
            vec![],
            vec![block_entry(vote_account)],
            validators_inflation
                .into_iter()
                .map(|e| vote_entry(vote_account, e.amount))
                .collect(),
            vec![],
            validators_inflation_burned
                .into_iter()
                .map(|e| vote_entry(vote_account, e.amount))
                .collect(),
            &stake_meta_collection,
        )
        .unwrap();
        (vote_account, rewards_map)
    }

    #[test]
    fn test_burned_inflation_commission_is_validator_earnings() {
        let (vote_account, rewards_map) =
            aggregate_inflation(vec![], vec![vote_entry(Pubkey::default(), 10)]);
        let rewards = rewards_map.get(&vote_account).unwrap();
        assert_eq!(rewards.inflation_commission_burned, 10);
        assert_eq!(rewards.inflation_rewards, 100);
        assert_eq!(rewards.validators_total_amount, 10);
        assert_eq!(rewards.total_amount, 100);
        assert!(!rewards.voting_row_missing);
        // burned / (stakers + burned)
        assert_eq!(
            rewards.realized_inflation_commission_dec(),
            Some(Decimal::new(1, 1))
        );
    }

    #[test]
    fn test_missing_voting_row_falls_back_to_the_applied_commission() {
        let (vote_account, rewards_map) = aggregate_inflation(vec![], vec![]);
        let mut rewards_collection = RewardsCollection {
            epoch: 1,
            rewards_by_vote_account: rewards_map,
        };
        let rewards = rewards_collection.get(&vote_account).unwrap();
        assert!(rewards.voting_row_missing);
        assert_eq!(rewards.realized_inflation_commission_dec(), None);

        rewards_collection.set_applied_inflation_commission(&HashMap::from([(vote_account, 500)]));
        let rewards = rewards_collection.get(&vote_account).unwrap();
        // the stakers' 90 are 95% of the gross: floor(90 / 0.95)
        assert_eq!(rewards.inflation_rewards, 94);
        assert_eq!(
            rewards.realized_inflation_commission_dec(),
            Some(Decimal::new(5, 2))
        );
    }

    #[test]
    fn test_all_inflation_rows_present_keep_the_realized_commission() {
        let (vote_account, rewards_map) =
            aggregate_inflation(vec![vote_entry(Pubkey::default(), 10)], vec![]);
        let rewards = rewards_map.get(&vote_account).unwrap();
        assert!(!rewards.voting_row_missing);
        assert_eq!(rewards.inflation_commission_burned, 0);
        assert_eq!(
            rewards.realized_inflation_commission_dec(),
            Some(Decimal::new(1, 1))
        );
    }

    #[test]
    fn test_unpaid_vote_accounts_have_active_stake_and_no_stakers_inflation() {
        let (paid, unpaid_no_entry, unpaid_zero, inactive) = (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        );
        let active = |validator| StakeMeta {
            active_delegation_lamports: 1,
            ..stake_meta(Pubkey::new_unique(), validator)
        };
        let stake_meta_collection = StakeMetaCollection {
            epoch: 1,
            slot: 1,
            stake_metas: vec![
                active(paid),
                active(unpaid_no_entry),
                active(unpaid_zero),
                stake_meta(Pubkey::new_unique(), inactive),
            ],
        };
        let rewards = |vote_account, stakers_inflation_rewards| VoteAccountRewards {
            vote_account,
            stakers_inflation_rewards,
            ..Default::default()
        };
        let rewards_collection = RewardsCollection {
            epoch: 1,
            rewards_by_vote_account: HashMap::from([
                (paid, rewards(paid, 5)),
                (unpaid_zero, rewards(unpaid_zero, 0)),
            ]),
        };
        assert_eq!(
            unpaid_vote_accounts(&stake_meta_collection, &rewards_collection),
            HashSet::from([unpaid_no_entry, unpaid_zero])
        );
    }
}
