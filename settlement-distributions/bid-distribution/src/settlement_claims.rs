use crate::sam_meta::{AuctionValidatorValues, ValidatorSamMeta};
use crate::settlement_config::SettlementConfig;
use bid_psr_distribution::rewards::RewardsCollection;
use bid_psr_distribution::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection, SettlementMeta, SettlementReason,
};
use bid_psr_distribution::stake_meta_index::StakeMetaIndex;
use bid_psr_distribution::utils::sort_claims_deterministically;
use log::{debug, info, warn};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::fmt;
use std::ops::Mul;

pub fn generate_settlements_collection(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    rewards_collection: &RewardsCollection,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
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
        &stake_authority_filter,
        settlement_config,
    );

    let penalty_settlements = generate_penalty_settlements(
        stake_meta_index,
        sam_validator_metas,
        &stake_authority_filter,
        settlement_config,
    );

    SettlementCollection {
        slot: stake_meta_index.stake_meta_collection.slot,
        epoch: stake_meta_index.stake_meta_collection.epoch,
        settlements: [bid_settlements, penalty_settlements].concat(),
    }
}

#[derive(Debug)]
struct ResultSettlementClaims {
    inflation_commission_claim: Decimal,
    mev_commission_claim: Decimal,
    block_commission_claim: Decimal,
    static_bid_claim: Decimal,
}

impl Default for ResultSettlementClaims {
    fn default() -> Self {
        ResultSettlementClaims {
            inflation_commission_claim: Decimal::ZERO,
            mev_commission_claim: Decimal::ZERO,
            block_commission_claim: Decimal::ZERO,
            static_bid_claim: Decimal::ZERO,
        }
    }
}

impl ResultSettlementClaims {
    pub fn total(&self) -> Decimal {
        self.inflation_commission_claim
            .saturating_add(self.mev_commission_claim)
            .saturating_add(self.block_commission_claim)
            .saturating_add(self.static_bid_claim)
    }

    pub fn total_u64(&self) -> u64 {
        self.total()
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
            self.total()
        )
    }
}

pub fn generate_bid_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    rewards_collection: &RewardsCollection,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_config: &SettlementConfig,
) -> Vec<Settlement> {
    info!("Generating bid settlements...");

    let fee_percentages = settlement_config.fee_percentages();
    let settlement_meta_funder = settlement_config.meta().clone();
    let mut settlement_claim_collections = vec![];

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
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

            let rewards = rewards_collection
                .get(&validator.vote_account)
                .unwrap_or_else(|| panic!("No rewards record found for validator {}. This is unexpected since there is active stake.",
                         validator.vote_account));

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
            }) = &validator.auction_validator_values
            {
                let inflation_commission_in_bonds_dec = commissions
                    .inflation_commission_in_bonds_dec
                    .unwrap_or(Decimal::ONE);
                assert!(
                    commissions.inflation_commission_onchain_dec <= Decimal::ONE,
                    "Inflation commission validator onchain decimal cannot be greater than 1",
                );
                if commissions.inflation_commission_onchain_dec > inflation_commission_in_bonds_dec
                {
                    let inflation_commission_diff = commissions.inflation_commission_onchain_dec
                        - inflation_commission_in_bonds_dec;
                    assert!(
                        inflation_commission_diff >= Decimal::ZERO,
                        "Inflation commission diff cannot be negative"
                    );
                    settlement_claim.inflation_commission_claim =
                        marinade_inflation_rewards.mul(inflation_commission_diff);
                }
                if let Some(mev_commission_in_bonds_dec) = commissions.mev_commission_in_bonds_dec {
                    let mev_commission_onchain_dec = commissions
                        .mev_commission_onchain_dec
                        .unwrap_or(Decimal::ONE);
                    if mev_commission_onchain_dec > mev_commission_in_bonds_dec {
                        let mev_commission_diff =
                            mev_commission_onchain_dec - mev_commission_in_bonds_dec;
                        assert!(
                            mev_commission_diff >= Decimal::ZERO,
                            "MEV commission diff cannot be negative"
                        );
                        settlement_claim.mev_commission_claim =
                            marinade_mev_rewards.mul(mev_commission_diff);
                    }
                }
                if let Some(block_rewards_commission_in_bonds_dec) =
                    commissions.block_rewards_commission_in_bonds_dec
                {
                    if rewards.block_rewards > 0 {
                        let block_rewards_jito_commission_onchain_dec =
                            Decimal::from(
                                rewards.block_rewards - rewards.jito_priority_fee_rewards,
                            ) / Decimal::from(rewards.block_rewards);
                        if block_rewards_jito_commission_onchain_dec
                            > block_rewards_commission_in_bonds_dec
                        {
                            let block_rewards_commission_diff =
                                block_rewards_jito_commission_onchain_dec
                                    - block_rewards_commission_in_bonds_dec;
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
            let total_marinade_stakers_rewards = if let Some(AuctionValidatorValues {
                commissions: Some(commissions),
                ..
            }) = &validator.auction_validator_values
            {
                let staker_inflation_rewards = marinade_inflation_rewards
                    * (Decimal::ONE - commissions.inflation_commission_dec);
                let staker_mev_rewards =
                    marinade_mev_rewards * (Decimal::ONE - commissions.mev_commission_dec);
                let staker_block_rewards = marinade_block_rewards
                    * (Decimal::ONE - commissions.block_rewards_commission_dec);
                let staker_bid_rewards = validator.rev_share.bid_pmpe / Decimal::ONE_THOUSAND
                    * Decimal::from(effective_sam_marinade_active_stake);
                staker_inflation_rewards
                    + staker_mev_rewards
                    + staker_block_rewards
                    + staker_bid_rewards
            } else {
                let total_rev_share = validator.rev_share.total_pmpe / Decimal::ONE_THOUSAND;
                Decimal::from(effective_sam_marinade_active_stake) * total_rev_share
            };
            info!(
                "Validator {} total marinade stakers rewards: {}",
                validator.vote_account, total_marinade_stakers_rewards
            );

            let auction_effective_static_bid = validator
                .rev_share
                .auction_effective_static_bid_pmpe
                .unwrap_or(validator.effective_bid);
            // bid per mille, dividing by 1000 gives the ratio per unit - whatever SOL, lamport, etc., since it represents a ratio
            let effective_static_bid = auction_effective_static_bid / Decimal::ONE_THOUSAND;
            settlement_claim.static_bid_claim =
                Decimal::from(effective_sam_marinade_active_stake) * effective_static_bid;
            info!("Settlement result claims: {settlement_claim}");
            debug!(
                "Validator {} commission claims: {:?}",
                validator.vote_account, settlement_claim
            );

            // Marinade should get at least the percentage amount of total rewards as per the distributor fee percentage
            let minimum_distributor_fee_claim =
                total_marinade_stakers_rewards * fee_percentages.marinade_distributor_fee;
            // TODO: copying the original logic, but needs a review
            //       https://github.com/marinade-finance/validator-bonds/blob/b7916fd06d86bf8d3b27bff7956524e5516e3dd9/settlement-distributions/bid-distribution/src/settlement_claims.rs#L90
            let distributor_fee_claim = minimum_distributor_fee_claim
                .min(settlement_claim.total())
                .to_u64()
                .expect("Failed to_u64 for distributor_fee_claim");

            // minimum is 0 when distributor fee is of amount of total (stakers get nothing)
            let stakers_total_claim = settlement_claim
                .total_u64()
                .saturating_sub(distributor_fee_claim);
            let dao_fee_claim = (Decimal::from(distributor_fee_claim)
                * fee_percentages.dao_fee_share)
                .to_u64()
                .expect("Failed to_u64 for dao_fee_claim");
            let marinade_fee_claim = distributor_fee_claim - dao_fee_claim;
            assert_eq!(
                settlement_claim.total_u64(),
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
                            <= settlement_claim.total_u64(),
                        "The sum of total claims exceeds the total claim amount after adding the Marinade fee"
                    );
            }
            if dao_fee_claim > 0 {
                claims.push(SettlementClaim {
                    withdraw_authority: *settlement_config.dao_withdraw_authority(),
                    stake_authority: *settlement_config.dao_stake_authority(),
                    stake_accounts: dao_fee_deposit_stake_accounts.clone(),
                    claim_amount: dao_fee_claim,
                    active_stake: total_active_stake,
                });
                claims_amount += dao_fee_claim;

                assert!(
                        claims_amount
                            <= settlement_claim.total_u64(),
                        "The sum of total claims exceeds the total claim amount after adding the DAO fee"
                    );
            }

            add_to_settlement_collection(
                &mut settlement_claim_collections,
                claims,
                claims_amount,
                SettlementReason::Bidding,
                validator.vote_account,
                &settlement_meta_funder,
            );
        }
    }
    settlement_claim_collections
}

pub fn generate_penalty_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_config: &SettlementConfig,
) -> Vec<Settlement> {
    info!("Generating penalty settlements...");

    let fee_percentages = settlement_config.fee_percentages();
    let settlement_meta_funder = settlement_config.meta().clone();
    let mut penalty_settlement_collection = vec![];

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
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

            add_to_settlement_collection(
                &mut penalty_settlement_collection,
                bid_too_low_penalty_claims,
                claimed_bid_too_low_penalty_amount,
                SettlementReason::BidTooLowPenalty,
                validator.vote_account,
                &settlement_meta_funder,
            );

            add_to_settlement_collection(
                &mut penalty_settlement_collection,
                blacklist_penalty_claims,
                claimed_blacklist_penalty_amount,
                SettlementReason::BlacklistPenalty,
                validator.vote_account,
                &settlement_meta_funder,
            );
        }
    }
    penalty_settlement_collection
}

/// Calculates what is the total active SAM (Marinade controlled) stake to be used
/// in claim calculations. Some part is managed by MNDE holders and this excludes it.
fn calculate_effective_sam_stake(total_active_stake: u64, validator: &ValidatorSamMeta) -> u64 {
    let sam_target_stake = validator.marinade_sam_target_sol
        * Decimal::from_f64(1e9).expect("Failed from_f64 for 1e9");
    let mnde_target_stake = validator.marinade_mnde_target_sol
        * Decimal::from_f64(1e9).expect("Failed from_f64 for 1e9");

    let stake_sam_percentage = if mnde_target_stake == Decimal::ZERO {
        Decimal::ONE
    } else {
        sam_target_stake / (sam_target_stake + mnde_target_stake)
    };

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
fn add_to_settlement_collection(
    settlement_collections: &mut Vec<Settlement>,
    mut claims: Vec<SettlementClaim>,
    claims_amount: u64,
    reason: SettlementReason,
    vote_account: Pubkey,
    settlement_meta: &SettlementMeta,
) {
    if !claims.is_empty() {
        sort_claims_deterministically(&mut claims);
        settlement_collections.push(Settlement {
            reason,
            meta: settlement_meta.clone(),
            vote_account,
            claims_count: claims.len(),
            claims_amount,
            claims,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sam_meta::{
        AuctionValidatorValues, CommissionDetails, RevShare, SamMetadata, ValidatorSamMeta,
    };
    use crate::settlement_config::SettlementConfig;
    use bid_psr_distribution::rewards::{RewardsCollection, VoteAccountRewards};
    use bid_psr_distribution::settlement_collection::{SettlementFunder, SettlementMeta};
    use bid_psr_distribution::stake_meta_index::StakeMetaIndex;
    use rust_decimal::Decimal;
    use serde_json::json;
    use snapshot_parser_validator_cli::stake_meta::{StakeMeta, StakeMetaCollection};
    use solana_sdk::native_token::LAMPORTS_PER_SOL;
    use solana_sdk::pubkey::Pubkey;
    use std::collections::{HashMap, HashSet};

    #[test]
    fn test_generate_bid_settlements_basic_single_validator() {
        // -- SETUP
        let epoch = 100;
        let vote_account = test_vote_account(1);
        let stake_account = test_stake_account(1);
        let withdraw_authority = test_withdraw_authority(1);
        let stake_authority = test_stake_authority(1);

        let stake_lamports = 100 * LAMPORTS_PER_SOL;

        let stake_meta_collection = StakeMetaCollection {
            epoch,
            slot: 1000,
            stake_metas: vec![
                create_stake_meta(
                    stake_account,
                    vote_account,
                    withdraw_authority,
                    stake_authority,
                    stake_lamports,
                ),
                create_stake_meta(
                    test_stake_account(100),
                    vote_account,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    LAMPORTS_PER_SOL,
                ),
                create_stake_meta(
                    test_stake_account(101),
                    vote_account,
                    TEST_PUBKEY_DAO,
                    TEST_PUBKEY_DAO,
                    LAMPORTS_PER_SOL,
                ),
            ],
        };

        let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

        let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

        let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions)
            .build();

        let mut rewards_map = HashMap::new();
        rewards_map.insert(
            vote_account,
            RewardsParams::new(vote_account)
                .inflation(LAMPORTS_PER_SOL)
                .mev(500_000_000)
                .block_rewards(300_000_000)
                .jito(100_000_000)
                .build(),
        );

        let rewards_collection = RewardsCollection {
            epoch,
            rewards_by_vote_account: rewards_map,
        };

        let settlement_config = create_test_settlement_config(950, 500);

        // -- TEST
        let settlements = generate_bid_settlements(
            &stake_meta_index,
            &vec![sam_meta],
            &rewards_collection,
            &|_| true,
            &settlement_config,
        );

        // -- VERIFY
        assert!(!settlements.is_empty(), "Should generate settlements");
        assert_eq!(settlements.len(), 1, "Should have one settlement");
        let settlement = &settlements[0];
        assert_eq!(settlement.vote_account, vote_account);
        assert!(
            !settlement.claims.is_empty(),
            "Should have at least staker claim"
        );
        let total_claims: u64 = settlement.claims.iter().map(|c| c.claim_amount).sum();
        assert_eq!(
            total_claims, settlement.claims_amount,
            "Total claims should match claims_amount"
        );
        assert!(
            has_claim_for_authority(&settlements, &stake_authority, &withdraw_authority),
            "Staker should have a claim"
        );

        let marinade_claim =
            sum_claims_for_authority(&settlements, &TEST_PUBKEY_MARINADE, &TEST_PUBKEY_MARINADE);
        let dao_claim = sum_claims_for_authority(&settlements, &TEST_PUBKEY_DAO, &TEST_PUBKEY_DAO);
        assert!(marinade_claim > 0, "Marinade should have a claim");
        assert!(dao_claim > 0, "DAO should have a claim");

        let total_distributor_fee = marinade_claim + dao_claim;
        let dao_ratio = dao_claim as f64 / total_distributor_fee as f64;
        assert!(
            dao_ratio > 0.0,
            "DAO ratio should be positive, got {}",
            dao_ratio
        );
    }

    #[test]
    fn test_generate_bid_settlements_positive_commission() {
        let epoch = 100;
        let vote_account = test_vote_account(1);
        let stake_account = test_stake_account(1);
        let withdraw_authority = test_withdraw_authority(1);
        let stake_authority = test_stake_authority(1);

        let stake_lamports = 100 * LAMPORTS_PER_SOL;

        let stake_meta_collection = StakeMetaCollection {
            epoch,
            slot: 1000,
            stake_metas: vec![
                create_stake_meta(
                    stake_account,
                    vote_account,
                    withdraw_authority,
                    stake_authority,
                    stake_lamports,
                ),
                create_stake_meta(
                    test_stake_account(100),
                    vote_account,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    LAMPORTS_PER_SOL,
                ),
            ],
        };

        let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

        let commissions = CommissionParams::new(0.15, 0.10).as_commission_details();

        let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions)
            .build();

        let mut rewards_map = HashMap::new();
        rewards_map.insert(
            vote_account,
            RewardsParams::new(vote_account)
                .inflation(10 * LAMPORTS_PER_SOL)
                .mev(5 * LAMPORTS_PER_SOL)
                .block_rewards(2 * LAMPORTS_PER_SOL)
                .build(),
        );

        let rewards_collection = RewardsCollection {
            epoch,
            rewards_by_vote_account: rewards_map,
        };

        let settlement_config = create_test_settlement_config(950, 500);

        let settlements = generate_bid_settlements(
            &stake_meta_index,
            &vec![sam_meta],
            &rewards_collection,
            &|_| true,
            &settlement_config,
        );

        assert!(!settlements.is_empty());
        assert!(
            settlements[0].claims_amount > 0,
            "Should have positive claims"
        );

        let total_claims: u64 = settlements[0].claims.iter().map(|c| c.claim_amount).sum();
        assert!(total_claims > 0, "Total claims should be positive");
    }

    #[test]
    fn test_generate_bid_settlements_negative_commission() {
        // -- SETUP
        let epoch = 100;
        let vote_account = test_vote_account(1);
        let vote_account_2 = test_vote_account(2);
        let vote_account_3 = test_vote_account(3);
        // for vote_account 1
        let marinade_stake_1 = 50 * LAMPORTS_PER_SOL;
        let marinade_stake_2 = LAMPORTS_PER_SOL;
        let marinade_stake_3 = 100 * LAMPORTS_PER_SOL;
        let marinade_delegation = marinade_stake_1 + marinade_stake_2 + marinade_stake_3;
        let non_marinade_delegation = 2222 * LAMPORTS_PER_SOL;
        let full_delegation = marinade_delegation + non_marinade_delegation;
        let marinade_delegation_share =
            Decimal::from(marinade_delegation) / Decimal::from(full_delegation);
        let (stake_1, stake_2, stake_3) = (
            test_stake_account(1),
            test_stake_account(2),
            test_stake_account(3),
        );

        let stake_meta_collection = StakeMetaCollection {
            epoch,
            slot: 1000,
            stake_metas: vec![
                create_stake_meta(
                    stake_1,
                    vote_account,
                    test_withdraw_authority(1),
                    TEST_PUBKEY_MARINADE,
                    marinade_stake_1,
                ),
                create_stake_meta(
                    stake_2,
                    vote_account,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    marinade_stake_2,
                ),
                create_stake_meta(
                    stake_3,
                    vote_account,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    marinade_stake_3,
                ),
                // validator is not in auction, it should not be considered
                create_stake_meta(
                    test_stake_account(4),
                    vote_account_2,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    LAMPORTS_PER_SOL * 1111,
                ),
                // validator is in auction but stake is not staked with marinade
                create_stake_meta(
                    test_stake_account(5),
                    vote_account,
                    test_withdraw_authority(1),
                    test_stake_authority(1),
                    non_marinade_delegation,
                ),
            ],
        };

        let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

        // on-chain commissions is bigger than in bond which is even negative
        let on_chain_commission = 0.05;
        let in_bond_commission = -0.10;
        let commission_diff = Decimal::try_from(on_chain_commission).unwrap()
            - Decimal::try_from(in_bond_commission).unwrap();
        let commissions =
            CommissionParams::new(on_chain_commission, in_bond_commission).as_commission_details();

        let static_bid = 0.001;
        let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions)
            .static_bid(static_bid)
            .build();
        let sam_meta_3 = SamMetaParams::new(vote_account_3, epoch as u32)
            .auction_values(CommissionParams::default().as_commission_details())
            .build();

        let inflation_rewards = 20 * LAMPORTS_PER_SOL;
        let mev_rewards = 5 * LAMPORTS_PER_SOL;
        let block_rewards = 4 * LAMPORTS_PER_SOL;
        let jito_rewards = LAMPORTS_PER_SOL;
        let mut rewards_map = HashMap::new();
        rewards_map.insert(
            vote_account,
            RewardsParams::new(vote_account)
                .inflation(inflation_rewards)
                .mev(mev_rewards)
                .block_rewards(block_rewards)
                .jito(jito_rewards)
                .build(),
        );
        rewards_map.insert(
            vote_account_2,
            RewardsParams::new(vote_account_2)
                .inflation(1111 * LAMPORTS_PER_SOL)
                .mev(55 * LAMPORTS_PER_SOL)
                .block_rewards(22 * LAMPORTS_PER_SOL)
                .jito(3)
                .build(),
        );

        let rewards_collection = RewardsCollection {
            epoch,
            rewards_by_vote_account: rewards_map,
        };

        let settlement_config = create_test_settlement_config(20, 500);

        // -- TEST
        let settlements = generate_bid_settlements(
            &stake_meta_index,
            &vec![sam_meta, sam_meta_3],
            &rewards_collection,
            &|s| s == &TEST_PUBKEY_MARINADE,
            &settlement_config,
        );

        // -- VERIFY
        let marinade_inflation_rewards = (Decimal::from(inflation_rewards)
            * marinade_delegation_share)
            .to_u64()
            .unwrap();
        let inflation_to_get = (commission_diff * Decimal::from(marinade_inflation_rewards))
            .to_u64()
            .unwrap();
        let marinade_mev_rewards = (Decimal::from(mev_rewards) * marinade_delegation_share)
            .to_u64()
            .unwrap();
        let mev_to_get = (commission_diff * Decimal::from(marinade_mev_rewards))
            .to_u64()
            .unwrap();
        let marinade_block_rewards = (Decimal::from(block_rewards) * marinade_delegation_share)
            .to_u64()
            .unwrap();
        let jito_rewards = (Decimal::from(jito_rewards) * marinade_delegation_share)
            .to_u64()
            .unwrap();
        let on_chain_block_rewards_commission =
            Decimal::from(marinade_block_rewards - jito_rewards)
                / Decimal::from(marinade_block_rewards);
        let block_rewards_commission_diff =
            on_chain_block_rewards_commission - Decimal::try_from(in_bond_commission).unwrap();
        let block_rewards_to_get = (block_rewards_commission_diff
            * Decimal::from(marinade_block_rewards))
        .to_u64()
        .unwrap();
        let static_bid_to_get = (Decimal::try_from(static_bid).unwrap()
            * Decimal::from(marinade_delegation)
            / Decimal::ONE_THOUSAND)
            .to_u64()
            .unwrap();
        let sum_to_get = inflation_to_get
            + mev_to_get
            + block_rewards_to_get.to_u64().unwrap()
            + static_bid_to_get.to_u64().unwrap();
        println!("Settlements: {}", json!(settlements));
        println!(
            "Delegation share: {}, sum to get: inflation {}, mev {}, block_rewards {}, static_bid {}, sum: {}",
            marinade_delegation_share,
            inflation_to_get,
            mev_to_get,
            block_rewards_to_get,
            static_bid_to_get,
            sum_to_get
        );

        assert!(!settlements.is_empty());
        let settlement = &settlements[0];
        assert!(
            settlement.claims_amount > 0,
            "Should have claims from static bid"
        );
        assert_eq!(
            settlements.len(),
            1,
            "Should have 1 settlement as we have one validator in auction with marinade stake"
        );
        assert_eq!(
            settlement.claims.len(),
            4,
            "Should have 4 claims. Two for withdraw authorities, one for marinade and one for DAO"
        );
        assert_eq!(
            settlement.vote_account, vote_account,
            "One particular vote account should be of the settlement"
        );
        assert!(
            settlement.reason.to_string().eq("Bidding"),
            "Settlement reason should be Bidding"
        );
        assert_eq!(
            settlement.claims_amount, sum_to_get,
            "Claims amount should match expected total"
        );
        let stake_accounts_in_settlement: HashSet<Pubkey> = settlement
            .claims
            .iter()
            .flat_map(|claim| claim.stake_accounts.keys())
            .cloned()
            .collect();

        assert!(
            [stake_1, stake_2, stake_3]
                .iter()
                .all(|s| stake_accounts_in_settlement.contains(s)),
            "All stake accounts should be in the settlement claims"
        );
    }

    #[test]
    fn test_generate_bid_settlements_varying_rewards() {
        let epoch = 100;
        let vote_account = test_vote_account(1);

        let stake_meta_collection = StakeMetaCollection {
            epoch,
            slot: 1000,
            stake_metas: vec![
                create_stake_meta(
                    test_stake_account(1),
                    vote_account,
                    test_withdraw_authority(1),
                    test_stake_authority(1),
                    100 * LAMPORTS_PER_SOL,
                ),
                create_stake_meta(
                    test_stake_account(100),
                    vote_account,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    LAMPORTS_PER_SOL,
                ),
            ],
        };

        let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

        let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

        let _sam_meta = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions)
            .build();

        // Test 1: Only inflation rewards
        let mut rewards_map1 = HashMap::new();
        rewards_map1.insert(
            vote_account,
            RewardsParams::new(vote_account)
                .inflation(10 * LAMPORTS_PER_SOL)
                .build(),
        );
        let rewards_collection1 = RewardsCollection {
            epoch,
            rewards_by_vote_account: rewards_map1,
        };

        let mut rewards_map2 = HashMap::new();
        rewards_map2.insert(
            vote_account,
            RewardsParams::new(vote_account)
                .mev(10 * LAMPORTS_PER_SOL)
                .build(),
        );
        let rewards_collection2 = RewardsCollection {
            epoch,
            rewards_by_vote_account: rewards_map2,
        };

        let mut rewards_map3 = HashMap::new();
        rewards_map3.insert(
            vote_account,
            RewardsParams::new(vote_account)
                .inflation(5 * LAMPORTS_PER_SOL)
                .mev(3 * LAMPORTS_PER_SOL)
                .block_rewards(2 * LAMPORTS_PER_SOL)
                .jito(500_000_000)
                .build(),
        );
        let rewards_collection3 = RewardsCollection {
            epoch,
            rewards_by_vote_account: rewards_map3,
        };

        let settlement_config = create_test_settlement_config(950, 500);

        let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

        let sam_meta1 = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions.clone())
            .build();

        let sam_meta2 = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions.clone())
            .build();

        let sam_meta3 = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions)
            .build();

        let settlements1 = generate_bid_settlements(
            &stake_meta_index,
            &vec![sam_meta1],
            &rewards_collection1,
            &|_| true,
            &settlement_config,
        );

        let settlements2 = generate_bid_settlements(
            &stake_meta_index,
            &vec![sam_meta2],
            &rewards_collection2,
            &|_| true,
            &settlement_config,
        );

        let settlements3 = generate_bid_settlements(
            &stake_meta_index,
            &vec![sam_meta3],
            &rewards_collection3,
            &|_| true,
            &settlement_config,
        );

        assert!(!settlements1.is_empty());
        assert!(!settlements2.is_empty());
        assert!(!settlements3.is_empty());
        assert!(settlements3[0].claims_amount > 0);
    }

    #[test]
    fn test_generate_penalty_settlements() {
        let epoch = 100;
        let vote_account = test_vote_account(1);

        let stake_meta_collection = StakeMetaCollection {
            epoch,
            slot: 1000,
            stake_metas: vec![
                create_stake_meta(
                    test_stake_account(1),
                    vote_account,
                    test_withdraw_authority(1),
                    test_stake_authority(1),
                    100 * LAMPORTS_PER_SOL,
                ),
                create_stake_meta(
                    test_stake_account(100),
                    vote_account,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    LAMPORTS_PER_SOL,
                ),
            ],
        };

        let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

        let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
            .effective_bid(0.2)
            .bid_pmpe(0.3)
            .static_bid(0.001)
            .bid_too_low_penalty(0.16)
            .blacklist_penalty(0.15)
            .build();

        let settlement_config = create_test_settlement_config(950, 500);

        let settlements = generate_penalty_settlements(
            &stake_meta_index,
            &vec![sam_meta],
            &|_| true,
            &settlement_config,
        );

        let has_bid_penalty = settlements
            .iter()
            .any(|s| matches!(s.reason, SettlementReason::BidTooLowPenalty));
        let has_blacklist_penalty = settlements
            .iter()
            .any(|s| matches!(s.reason, SettlementReason::BlacklistPenalty));

        assert!(has_bid_penalty, "Should have bid too low penalty");
        assert!(has_blacklist_penalty, "Should have blacklist penalty");

        let total_penalties: u64 = settlements.iter().map(|s| s.claims_amount).sum();
        assert!(total_penalties > 0, "Should have total penalty amount");
    }

    #[test]
    fn test_zero_rewards() {
        let epoch = 100;
        let vote_account = test_vote_account(1);

        let stake_meta_collection = StakeMetaCollection {
            epoch,
            slot: 1000,
            stake_metas: vec![
                create_stake_meta(
                    test_stake_account(1),
                    vote_account,
                    test_withdraw_authority(1),
                    test_stake_authority(1),
                    100 * LAMPORTS_PER_SOL,
                ),
                create_stake_meta(
                    test_stake_account(100),
                    vote_account,
                    TEST_PUBKEY_MARINADE,
                    TEST_PUBKEY_MARINADE,
                    LAMPORTS_PER_SOL,
                ),
            ],
        };

        let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

        let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

        let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
            .auction_values(commissions)
            .build();

        let mut rewards_map = HashMap::new();
        rewards_map.insert(vote_account, RewardsParams::new(vote_account).build());

        let rewards_collection = RewardsCollection {
            epoch,
            rewards_by_vote_account: rewards_map,
        };

        let settlement_config = create_test_settlement_config(950, 500);

        let settlements = generate_bid_settlements(
            &stake_meta_index,
            &vec![sam_meta],
            &rewards_collection,
            &|_| true,
            &settlement_config,
        );

        assert!(!settlements.is_empty());
        assert!(
            settlements[0].claims_amount > 0,
            "Should have claims from static bid even with zero rewards"
        );
    }

    const TEST_PUBKEY_MARINADE: Pubkey = Pubkey::new_from_array([
        16, 193, 125, 202, 226, 246, 166, 247, 62, 235, 241, 168, 44, 170, 26, 135, 207, 86, 46,
        127, 152, 219, 15, 111, 57, 48, 64, 201, 193, 113, 238, 142,
    ]);

    const TEST_PUBKEY_DAO: Pubkey = Pubkey::new_from_array([
        127, 8, 55, 242, 45, 122, 204, 129, 76, 202, 221, 104, 240, 55, 246, 62, 64, 185, 52, 25,
        125, 221, 190, 84, 112, 113, 168, 226, 2, 126, 28, 227,
    ]);

    #[derive(Default)]
    struct CommissionParams {
        inflation_final: Decimal,
        inflation_onchain: Decimal,
        inflation_in_bonds: Option<Decimal>,
        mev_final: Decimal,
        mev_onchain: Option<Decimal>,
        mev_in_bonds: Option<Decimal>,
        block_rewards_final: Decimal,
        block_rewards_in_bonds: Option<Decimal>,
    }

    impl CommissionParams {
        fn new(onchain: f64, in_bonds: f64) -> Self {
            let onchain_dec = Decimal::try_from(onchain).unwrap();
            let bonds_dec = Decimal::try_from(in_bonds).unwrap();
            Self {
                inflation_final: onchain_dec,
                inflation_onchain: onchain_dec,
                inflation_in_bonds: Some(bonds_dec),
                mev_final: onchain_dec,
                mev_onchain: Some(onchain_dec),
                mev_in_bonds: Some(bonds_dec),
                block_rewards_final: onchain_dec,
                block_rewards_in_bonds: Some(bonds_dec),
            }
        }

        fn as_commission_details(&self) -> CommissionDetails {
            CommissionDetails {
                inflation_commission_dec: self.inflation_final,
                mev_commission_dec: self.mev_final,
                block_rewards_commission_dec: self.block_rewards_final,
                inflation_commission_onchain_dec: self.inflation_onchain,
                inflation_commission_in_bonds_dec: self.inflation_in_bonds,
                inflation_commission_override_dec: None,
                mev_commission_onchain_dec: self.mev_onchain,
                mev_commission_in_bonds_dec: self.mev_in_bonds,
                mev_commission_override_dec: None,
                block_rewards_commission_in_bonds_dec: self.block_rewards_in_bonds,
                block_rewards_commission_override_dec: None,
            }
        }
    }

    fn test_vote_account(seed: u8) -> Pubkey {
        test_pubkey(seed)
    }

    fn test_stake_account(seed: u8) -> Pubkey {
        test_pubkey(seed + 100)
    }

    fn test_withdraw_authority(seed: u8) -> Pubkey {
        test_pubkey(seed + 200)
    }

    fn test_stake_authority(seed: u8) -> Pubkey {
        test_pubkey(seed + 250)
    }

    fn test_pubkey(seed: u8) -> Pubkey {
        let mut bytes = [0u8; 32];
        bytes[0] = seed;
        Pubkey::new_from_array(bytes)
    }

    fn create_stake_meta(
        pubkey: Pubkey,
        validator: Pubkey,
        withdraw_authority: Pubkey,
        stake_authority: Pubkey,
        active_delegation_lamports: u64,
    ) -> StakeMeta {
        StakeMeta {
            pubkey,
            validator: Some(validator),
            withdraw_authority,
            stake_authority,
            active_delegation_lamports,
            balance_lamports: active_delegation_lamports,
            activating_delegation_lamports: 0,
            deactivating_delegation_lamports: 0,
        }
    }

    struct SamMetaParams {
        vote_account: Pubkey,
        epoch: u32,
        marinade_sam_target_sol: Decimal,
        marinade_mnde_target_sol: Decimal,
        effective_bid: Decimal,
        bid_pmpe: Decimal,
        auction_effective_static_bid_pmpe: Option<Decimal>,
        bid_too_low_penalty_pmpe: Decimal,
        blacklist_penalty_pmpe: Decimal,
        auction_validator_values: Option<AuctionValidatorValues>,
    }

    impl SamMetaParams {
        fn new(vote_account: Pubkey, epoch: u32) -> Self {
            Self {
                vote_account,
                epoch,
                marinade_sam_target_sol: Decimal::from(100),
                marinade_mnde_target_sol: Decimal::ZERO,
                effective_bid: Decimal::from(50),
                bid_pmpe: Decimal::from(50),
                auction_effective_static_bid_pmpe: Some(Decimal::from(50)),
                bid_too_low_penalty_pmpe: Decimal::ZERO,
                blacklist_penalty_pmpe: Decimal::ZERO,
                auction_validator_values: None,
            }
        }

        fn effective_bid(mut self, value: f64) -> Self {
            self.effective_bid = Decimal::try_from(value).unwrap();
            self
        }

        fn bid_pmpe(mut self, value: f64) -> Self {
            self.bid_pmpe = Decimal::try_from(value).unwrap();
            self
        }

        fn static_bid(mut self, value: f64) -> Self {
            self.auction_effective_static_bid_pmpe = Some(Decimal::try_from(value).unwrap());
            self
        }

        fn bid_too_low_penalty(mut self, value: f64) -> Self {
            self.bid_too_low_penalty_pmpe = Decimal::try_from(value).unwrap();
            self
        }

        fn blacklist_penalty(mut self, value: f64) -> Self {
            self.blacklist_penalty_pmpe = Decimal::try_from(value).unwrap();
            self
        }

        fn auction_values(mut self, commissions: CommissionDetails) -> Self {
            self.auction_validator_values = Some(create_auction_validator_values(commissions));
            self
        }

        fn build(self) -> ValidatorSamMeta {
            ValidatorSamMeta {
                vote_account: self.vote_account,
                epoch: self.epoch,
                marinade_sam_target_sol: self.marinade_sam_target_sol,
                marinade_mnde_target_sol: self.marinade_mnde_target_sol,
                effective_bid: self.effective_bid,
                rev_share: RevShare {
                    bid_pmpe: self.bid_pmpe,
                    bid_too_low_penalty_pmpe: self.bid_too_low_penalty_pmpe,
                    blacklist_penalty_pmpe: self.blacklist_penalty_pmpe,
                    auction_effective_static_bid_pmpe: self.auction_effective_static_bid_pmpe,
                    ..RevShare::default()
                },
                stake_priority: 0,
                unstake_priority: 0,
                max_stake_wanted: Decimal::ZERO,
                constraints: String::new(),
                metadata: SamMetadata::default(),
                scoring_run_id: 0,
                auction_validator_values: self.auction_validator_values,
            }
        }
    }

    fn create_auction_validator_values(commissions: CommissionDetails) -> AuctionValidatorValues {
        AuctionValidatorValues {
            bond_balance_sol: Some(Decimal::from(100)),
            marinade_activated_stake_sol: Decimal::from(1000),
            sam_blacklisted: false,
            commissions: Some(commissions),
            ..AuctionValidatorValues::default()
        }
    }

    fn create_test_settlement_config(
        marinade_fee_bps: u64,
        dao_fee_split_share_bps: u64,
    ) -> SettlementConfig {
        SettlementConfig::Bidding {
            meta: SettlementMeta {
                funder: SettlementFunder::ValidatorBond,
            },
            marinade_fee_bps,
            marinade_stake_authority: TEST_PUBKEY_MARINADE,
            marinade_withdraw_authority: TEST_PUBKEY_MARINADE,
            dao_fee_split_share_bps,
            dao_stake_authority: TEST_PUBKEY_DAO,
            dao_withdraw_authority: TEST_PUBKEY_DAO,
        }
    }

    struct RewardsParams {
        vote_account: Pubkey,
        inflation_rewards: u64,
        mev_rewards: u64,
        block_rewards: u64,
        jito_priority_fee_rewards: u64,
    }

    impl RewardsParams {
        fn new(vote_account: Pubkey) -> Self {
            Self {
                vote_account,
                inflation_rewards: 0,
                mev_rewards: 0,
                block_rewards: 0,
                jito_priority_fee_rewards: 0,
            }
        }

        fn inflation(mut self, rewards: u64) -> Self {
            self.inflation_rewards = rewards;
            self
        }

        fn mev(mut self, rewards: u64) -> Self {
            self.mev_rewards = rewards;
            self
        }

        fn block_rewards(mut self, rewards: u64) -> Self {
            self.block_rewards = rewards;
            self
        }

        fn jito(mut self, rewards: u64) -> Self {
            self.jito_priority_fee_rewards = rewards;
            self
        }

        fn build(self) -> VoteAccountRewards {
            let total_amount = self.inflation_rewards + self.mev_rewards + self.block_rewards;
            let validators_total_amount = total_amount - self.jito_priority_fee_rewards;
            VoteAccountRewards {
                vote_account: self.vote_account,
                total_amount,
                inflation_rewards: self.inflation_rewards,
                mev_rewards: self.mev_rewards,
                block_rewards: self.block_rewards,
                jito_priority_fee_rewards: self.jito_priority_fee_rewards,
                validators_total_amount,
                stakers_inflation_rewards: 0,
                stakers_mev_rewards: 0,
                stakers_priority_fee_rewards: 0,
                stakers_total_amount: 0,
            }
        }
    }

    fn has_claim_for_authority(
        settlements: &[Settlement],
        stake_authority: &Pubkey,
        withdraw_authority: &Pubkey,
    ) -> bool {
        settlements.iter().any(|s| {
            s.claims.iter().any(|c| {
                c.stake_authority == *stake_authority && c.withdraw_authority == *withdraw_authority
            })
        })
    }

    fn sum_claims_for_authority(
        settlements: &[Settlement],
        stake_authority: &Pubkey,
        withdraw_authority: &Pubkey,
    ) -> u64 {
        settlements
            .iter()
            .flat_map(|s| s.claims.iter())
            .filter(|c| {
                c.stake_authority == *stake_authority && c.withdraw_authority == *withdraw_authority
            })
            .map(|c| c.claim_amount)
            .sum()
    }
}
