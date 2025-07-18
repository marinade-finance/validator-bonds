use crate::sam_meta::ValidatorSamMeta;
use crate::settlement_config::SettlementConfig;
use bid_psr_distribution::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection, SettlementReason,
};
use bid_psr_distribution::stake_meta_index::StakeMetaIndex;
use log::info;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

pub fn generate_bid_settlement_collection(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_config: &SettlementConfig,
) -> SettlementCollection {
    let settlements = generate_bid_settlements(
        stake_meta_index,
        sam_validator_metas,
        &stake_authority_filter,
        settlement_config,
    );

    SettlementCollection {
        slot: stake_meta_index.stake_meta_collection.slot,
        epoch: stake_meta_index.stake_meta_collection.epoch,
        settlements,
    }
}

pub fn generate_bid_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_config: &SettlementConfig,
) -> Vec<Settlement> {
    info!("Generating bid settlements...");

    assert!(
        sam_validator_metas
            .iter()
            .all(|v| v.epoch as u64 == stake_meta_index.stake_meta_collection.epoch),
        "SAM Validators Collection epoch must be same as stake meta collection epoch"
    );

    let mut settlement_claim_collections = vec![];

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
            let sam_target_stake =
                validator.marinade_sam_target_sol * Decimal::from_f64(1e9).unwrap();
            let mnde_target_stake =
                validator.marinade_mnde_target_sol * Decimal::from_f64(1e9).unwrap();
            let distributor_fee_percentage =
                Decimal::from(*settlement_config.marinade_fee_bps()) / Decimal::from(10_000);
            let dao_fee_share =
                Decimal::from(*settlement_config.dao_fee_split_share_bps()) / Decimal::from(10_000);
            let effective_bid = validator.effective_bid / Decimal::ONE_THOUSAND;
            let bid_too_low_penalty =
                validator.rev_share.bid_too_low_penalty_pmpe / Decimal::ONE_THOUSAND;
            let blacklist_penalty = validator
                .rev_share
                .blacklist_penalty_pmpe
                .unwrap_or(Decimal::ZERO)
                / Decimal::ONE_THOUSAND;

            let total_active_stake: u64 = stake_meta_index
                .iter_grouped_stake_metas(&validator.vote_account)
                .unwrap()
                .filter(|(&(_, &stake_authority), _)| stake_authority_filter(&stake_authority))
                .flat_map(|(_, metas)| metas.iter())
                .map(|meta| meta.active_delegation_lamports)
                .sum();

            let stake_sam_percentage = if mnde_target_stake == Decimal::ZERO {
                Decimal::ONE
            } else {
                sam_target_stake / (sam_target_stake + mnde_target_stake)
            };

            let initial_sam_stake = (Decimal::from(total_active_stake) * stake_sam_percentage)
                .to_u64()
                .unwrap();
            let effective_sam_stake: u64 = initial_sam_stake;
            let effective_bid_claim = Decimal::from(effective_sam_stake) * effective_bid;
            let total_rev_share = validator.rev_share.total_pmpe / Decimal::ONE_THOUSAND;
            let expected_total_rewards = Decimal::from(effective_sam_stake) * total_rev_share;
            let total_fee_claim =
                (expected_total_rewards * distributor_fee_percentage).min(effective_bid_claim);

            let stakers_total_claim = Decimal::ZERO
                .max(effective_bid_claim - total_fee_claim)
                .to_u64()
                .unwrap();
            let dao_fee_claim = (total_fee_claim * dao_fee_share).to_u64().unwrap();
            let marinade_fee_claim = (total_fee_claim - Decimal::from(dao_fee_claim))
                .to_u64()
                .unwrap();

            let bid_penalty_total_claim = Decimal::from(effective_sam_stake) * bid_too_low_penalty;
            let distributor_bid_penalty_claim = (bid_penalty_total_claim
                * distributor_fee_percentage)
                .to_u64()
                .unwrap();
            let stakers_bid_penalty_claim =
                bid_penalty_total_claim.to_u64().unwrap() - distributor_bid_penalty_claim;
            let dao_bid_penalty_claim = (Decimal::from(distributor_bid_penalty_claim)
                * dao_fee_share)
                .to_u64()
                .unwrap();
            let marinade_bid_penalty_claim = (distributor_bid_penalty_claim
                - dao_bid_penalty_claim)
                .to_u64()
                .unwrap();

            let blacklist_penalty_total_claim =
                Decimal::from(effective_sam_stake) * blacklist_penalty;
            let stakers_blacklist_penalty_claim = blacklist_penalty_total_claim.to_u64().unwrap();

            let mut claims = vec![];
            let mut claims_amount = 0;

            let mut bid_penalty_claims = vec![];
            let mut claimed_bid_penalty_amount = 0;

            let mut blacklist_penalty_claims = vec![];
            let mut claimed_blacklist_penalty_amount = 0;

            for ((withdraw_authority, stake_authority), stake_metas) in grouped_stake_metas {
                if !stake_authority_filter(stake_authority) {
                    continue;
                }
                let stake_accounts: HashMap<_, _> = stake_metas
                    .iter()
                    .map(|s| (s.pubkey, s.active_delegation_lamports))
                    .collect();
                let active_stake: u64 = stake_accounts.values().sum();
                if active_stake > 0 {
                    let staker_share =
                        Decimal::from(active_stake) / Decimal::from(total_active_stake);
                    let claim_amount = (staker_share * Decimal::from(stakers_total_claim))
                        .to_u64()
                        .expect("claim_amount is not integral");
                    let bid_penalty_claim_amount = (staker_share
                        * Decimal::from(stakers_bid_penalty_claim))
                    .to_u64()
                    .expect("bid_penalty_claim_amount is not integral");
                    let blacklist_penalty_claim_amount = (staker_share
                        * Decimal::from(stakers_blacklist_penalty_claim))
                    .to_u64()
                    .expect("blacklist_penalty_claim_amount is not integral");
                    if claim_amount > 0 {
                        claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount,
                            active_stake,
                        });
                        claims_amount += claim_amount;
                    }
                    if bid_penalty_claim_amount > 0 {
                        bid_penalty_claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount: bid_penalty_claim_amount,
                            active_stake,
                        });
                        claimed_bid_penalty_amount += bid_penalty_claim_amount;
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
                claims_amount <= stakers_total_claim,
                "Claims amount is bigger than stakers total claim"
            );

            assert!(
                claimed_bid_penalty_amount <= stakers_bid_penalty_claim,
                "Total claimed bid_penalty amount is bigger than stakers bid_penalty claim"
            );

            assert!(
                claimed_blacklist_penalty_amount <= stakers_blacklist_penalty_claim,
                "Total claimed blacklist_penalty amount is bigger than stakers blacklist_penalty claim"
            );

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

            if initial_sam_stake > 0 {
                if marinade_fee_claim > 0 {
                    claims.push(SettlementClaim {
                        withdraw_authority: *settlement_config.marinade_withdraw_authority(),
                        stake_authority: *settlement_config.marinade_stake_authority(),
                        stake_accounts: marinade_fee_deposit_stake_accounts.clone(),
                        claim_amount: marinade_fee_claim,
                        active_stake: total_active_stake,
                    });
                    claims_amount += marinade_fee_claim;

                    assert!(
                        claims_amount <= effective_bid_claim.to_u64().unwrap(),
                        "The sum of total claims exceeds the bid amount after adding the Marinade fee"
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
                        claims_amount <= effective_bid_claim.to_u64().unwrap(),
                        "The sum of total claims exceeds the bid amount after adding the DAO fee"
                    );
                }
                if marinade_bid_penalty_claim > 0 {
                    bid_penalty_claims.push(SettlementClaim {
                        withdraw_authority: *settlement_config.marinade_withdraw_authority(),
                        stake_authority: *settlement_config.marinade_stake_authority(),
                        stake_accounts: marinade_fee_deposit_stake_accounts.clone(),
                        claim_amount: marinade_bid_penalty_claim,
                        active_stake: total_active_stake,
                    });
                    claimed_bid_penalty_amount += marinade_bid_penalty_claim;

                    assert!(
                        claimed_bid_penalty_amount <= bid_penalty_total_claim.to_u64().unwrap(),
                        "The sum of total claims exceeds the bid penalty amount after adding the Marinade fee"
                    );
                }
                if dao_bid_penalty_claim > 0 {
                    bid_penalty_claims.push(SettlementClaim {
                        withdraw_authority: *settlement_config.dao_withdraw_authority(),
                        stake_authority: *settlement_config.dao_stake_authority(),
                        stake_accounts: dao_fee_deposit_stake_accounts.clone(),
                        claim_amount: dao_bid_penalty_claim,
                        active_stake: total_active_stake,
                    });
                    claimed_bid_penalty_amount += dao_bid_penalty_claim;

                    assert!(
                        claimed_bid_penalty_amount <= bid_penalty_total_claim.to_u64().unwrap(),
                        "The sum of total claims exceeds the bid penalty amount after adding the DAO fee"
                    );
                }
            }
            if !claims.is_empty() {
                settlement_claim_collections.push(Settlement {
                    reason: SettlementReason::Bidding,
                    meta: settlement_config.meta().clone(),
                    vote_account: validator.vote_account,
                    claims_count: claims.len(),
                    claims_amount,
                    claims,
                });
            }
            if !bid_penalty_claims.is_empty() {
                settlement_claim_collections.push(Settlement {
                    reason: SettlementReason::BidTooLowPenalty,
                    meta: settlement_config.meta().clone(),
                    vote_account: validator.vote_account,
                    claims_count: bid_penalty_claims.len(),
                    claims_amount: claimed_bid_penalty_amount,
                    claims: bid_penalty_claims,
                });
            }
            if !blacklist_penalty_claims.is_empty() {
                settlement_claim_collections.push(Settlement {
                    reason: SettlementReason::BlacklistPenalty,
                    meta: settlement_config.meta().clone(),
                    vote_account: validator.vote_account,
                    claims_count: blacklist_penalty_claims.len(),
                    claims_amount: claimed_blacklist_penalty_amount,
                    claims: blacklist_penalty_claims,
                });
            }
        }
    }
    settlement_claim_collections
}
