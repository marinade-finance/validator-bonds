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
}

impl ResultSettlementClaims {
    pub fn sum(&self) -> Decimal {
        self.inflation_commission_claim
            .saturating_add(self.mev_commission_claim)
            .saturating_add(self.block_commission_claim)
            .saturating_add(self.static_bid_claim)
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
            "static_bid_claim={}, inflation_commission_claim={}, mev_commission_claim={}, block_commission_claim={}, total={}",
            self.static_bid_claim,
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
    pub effective_sam_marinade_active_stake: u64,
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
            let (total_active_stake, total_marinade_active_stake): (u64, u64) = grouped_stake_metas
                .iter()
                .flat_map(|(key, metas)| metas.iter().map(move |meta| (*key, meta)))
                .fold(
                    (0, 0),
                    |(total, marinade_total), ((_, stake_authority), meta)| {
                        let lamports = meta.active_delegation_lamports;
                        let marinade_lamports = if stake_authority_filter(stake_authority) {
                            lamports
                        } else {
                            0
                        };
                        (total + lamports, marinade_total + marinade_lamports)
                    },
                );
            if total_active_stake == 0 {
                warn!(
                    "Skipping validator {} with zero total active stake {}",
                    validator.vote_account, total_active_stake,
                );
                continue;
            }
            if total_marinade_active_stake == 0 {
                warn!(
                    "Skipping validator {} with zero marinade active stake {}",
                    validator.vote_account, total_marinade_active_stake
                );
                continue;
            }
            let effective_sam_marinade_active_stake = total_marinade_active_stake;
            if effective_sam_marinade_active_stake == 0 {
                warn!(
                    "Skipping validator {} with zero effective SAM marinade active stake {}",
                    validator.vote_account, effective_sam_marinade_active_stake
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

            let marinade_stake_share = Decimal::from(effective_sam_marinade_active_stake)
                / Decimal::from(total_active_stake);
            debug!("Validator {} marinade stake share: {marinade_stake_share}, total: {total_active_stake}, marinade stake: {total_marinade_active_stake}, sam active stake: {effective_sam_marinade_active_stake}", validator.vote_account);
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
            let (
                total_marinade_stakers_rewards,
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
                    * Decimal::from(effective_sam_marinade_active_stake);
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
                let total = Decimal::from(effective_sam_marinade_active_stake) * total_rev_share;
                (total, None, None, None, None)
            };

            let auction_effective_static_bid = validator
                .rev_share
                .auction_effective_static_bid_pmpe
                .unwrap_or(validator.effective_bid);
            // bid per mille, dividing by 1000 gives the ratio per unit - whatever SOL, lamport, etc., since it represents a ratio
            let effective_static_bid = auction_effective_static_bid / Decimal::ONE_THOUSAND;
            settlement_claim.static_bid_claim =
                Decimal::from(effective_sam_marinade_active_stake) * effective_static_bid;
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

            let (marinade_fee_deposit_stake_accounts, dao_fee_deposit_stake_accounts) =
                get_fee_deposit_stake_accounts(stake_meta_index, fee_config);

            let mut claims = vec![];
            let mut claims_amount = 0;

            for (&(withdraw_authority, stake_authority), stake_metas) in &grouped_stake_metas {
                if !stake_authority_filter(stake_authority) {
                    continue;
                }
                let stake_accounts: HashMap<_, _> = stake_metas
                    .iter()
                    .map(|s| (s.pubkey, s.active_delegation_lamports))
                    .collect();
                let stake_accounts_sum: u64 = stake_accounts.values().sum();
                if stake_accounts_sum > 0 {
                    let staker_share = Decimal::from(stake_accounts_sum)
                        / Decimal::from(total_marinade_active_stake);
                    let claim_amount = (staker_share * Decimal::from(stakers_total_claim))
                        .to_u64()
                        .ok_or_else(|| {
                            anyhow!(
                                "claim_amount is not representable as u64 for validator {}",
                                validator.vote_account
                            )
                        })?;
                    if claim_amount > 0 {
                        claims.push(SettlementClaim {
                            withdraw_authority: *withdraw_authority,
                            stake_authority: *stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount,
                            active_stake: stake_accounts_sum,
                        });
                        claims_amount += claim_amount;
                    }
                }
            }
            ensure!(
                claims_amount <= stakers_total_claim,
                "Claims amount {} exceeded stakers total claim {} for validator {}",
                claims_amount,
                stakers_total_claim,
                validator.vote_account
            );

            if marinade_fee_claim > 0 {
                let (marinade_withdraw, marinade_stake, _, _) = fee_config.fee_authorities();
                claims.push(SettlementClaim {
                    withdraw_authority: *marinade_withdraw,
                    stake_authority: *marinade_stake,
                    stake_accounts: marinade_fee_deposit_stake_accounts.clone(),
                    claim_amount: marinade_fee_claim,
                    active_stake: marinade_fee_deposit_stake_accounts.values().sum(),
                });
                claims_amount += marinade_fee_claim;

                ensure!(
                    claims_amount <= settlement_claim_sum,
                    "The sum of total claims {} exceeds the total claim amount {} after adding the Marinade fee for validator {}",
                    claims_amount,
                    settlement_claim_sum,
                    validator.vote_account
                );
            }
            if dao_fee_claim > 0 {
                let (_, _, dao_withdraw, dao_stake) = fee_config.fee_authorities();
                claims.push(SettlementClaim {
                    withdraw_authority: *dao_withdraw,
                    stake_authority: *dao_stake,
                    stake_accounts: dao_fee_deposit_stake_accounts.clone(),
                    claim_amount: dao_fee_claim,
                    active_stake: total_marinade_active_stake,
                });
                claims_amount += dao_fee_claim;

                ensure!(
                    claims_amount <= settlement_claim_sum,
                    "The sum of total claims {} exceeds the total claim amount {} after adding the DAO fee for validator {}",
                    claims_amount,
                    settlement_claim_sum,
                    validator.vote_account
                );
            }

            let settlement_details = BidSettlementDetails {
                total_active_stake,
                total_marinade_active_stake,
                effective_sam_marinade_active_stake,
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
                marinade_fee_claim,
                dao_fee_claim,
            };
            let details_json = serde_json::to_value(&settlement_details)?;

            add_to_settlement_collection(
                &mut settlement_claim_collections,
                claims,
                claims_amount,
                SettlementReason::Bidding,
                validator.vote_account,
                &settlement_meta_funder,
                Some(details_json),
            );
        }
    }
    Ok(settlement_claim_collections)
}
