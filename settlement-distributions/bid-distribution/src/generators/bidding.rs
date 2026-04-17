use crate::rewards::{RewardsCollection, VoteAccountRewards};
use crate::sam_meta::{AuctionValidatorValues, ValidatorSamMeta};
use crate::settlement_config::{FeeConfig, SettlementConfig};
use anyhow::{anyhow, ensure};
use log::{debug, info, warn};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::{Settlement, SettlementClaim, SettlementReason};
use settlement_common::stake_meta_index::StakeMetaIndex;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::fmt;
use std::ops::Mul;

use super::{add_to_settlement_collection, get_fee_deposit_stake_accounts};

#[derive(Serialize, Debug, Default)]
pub struct ResultSettlementClaims {
    pub inflation_commission_claim: Decimal,
    pub mev_commission_claim: Decimal,
    pub block_commission_claim: Decimal,
    pub static_bid_claim: Decimal,
    pub activating_bid_claim: Decimal,
}

impl ResultSettlementClaims {
    pub fn sum(&self) -> Decimal {
        self.inflation_commission_claim
            .saturating_add(self.mev_commission_claim)
            .saturating_add(self.block_commission_claim)
            .saturating_add(self.static_bid_claim)
            .saturating_add(self.activating_bid_claim)
    }

    pub fn sum_u64(&self) -> anyhow::Result<u64> {
        self.sum()
            .to_u64()
            .ok_or_else(|| anyhow!("Failed to_u64 for total settlement claims: {}", self.sum()))
    }
}

impl fmt::Display for ResultSettlementClaims {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "static_bid_claim={}, activating_bid_claim={}, inflation_commission_claim={}, mev_commission_claim={}, block_commission_claim={}, total={}",
            self.static_bid_claim,
            self.activating_bid_claim,
            self.inflation_commission_claim,
            self.mev_commission_claim,
            self.block_commission_claim,
            self.sum()
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BidSettlementDetails {
    pub total_active_stake: u64,
    pub total_marinade_active_stake: u64,
    pub auction_effective_static_bid: String,
    pub marinade_stake_share: String,
    pub marinade_inflation_rewards: String,
    pub marinade_mev_rewards: String,
    pub marinade_block_rewards: String,
    pub staker_inflation_rewards: Option<String>,
    pub staker_mev_rewards: Option<String>,
    pub staker_block_rewards: Option<String>,
    pub staker_bid_rewards: Option<String>,
    pub total_marinade_stakers_rewards: String,
    pub settlement_claims: serde_json::Value,
    pub stakers_total_claim: u64,
    pub marinade_fee_claim: u64,
    pub dao_fee_claim: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PriorityFeeSettlementDetails {
    pub total_marinade_activating_stake: u64,
    pub total_marinade_uncharged_activating_stake: u64,
    pub activating_stake_pmpe: String,
    pub activating_bid_claim: String,
    pub activating_stakers_pool: u64,
    pub marinade_fee_claim: u64,
    pub dao_fee_claim: u64,
}

pub fn generate_bid_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &[ValidatorSamMeta],
    rewards_collection: &RewardsCollection,
    settlement_config: &SettlementConfig,
    fee_config: &FeeConfig,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
) -> anyhow::Result<Vec<Settlement>> {
    let epoch = stake_meta_index.stake_meta_collection.epoch;
    info!("Generating bid settlements in epoch {epoch}...");
    let fee_percentages = fee_config.fee_percentages();
    let settlement_meta_funder = settlement_config.meta().clone();
    let mut settlement_claim_collections = vec![];

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
            let grouped_stake_metas: Vec<_> = grouped_stake_metas.collect();
            // Compute totals in a single pass (no double iteration)
            let mut total_active_stake: u64 = 0;
            let mut total_marinade_active_stake: u64 = 0;
            let mut total_marinade_activating_stake: u64 = 0;
            let mut total_marinade_uncharged_activating_stake: u64 = 0;
            for ((_, stake_authority), metas) in &grouped_stake_metas {
                for meta in metas.iter() {
                    total_active_stake += meta.active_delegation_lamports;
                    if stake_authority_filter(stake_authority) {
                        total_marinade_active_stake += meta.active_delegation_lamports;
                        if meta.activating_delegation_lamports > 0 {
                            // Charge only on first epoch (active==0): stake can take multiple
                            // epochs to warm up, so active>0 means already charged last epoch.
                            if meta.active_delegation_lamports == 0 {
                                total_marinade_activating_stake +=
                                    meta.activating_delegation_lamports;
                            } else {
                                total_marinade_uncharged_activating_stake +=
                                    meta.activating_delegation_lamports;
                                info!(
                                    "activating charge skipped for stake account {} \
                                     (validator {}, active={}, activating={}): \
                                     multi-epoch warmup, avoiding double-charge",
                                    meta.pubkey,
                                    validator.vote_account,
                                    meta.active_delegation_lamports,
                                    meta.activating_delegation_lamports,
                                );
                            }
                        }
                    }
                }
            }
            if total_marinade_uncharged_activating_stake > 0 {
                info!(
                    "validator {}: skipped activating charge on {} lamports \
                     across multi-epoch warmup accounts",
                    validator.vote_account, total_marinade_uncharged_activating_stake,
                );
            }
            // Marinade stake is a subset of total stake, so this covers both zero-stake cases.
            if total_marinade_active_stake == 0 && total_marinade_activating_stake == 0 {
                warn!(
                    "Skipping validator {} with zero marinade active and activating stake",
                    validator.vote_account
                );
                continue;
            }

            let rewards = if let Some(rewards) = rewards_collection.get(&validator.vote_account) {
                rewards
            } else {
                // This may happen correctly if the validator had no rewards in the epoch with 0 credits
                warn!(
                    "No rewards found for validator {} in epoch {}, setting nothing.",
                    validator.vote_account, epoch
                );
                &VoteAccountRewards {
                    vote_account: validator.vote_account,
                    ..VoteAccountRewards::default()
                }
            };

            let marinade_stake_share = if total_active_stake > 0 {
                Decimal::from(total_marinade_active_stake) / Decimal::from(total_active_stake)
            } else {
                Decimal::ZERO
            };
            debug!("Validator {} marinade stake share: {marinade_stake_share}, total: {total_active_stake}, marinade stake: {total_marinade_active_stake}", validator.vote_account);
            let marinade_inflation_rewards =
                Decimal::from(rewards.inflation_rewards).mul(marinade_stake_share);
            let marinade_mev_rewards = Decimal::from(rewards.mev_rewards).mul(marinade_stake_share);
            let marinade_block_rewards =
                Decimal::from(rewards.block_rewards).mul(marinade_stake_share);
            debug!(
                "Validator {} marinade rewards: inflation {}, mev {}, block {}",
                validator.vote_account,
                marinade_inflation_rewards,
                marinade_mev_rewards,
                marinade_block_rewards
            );

            let mut settlement_claim = ResultSettlementClaims::default();
            if let Some(AuctionValidatorValues {
                commissions: Some(commissions),
                ..
            }) = &validator.values
            {
                let inflation_commission_in_bond_dec = commissions
                    .inflation_commission_in_bond_dec
                    .unwrap_or(Decimal::ONE);
                let inflation_commission_onchain_dec = commissions.inflation_commission_onchain_dec;
                ensure!(
                    inflation_commission_onchain_dec <= Decimal::ONE,
                    "Inflation commission validator {} onchain decimal {} cannot be greater than 1",
                    validator.vote_account,
                    inflation_commission_onchain_dec
                );
                if inflation_commission_onchain_dec > inflation_commission_in_bond_dec {
                    let inflation_commission_diff =
                        inflation_commission_onchain_dec - inflation_commission_in_bond_dec;
                    ensure!(
                        inflation_commission_diff >= Decimal::ZERO,
                        "Inflation commission diff cannot be negative for validator {}",
                        validator.vote_account
                    );
                    settlement_claim.inflation_commission_claim =
                        marinade_inflation_rewards.mul(inflation_commission_diff);
                }
                if let Some(mev_commission_in_bond_dec) = commissions.mev_commission_in_bond_dec {
                    let mev_commission_onchain_dec = commissions
                        .mev_commission_onchain_dec
                        .unwrap_or(Decimal::ONE);
                    if mev_commission_onchain_dec > mev_commission_in_bond_dec {
                        let mev_commission_diff =
                            mev_commission_onchain_dec - mev_commission_in_bond_dec;
                        ensure!(
                            mev_commission_diff >= Decimal::ZERO,
                            "MEV commission diff cannot be negative for validator {}",
                            validator.vote_account
                        );
                        settlement_claim.mev_commission_claim =
                            marinade_mev_rewards.mul(mev_commission_diff);
                    }
                }
                if let Some(block_rewards_commission_in_bond_dec) =
                    commissions.block_rewards_commission_in_bond_dec
                {
                    if rewards.block_rewards > 0 {
                        // Use Decimal to avoid u64 underflow if jito_priority_fee_rewards > block_rewards
                        let block_rewards_jito_commission_onchain_dec =
                            (Decimal::from(rewards.block_rewards)
                                - Decimal::from(rewards.jito_priority_fee_rewards))
                                / Decimal::from(rewards.block_rewards);
                        if block_rewards_jito_commission_onchain_dec
                            > block_rewards_commission_in_bond_dec
                        {
                            let block_rewards_commission_diff =
                                block_rewards_jito_commission_onchain_dec
                                    - block_rewards_commission_in_bond_dec;
                            ensure!(
                                block_rewards_commission_diff >= Decimal::ZERO,
                                "Block rewards commission diff cannot be negative for validator {}",
                                validator.vote_account
                            );
                            settlement_claim.block_commission_claim =
                                marinade_block_rewards.mul(block_rewards_commission_diff);
                        }
                    }
                }
            }

            // The Marinade minimum fee must be at least the percentage derived from the rewards portion promised to stakers (what totalPmpe represents).
            // Based on the promised commission, we recalculate the stakers total share from the rewards earned in the previous epoch.
            let auction_effective_static_bid = validator
                .rev_share
                .auction_effective_static_bid_pmpe
                .unwrap_or(validator.effective_bid);
            // bid per mille, dividing by 1000 gives the ratio per unit - whatever SOL, lamport, etc., since it represents a ratio
            let effective_static_bid = auction_effective_static_bid / Decimal::ONE_THOUSAND;
            settlement_claim.static_bid_claim =
                Decimal::from(total_marinade_active_stake) * effective_static_bid;
            if let Some(activating_stake_pmpe) = validator.rev_share.activating_stake_pmpe {
                settlement_claim.activating_bid_claim =
                    Decimal::from(total_marinade_activating_stake) * activating_stake_pmpe
                        / Decimal::ONE_THOUSAND;
            }
            let (
                active_stakers_rewards,
                staker_inflation_rewards_opt,
                staker_mev_rewards_opt,
                staker_block_rewards_opt,
                staker_bid_rewards_opt,
            ) = if let Some(AuctionValidatorValues {
                commissions: Some(commissions),
                ..
            }) = &validator.values
            {
                // total_pmpe =
                let staker_inflation_rewards = marinade_inflation_rewards
                    * (Decimal::ONE - commissions.inflation_commission_dec);
                let staker_mev_rewards =
                    marinade_mev_rewards * (Decimal::ONE - commissions.mev_commission_dec);
                let staker_block_rewards = marinade_block_rewards
                    * (Decimal::ONE - commissions.block_rewards_commission_dec);
                let staker_bid_rewards = validator.rev_share.bid_pmpe / Decimal::ONE_THOUSAND
                    * Decimal::from(total_marinade_active_stake);
                let total = staker_inflation_rewards
                    + staker_mev_rewards
                    + staker_block_rewards
                    + staker_bid_rewards;
                (
                    total,
                    Some(staker_inflation_rewards),
                    Some(staker_mev_rewards),
                    Some(staker_block_rewards),
                    Some(staker_bid_rewards),
                )
            } else {
                let total_rev_share = validator.rev_share.total_pmpe / Decimal::ONE_THOUSAND;
                let total = Decimal::from(total_marinade_active_stake) * total_rev_share;
                (total, None, None, None, None)
            };
            let total_marinade_stakers_rewards =
                active_stakers_rewards + settlement_claim.activating_bid_claim;
            info!(
                "{} total stakers rewards: {} (inflation: {:?}, mev: {:?}, block: {:?}, bid: {:?}), claims: {}",
                validator.vote_account,
                total_marinade_stakers_rewards,
                marinade_inflation_rewards,
                marinade_mev_rewards,
                marinade_block_rewards,
                staker_bid_rewards_opt,
                settlement_claim
            );

            // Marinade should get at least the percentage amount of total rewards as per the distributor fee percentage
            let minimum_distributor_fee_claim =
                total_marinade_stakers_rewards * fee_percentages.marinade_distributor_fee;
            let distributor_fee_claim = minimum_distributor_fee_claim
                .min(settlement_claim.sum())
                .to_u64()
                .ok_or_else(|| anyhow!("Failed to_u64 for distributor_fee_claim"))?;

            // minimum is 0 when distributor fee is of amount of total (stakers get nothing)
            let settlement_claim_sum = settlement_claim.sum_u64()?;
            let stakers_total_claim = settlement_claim_sum.saturating_sub(distributor_fee_claim);
            // Split stakers_total_claim between active stakers (earned rewards + static bid)
            // and activating stakers (activating charge), proportional to each pool's share.
            let activating_fraction = if settlement_claim_sum > 0 {
                settlement_claim.activating_bid_claim / settlement_claim.sum()
            } else {
                Decimal::ZERO
            };
            let activating_stakers_pool: u64 = (Decimal::from(stakers_total_claim)
                * activating_fraction)
                .to_u64()
                .unwrap_or(0);
            let active_stakers_pool = stakers_total_claim.saturating_sub(activating_stakers_pool);
            let dao_fee_claim = (Decimal::from(distributor_fee_claim)
                * fee_percentages.dao_fee_share)
                .to_u64()
                .ok_or_else(|| anyhow!("Failed to_u64 for dao_fee_claim"))?;
            let marinade_fee_claim = distributor_fee_claim - dao_fee_claim;
            ensure!(
                settlement_claim_sum == stakers_total_claim + marinade_fee_claim + dao_fee_claim,
                "Settlement claim sum {} != stakers {} + marinade fee {} + dao fee {} for validator {}",
                settlement_claim_sum,
                stakers_total_claim,
                marinade_fee_claim,
                dao_fee_claim,
                validator.vote_account
            );

            let fee_deposit = get_fee_deposit_stake_accounts(stake_meta_index, fee_config);

            let mut bidding_claims = vec![];
            let mut bidding_claims_amount = 0;
            let mut priority_fee_claims = vec![];
            let mut priority_fee_claims_amount = 0;

            for (&(withdraw_authority, stake_authority), stake_metas) in &grouped_stake_metas {
                if !stake_authority_filter(stake_authority) {
                    continue;
                }
                // Active stakers: proportional share of active_stakers_pool
                if total_marinade_active_stake > 0 && active_stakers_pool > 0 {
                    let active_accounts: HashMap<_, _> = stake_metas
                        .iter()
                        .filter(|s| s.active_delegation_lamports > 0)
                        .map(|s| (s.pubkey, s.active_delegation_lamports))
                        .collect();
                    let active_sum: u64 = active_accounts.values().sum();
                    if active_sum > 0 {
                        let staker_share =
                            Decimal::from(active_sum) / Decimal::from(total_marinade_active_stake);
                        let claim_amount = (staker_share * Decimal::from(active_stakers_pool))
                            .to_u64()
                            .ok_or_else(|| {
                                anyhow!(
                                    "claim_amount is not representable as u64 for validator {}",
                                    validator.vote_account
                                )
                            })?;
                        if claim_amount > 0 {
                            bidding_claims.push(SettlementClaim {
                                withdraw_authority: *withdraw_authority,
                                stake_authority: *stake_authority,
                                stake_accounts: active_accounts,
                                claim_amount,
                                active_stake: active_sum,
                                activating_stake: 0,
                            });
                            bidding_claims_amount += claim_amount;
                        }
                    }
                }
                // Activating stakers: proportional share of activating_stakers_pool → PriorityFee settlement
                if total_marinade_activating_stake > 0 && activating_stakers_pool > 0 {
                    let activating_accounts: HashMap<_, _> = stake_metas
                        .iter()
                        .filter(|s| {
                            s.active_delegation_lamports == 0
                                && s.activating_delegation_lamports > 0
                        })
                        .map(|s| (s.pubkey, s.activating_delegation_lamports))
                        .collect();
                    let activating_sum: u64 = activating_accounts.values().sum();
                    if activating_sum > 0 {
                        let staker_share = Decimal::from(activating_sum)
                            / Decimal::from(total_marinade_activating_stake);
                        let claim_amount =
                            (staker_share * Decimal::from(activating_stakers_pool))
                                .to_u64()
                                .ok_or_else(|| {
                                    anyhow!(
                                        "activating claim_amount not representable as u64 for validator {}",
                                        validator.vote_account
                                    )
                                })?;
                        if claim_amount > 0 {
                            priority_fee_claims.push(SettlementClaim {
                                withdraw_authority: *withdraw_authority,
                                stake_authority: *stake_authority,
                                stake_accounts: activating_accounts,
                                claim_amount,
                                active_stake: 0,
                                activating_stake: activating_sum,
                            });
                            priority_fee_claims_amount += claim_amount;
                        }
                    }
                }
            }
            ensure!(
                bidding_claims_amount + priority_fee_claims_amount <= stakers_total_claim,
                "Claims amount {} exceeded stakers total claim {} for validator {}",
                bidding_claims_amount + priority_fee_claims_amount,
                stakers_total_claim,
                validator.vote_account
            );

            // Split fee claims proportionally between active and activating pools
            let activating_fee_fraction = if stakers_total_claim > 0 {
                Decimal::from(activating_stakers_pool) / Decimal::from(stakers_total_claim)
            } else if settlement_claim_sum > 0 {
                activating_fraction
            } else {
                Decimal::ZERO
            };
            let marinade_fee_for_priority = (Decimal::from(marinade_fee_claim)
                * activating_fee_fraction)
                .to_u64()
                .unwrap_or(0);
            let marinade_fee_for_bidding =
                marinade_fee_claim.saturating_sub(marinade_fee_for_priority);
            let dao_fee_for_priority = (Decimal::from(dao_fee_claim) * activating_fee_fraction)
                .to_u64()
                .unwrap_or(0);
            let dao_fee_for_bidding = dao_fee_claim.saturating_sub(dao_fee_for_priority);

            let authorities = fee_config.fee_authorities();
            if marinade_fee_for_bidding > 0 {
                bidding_claims.push(SettlementClaim {
                    withdraw_authority: authorities.marinade_withdraw,
                    stake_authority: authorities.marinade_stake,
                    stake_accounts: fee_deposit.marinade_active.clone(),
                    claim_amount: marinade_fee_for_bidding,
                    active_stake: fee_deposit.marinade_active.values().sum(),
                    activating_stake: 0,
                });
                bidding_claims_amount += marinade_fee_for_bidding;
            }
            if dao_fee_for_bidding > 0 {
                bidding_claims.push(SettlementClaim {
                    withdraw_authority: authorities.dao_withdraw,
                    stake_authority: authorities.dao_stake,
                    stake_accounts: fee_deposit.dao_active.clone(),
                    claim_amount: dao_fee_for_bidding,
                    active_stake: fee_deposit.dao_active.values().sum(),
                    activating_stake: 0,
                });
                bidding_claims_amount += dao_fee_for_bidding;
            }
            if marinade_fee_for_priority > 0 {
                priority_fee_claims.push(SettlementClaim {
                    withdraw_authority: authorities.marinade_withdraw,
                    stake_authority: authorities.marinade_stake,
                    stake_accounts: fee_deposit.marinade_activating.clone(),
                    claim_amount: marinade_fee_for_priority,
                    active_stake: 0,
                    activating_stake: fee_deposit.marinade_activating.values().sum(),
                });
                priority_fee_claims_amount += marinade_fee_for_priority;
            }
            if dao_fee_for_priority > 0 {
                priority_fee_claims.push(SettlementClaim {
                    withdraw_authority: authorities.dao_withdraw,
                    stake_authority: authorities.dao_stake,
                    stake_accounts: fee_deposit.dao_activating.clone(),
                    claim_amount: dao_fee_for_priority,
                    active_stake: 0,
                    activating_stake: fee_deposit.dao_activating.values().sum(),
                });
                priority_fee_claims_amount += dao_fee_for_priority;
            }
            ensure!(
                bidding_claims_amount + priority_fee_claims_amount <= settlement_claim_sum,
                "The sum of total claims {} exceeds the total claim amount {} after adding fees for validator {}",
                bidding_claims_amount + priority_fee_claims_amount,
                settlement_claim_sum,
                validator.vote_account
            );

            let settlement_details = BidSettlementDetails {
                total_active_stake,
                total_marinade_active_stake,
                auction_effective_static_bid: auction_effective_static_bid.to_string(),
                marinade_stake_share: marinade_stake_share.to_string(),
                marinade_inflation_rewards: marinade_inflation_rewards.to_string(),
                marinade_mev_rewards: marinade_mev_rewards.to_string(),
                marinade_block_rewards: marinade_block_rewards.to_string(),
                staker_inflation_rewards: staker_inflation_rewards_opt.map(|d| d.to_string()),
                staker_mev_rewards: staker_mev_rewards_opt.map(|d| d.to_string()),
                staker_block_rewards: staker_block_rewards_opt.map(|d| d.to_string()),
                staker_bid_rewards: staker_bid_rewards_opt.map(|d| d.to_string()),
                total_marinade_stakers_rewards: total_marinade_stakers_rewards.to_string(),
                settlement_claims: serde_json::to_value(&settlement_claim)?,
                stakers_total_claim,
                marinade_fee_claim: marinade_fee_for_bidding,
                dao_fee_claim: dao_fee_for_bidding,
            };
            let details_json = serde_json::to_value(&settlement_details)?;

            let priority_fee_details = PriorityFeeSettlementDetails {
                total_marinade_activating_stake,
                total_marinade_uncharged_activating_stake,
                activating_stake_pmpe: validator
                    .rev_share
                    .activating_stake_pmpe
                    .unwrap_or(Decimal::ZERO)
                    .to_string(),
                activating_bid_claim: settlement_claim.activating_bid_claim.to_string(),
                activating_stakers_pool,
                marinade_fee_claim: marinade_fee_for_priority,
                dao_fee_claim: dao_fee_for_priority,
            };
            add_to_settlement_collection(
                &mut settlement_claim_collections,
                priority_fee_claims,
                priority_fee_claims_amount,
                SettlementReason::PriorityFee,
                validator.vote_account,
                &settlement_meta_funder,
                Some(serde_json::to_value(&priority_fee_details)?),
            );
            add_to_settlement_collection(
                &mut settlement_claim_collections,
                bidding_claims,
                bidding_claims_amount,
                SettlementReason::Bidding,
                validator.vote_account,
                &settlement_meta_funder,
                Some(details_json),
            );
        }
    }
    Ok(settlement_claim_collections)
}
