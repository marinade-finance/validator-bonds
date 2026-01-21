use crate::sam_meta::{AuctionValidatorValues, ValidatorSamMeta};
use crate::settlement_config::SettlementConfig;
use bid_psr_distribution::rewards::{RewardsCollection, VoteAccountRewards};
use bid_psr_distribution::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection, SettlementMeta, SettlementReason,
};
use bid_psr_distribution::stake_meta_index::StakeMetaIndex;
use bid_psr_distribution::utils::sort_claims_deterministically;
use log::{debug, info, warn};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::fmt;
use std::ops::Mul;
use validator_bonds::state::bond::find_bond_address;

pub fn generate_settlements_collection(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    rewards_collection: &RewardsCollection,
    settlement_config: &SettlementConfig,
) -> SettlementCollection {
    assert!(
        sam_validator_metas
            .iter()
            .all(|v| v.epoch as u64 == stake_meta_index.stake_meta_collection.epoch),
        "SAM Validators Collection epoch must be same as stake meta collection epoch"
    );

    let bid_settlements = generate_bid_settlements(
        stake_meta_index,
        sam_validator_metas,
        rewards_collection,
        settlement_config,
    );

    let penalty_settlements =
        generate_penalty_settlements(stake_meta_index, sam_validator_metas, settlement_config);

    let mut settlements = [bid_settlements, penalty_settlements].concat();
    settlements.sort_by_key(|s| (s.reason.to_string(),));

    SettlementCollection {
        slot: stake_meta_index.stake_meta_collection.slot,
        epoch: stake_meta_index.stake_meta_collection.epoch,
        settlements,
    }
}

#[derive(Serialize, Debug, Default)]
struct ResultSettlementClaims {
    inflation_commission_claim: Decimal,
    mev_commission_claim: Decimal,
    block_commission_claim: Decimal,
    static_bid_claim: Decimal,
}

impl ResultSettlementClaims {
    pub fn sum(&self) -> Decimal {
        self.inflation_commission_claim
            .saturating_add(self.mev_commission_claim)
            .saturating_add(self.block_commission_claim)
            .saturating_add(self.static_bid_claim)
    }

    pub fn sum_u64(&self) -> u64 {
        self.sum()
            .to_u64()
            .expect("Failed to_u64 for total settlement claims")
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidTooLowPenaltyDetails {
    pub total_marinade_active_stake: u64,
    pub effective_sam_marinade_active_stake: u64,
    pub bid_too_low_penalty_pmpe: String,
    pub bid_too_low_penalty_total_claim: String,
    pub distributor_bid_too_low_penalty_claim: u64,
    pub stakers_bid_too_low_penalty_claim: u64,
    pub dao_bid_too_low_penalty_claim: u64,
    pub marinade_bid_too_low_penalty_claim: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlacklistPenaltyDetails {
    pub total_marinade_active_stake: u64,
    pub effective_sam_marinade_active_stake: u64,
    pub blacklist_penalty_pmpe: String,
    pub blacklist_penalty_total_claim: String,
    pub stakers_blacklist_penalty_claim: u64,
}

pub fn generate_bid_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    rewards_collection: &RewardsCollection,
    settlement_config: &SettlementConfig,
) -> Vec<Settlement> {
    let epoch = stake_meta_index.stake_meta_collection.epoch;
    info!("Generating bid settlements in epoch {epoch}...");

    let stake_authority_filter = settlement_config.whitelist_stake_authorities_filter();
    let fee_percentages = settlement_config.fee_percentages();
    let settlement_meta_funder = settlement_config.meta().clone();
    let mut settlement_claim_collections = vec![];

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
            let (bond_account, _) = find_bond_address(
                settlement_config.validator_bonds_config(),
                &validator.vote_account,
            );
            let (total_active_stake, total_marinade_active_stake): (u64, u64) = stake_meta_index
                .iter_grouped_stake_metas(&validator.vote_account)
                .expect("No items from iter_grouped_stake_metas")
                .flat_map(|(key, metas)| metas.iter().map(move |meta| (key, meta)))
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
            let effective_sam_marinade_active_stake =
                calculate_effective_sam_stake(total_marinade_active_stake, validator);
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
                assert!(
                    inflation_commission_onchain_dec <= Decimal::ONE,
                    "Inflation commission validator onchain decimal cannot be greater than 1",
                );
                if inflation_commission_onchain_dec > inflation_commission_in_bond_dec {
                    let inflation_commission_diff =
                        inflation_commission_onchain_dec - inflation_commission_in_bond_dec;
                    assert!(
                        inflation_commission_diff >= Decimal::ZERO,
                        "Inflation commission diff cannot be negative"
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
                        assert!(
                            mev_commission_diff >= Decimal::ZERO,
                            "MEV commission diff cannot be negative"
                        );
                        settlement_claim.mev_commission_claim =
                            marinade_mev_rewards.mul(mev_commission_diff);
                    }
                }
                if let Some(block_rewards_commission_in_bond_dec) =
                    commissions.block_rewards_commission_in_bond_dec
                {
                    if rewards.block_rewards > 0 {
                        let block_rewards_jito_commission_onchain_dec =
                            Decimal::from(
                                rewards.block_rewards - rewards.jito_priority_fee_rewards,
                            ) / Decimal::from(rewards.block_rewards);
                        if block_rewards_jito_commission_onchain_dec
                            > block_rewards_commission_in_bond_dec
                        {
                            let block_rewards_commission_diff =
                                block_rewards_jito_commission_onchain_dec
                                    - block_rewards_commission_in_bond_dec;
                            assert!(
                                block_rewards_commission_diff >= Decimal::ZERO,
                                "Block rewards commission diff cannot be negative"
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
                .expect("Failed to_u64 for distributor_fee_claim");

            // minimum is 0 when distributor fee is of amount of total (stakers get nothing)
            let stakers_total_claim = settlement_claim
                .sum_u64()
                .saturating_sub(distributor_fee_claim);
            let dao_fee_claim = (Decimal::from(distributor_fee_claim)
                * fee_percentages.dao_fee_share)
                .to_u64()
                .expect("Failed to_u64 for dao_fee_claim");
            let marinade_fee_claim = distributor_fee_claim - dao_fee_claim;
            assert_eq!(
                settlement_claim.sum_u64(),
                stakers_total_claim + marinade_fee_claim + dao_fee_claim,
            );

            let (marinade_fee_deposit_stake_accounts, dao_fee_deposit_stake_accounts) =
                get_fee_deposit_stake_accounts(stake_meta_index, settlement_config);

            let mut claims = vec![];
            let mut claims_amount = 0;

            for ((withdraw_authority, stake_authority), stake_metas) in grouped_stake_metas {
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
                        .expect("claim_amount is not integral");
                    if claim_amount > 0 {
                        claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount,
                            active_stake: stake_accounts_sum,
                        });
                        claims_amount += claim_amount;
                    }
                }
            }
            if claims_amount > stakers_total_claim {
                panic!("Claims amount {claims_amount} exceeded stakers total claim {stakers_total_claim}")
            }

            if marinade_fee_claim > 0 {
                claims.push(SettlementClaim {
                    withdraw_authority: *settlement_config.marinade_withdraw_authority(),
                    stake_authority: *settlement_config.marinade_stake_authority(),
                    stake_accounts: marinade_fee_deposit_stake_accounts.clone(),
                    claim_amount: marinade_fee_claim,
                    active_stake: marinade_fee_deposit_stake_accounts.values().sum(),
                });
                claims_amount += marinade_fee_claim;

                assert!(
                    claims_amount
                            <= settlement_claim.sum_u64(),
                    "The sum of total claims exceeds the total claim amount after adding the Marinade fee"
                    );
            }
            if dao_fee_claim > 0 {
                claims.push(SettlementClaim {
                    withdraw_authority: *settlement_config.dao_withdraw_authority(),
                    stake_authority: *settlement_config.dao_stake_authority(),
                    stake_accounts: dao_fee_deposit_stake_accounts.clone(),
                    claim_amount: dao_fee_claim,
                    active_stake: total_marinade_active_stake,
                });
                claims_amount += dao_fee_claim;

                assert!(
                    claims_amount
                            <= settlement_claim.sum_u64(),
                    "The sum of total claims exceeds the total claim amount after adding the DAO fee"
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
                settlement_claims: serde_json::to_value(settlement_claim)
                    .expect("claims are not valid json"),
                stakers_total_claim,
                marinade_fee_claim,
                dao_fee_claim,
            };
            let details_json = serde_json::to_value(&settlement_details)
                .expect("Failed to serialize BidSettlementDetails");

            add_to_settlement_collection(
                &mut settlement_claim_collections,
                claims,
                claims_amount,
                SettlementReason::Bidding,
                validator.vote_account,
                bond_account,
                &settlement_meta_funder,
                Some(details_json),
            );
        }
    }
    settlement_claim_collections
}

pub fn generate_penalty_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    settlement_config: &SettlementConfig,
) -> Vec<Settlement> {
    info!("Generating penalty settlements...");

    let stake_authority_filter = settlement_config.whitelist_stake_authorities_filter();
    let fee_percentages = settlement_config.fee_percentages();
    let settlement_meta_funder = settlement_config.meta().clone();
    let mut penalty_settlement_collection = vec![];

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
            let (bond_account, _) = find_bond_address(
                settlement_config.validator_bonds_config(),
                &validator.vote_account,
            );

            let bid_too_low_penalty =
                validator.rev_share.bid_too_low_penalty_pmpe / Decimal::ONE_THOUSAND;
            let blacklist_penalty =
                validator.rev_share.blacklist_penalty_pmpe / Decimal::ONE_THOUSAND;

            let total_marinade_active_stake: u64 = stake_meta_index
                .iter_grouped_stake_metas(&validator.vote_account)
                .expect("No items from iter_grouped_stake_metas")
                .filter(|(&(_, &stake_authority), _)| stake_authority_filter(&stake_authority))
                .flat_map(|(_, metas)| metas.iter())
                .map(|meta| meta.active_delegation_lamports)
                .sum();

            let effective_sam_marinade_active_stake =
                calculate_effective_sam_stake(total_marinade_active_stake, validator);

            let bid_too_low_penalty_total_claim =
                Decimal::from(effective_sam_marinade_active_stake) * bid_too_low_penalty;
            let distributor_bid_too_low_penalty_claim = (bid_too_low_penalty_total_claim
                * fee_percentages.marinade_distributor_fee)
                .to_u64()
                .expect("Failed to_u64 for distributor_bid_penalty_claim");
            let stakers_bid_too_low_penalty_claim = bid_too_low_penalty_total_claim
                .to_u64()
                .expect("Failed to_u64 for stakers_bid_penalty_claim")
                - distributor_bid_too_low_penalty_claim;
            let dao_bid_too_low_penalty_claim =
                (Decimal::from(distributor_bid_too_low_penalty_claim)
                    * fee_percentages.dao_fee_share)
                    .to_u64()
                    .expect("Failed to_u64 for dao_bid_penalty_claim");
            let marinade_bid_too_low_penalty_claim = (distributor_bid_too_low_penalty_claim
                - dao_bid_too_low_penalty_claim)
                .to_u64()
                .expect("Failed to_u64 for marinade_bid_penalty_claim");

            let blacklist_penalty_total_claim =
                Decimal::from(effective_sam_marinade_active_stake) * blacklist_penalty;
            let stakers_blacklist_penalty_claim = blacklist_penalty_total_claim
                .to_u64()
                .expect("Failed to_u64 for stakers_blacklist_penalty_claim");

            let mut bid_too_low_penalty_claims = vec![];
            let mut claimed_bid_too_low_penalty_amount = 0;

            let mut blacklist_penalty_claims = vec![];
            let mut claimed_blacklist_penalty_amount = 0;

            let (marinade_fee_deposit_stake_accounts, dao_fee_deposit_stake_accounts) =
                get_fee_deposit_stake_accounts(stake_meta_index, settlement_config);

            let grouped_marinade_filtered_stake_metas = grouped_stake_metas
                .into_iter()
                .filter(|((_, stake_authority), _)| stake_authority_filter(stake_authority))
                .collect::<Vec<_>>();

            for ((withdraw_authority, stake_authority), stake_metas) in
                grouped_marinade_filtered_stake_metas
            {
                let stake_accounts: HashMap<_, _> = stake_metas
                    .iter()
                    .map(|stake| (stake.pubkey, stake.active_delegation_lamports))
                    .collect();
                let active_stake: u64 = stake_accounts.values().sum();
                if active_stake > 0 {
                    let staker_share =
                        Decimal::from(active_stake) / Decimal::from(total_marinade_active_stake);

                    let bid_penalty_claim_amount = (staker_share
                        * Decimal::from(stakers_bid_too_low_penalty_claim))
                    .to_u64()
                    .expect("bid_penalty_claim_amount is not integral");
                    let blacklist_penalty_claim_amount = (staker_share
                        * Decimal::from(stakers_blacklist_penalty_claim))
                    .to_u64()
                    .expect("blacklist_penalty_claim_amount is not integral");

                    if bid_penalty_claim_amount > 0 {
                        bid_too_low_penalty_claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount: bid_penalty_claim_amount,
                            active_stake,
                        });
                        claimed_bid_too_low_penalty_amount += bid_penalty_claim_amount;
                    }
                    if blacklist_penalty_claim_amount > 0 {
                        blacklist_penalty_claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts,
                            claim_amount: blacklist_penalty_claim_amount,
                            active_stake,
                        });
                        claimed_blacklist_penalty_amount += blacklist_penalty_claim_amount;
                    }
                }
            }

            assert!(
                claimed_bid_too_low_penalty_amount <= stakers_bid_too_low_penalty_claim,
                "Total claimed bid_penalty amount is bigger than stakers bid_penalty claim"
            );
            assert!(
                claimed_blacklist_penalty_amount <= stakers_blacklist_penalty_claim,
                "Total claimed blacklist_penalty amount is bigger than stakers blacklist_penalty claim"
            );

            if effective_sam_marinade_active_stake > 0 {
                if marinade_bid_too_low_penalty_claim > 0 {
                    bid_too_low_penalty_claims.push(SettlementClaim {
                        withdraw_authority: *settlement_config.marinade_withdraw_authority(),
                        stake_authority: *settlement_config.marinade_stake_authority(),
                        stake_accounts: marinade_fee_deposit_stake_accounts.clone(),
                        claim_amount: marinade_bid_too_low_penalty_claim,
                        active_stake: marinade_fee_deposit_stake_accounts.values().sum(),
                    });
                    claimed_bid_too_low_penalty_amount += marinade_bid_too_low_penalty_claim;

                    assert!(
                        claimed_bid_too_low_penalty_amount <= bid_too_low_penalty_total_claim.to_u64()
                            .expect("Failed to_u64 for bid_penalty_total_claim"),
                        "The sum of total claims exceeds the bid penalty amount after adding the Marinade fee"
                    );
                }
                if dao_bid_too_low_penalty_claim > 0 {
                    bid_too_low_penalty_claims.push(SettlementClaim {
                        withdraw_authority: *settlement_config.dao_withdraw_authority(),
                        stake_authority: *settlement_config.dao_stake_authority(),
                        stake_accounts: dao_fee_deposit_stake_accounts.clone(),
                        claim_amount: dao_bid_too_low_penalty_claim,
                        active_stake: total_marinade_active_stake,
                    });
                    claimed_bid_too_low_penalty_amount += dao_bid_too_low_penalty_claim;

                    assert!(
                        claimed_bid_too_low_penalty_amount <= bid_too_low_penalty_total_claim.to_u64().expect("Failed to_u64 for bid_penalty_total_claim"),
                        "The sum of total claims exceeds the bid penalty amount after adding the DAO fee"
                    );
                }
            }

            // Build settlement details for bid_too_low_penalty
            if !bid_too_low_penalty_claims.is_empty() {
                let bid_penalty_details = BidTooLowPenaltyDetails {
                    total_marinade_active_stake,
                    effective_sam_marinade_active_stake,
                    bid_too_low_penalty_pmpe: bid_too_low_penalty.to_string(),
                    bid_too_low_penalty_total_claim: bid_too_low_penalty_total_claim.to_string(),
                    distributor_bid_too_low_penalty_claim,
                    stakers_bid_too_low_penalty_claim,
                    dao_bid_too_low_penalty_claim,
                    marinade_bid_too_low_penalty_claim,
                };
                let details_json = serde_json::to_value(&bid_penalty_details)
                    .expect("Failed to serialize BidTooLowPenaltyDetails");

                add_to_settlement_collection(
                    &mut penalty_settlement_collection,
                    bid_too_low_penalty_claims,
                    claimed_bid_too_low_penalty_amount,
                    SettlementReason::BidTooLowPenalty,
                    validator.vote_account,
                    bond_account,
                    &settlement_meta_funder,
                    Some(details_json),
                );
            }

            // Build settlement details for blacklist_penalty
            if !blacklist_penalty_claims.is_empty() {
                let blacklist_penalty_details = BlacklistPenaltyDetails {
                    total_marinade_active_stake,
                    effective_sam_marinade_active_stake,
                    blacklist_penalty_pmpe: blacklist_penalty.to_string(),
                    blacklist_penalty_total_claim: blacklist_penalty_total_claim.to_string(),
                    stakers_blacklist_penalty_claim,
                };
                let details_json = serde_json::to_value(&blacklist_penalty_details)
                    .expect("Failed to serialize BlacklistPenaltyDetails");

                add_to_settlement_collection(
                    &mut penalty_settlement_collection,
                    blacklist_penalty_claims,
                    claimed_blacklist_penalty_amount,
                    SettlementReason::BlacklistPenalty,
                    validator.vote_account,
                    bond_account,
                    &settlement_meta_funder,
                    Some(details_json),
                );
            }
        }
    }
    penalty_settlement_collection
}

/// Calculates what is the total active SAM (Marinade controlled) stake to be used in claim calculations.
fn calculate_effective_sam_stake(total_active_stake: u64, _validator: &ValidatorSamMeta) -> u64 {
    let stake_sam_percentage = Decimal::ONE;
    (Decimal::from(total_active_stake) * stake_sam_percentage)
        .to_u64()
        .expect("Failed to_u64 for effective_sam_stake")
}

/// The output Settlements data is updated with stake accounts owned by Marinade and DAO
fn get_fee_deposit_stake_accounts(
    stake_meta_index: &StakeMetaIndex,
    settlement_config: &SettlementConfig,
) -> (HashMap<Pubkey, u64>, HashMap<Pubkey, u64>) {
    let marinade_fee_deposit_stake_accounts: HashMap<_, _> = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| {
            x.withdraw_authority
                .eq(settlement_config.marinade_withdraw_authority())
                && x.stake_authority
                    .eq(settlement_config.marinade_stake_authority())
        })
        .iter()
        .map(|s| (s.pubkey, s.active_delegation_lamports))
        .collect();
    let dao_fee_deposit_stake_accounts: HashMap<_, _> = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| {
            x.withdraw_authority
                .eq(settlement_config.dao_withdraw_authority())
                && x.stake_authority
                    .eq(settlement_config.dao_stake_authority())
        })
        .iter()
        .map(|s| (s.pubkey, s.active_delegation_lamports))
        .collect();

    (
        marinade_fee_deposit_stake_accounts,
        dao_fee_deposit_stake_accounts,
    )
}

/// Adds a settlement to the collection if any claims are present, placing it in a deterministic order
#[allow(clippy::too_many_arguments)]
fn add_to_settlement_collection(
    settlement_collections: &mut Vec<Settlement>,
    mut claims: Vec<SettlementClaim>,
    claims_amount: u64,
    reason: SettlementReason,
    vote_account: Pubkey,
    bond_account: Pubkey,
    settlement_meta: &SettlementMeta,
    details: Option<serde_json::Value>,
) {
    if !claims.is_empty() {
        sort_claims_deterministically(&mut claims);
        settlement_collections.push(Settlement {
            reason,
            meta: settlement_meta.clone(),
            vote_account,
            bond_account: Some(bond_account),
            claims_count: claims.len(),
            claims_amount,
            claims,
            details,
        });
    }
}

#[path = "test_settlement_claims.rs"]
#[cfg(test)]
mod test_settlement_claims;
