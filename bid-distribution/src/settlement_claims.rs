use crate::sam_meta::ValidatorSamMeta;
use crate::settlement_config::SettlementConfig;
use log::info;
use protected_event_distribution::settlement_claims::{
    Settlement, SettlementClaim, SettlementCollection, SettlementReason,
};
use protected_event_distribution::stake_meta_index::StakeMetaIndex;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use std::cmp::min;
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
            if validator.effective_bid == Decimal::ZERO {
                continue;
            }
            let sam_target_stake =
                validator.marinade_sam_target_sol * Decimal::from_f64(1e9).unwrap();
            let mnde_target_stake =
                validator.marinade_mnde_target_sol * Decimal::from_f64(1e9).unwrap();
            let max_wanted_stake = validator.max_stake_wanted * Decimal::from_f64(1e9).unwrap();
            let marinade_payment_percentage =
                Decimal::from(*settlement_config.marinade_fee_bps()) / Decimal::from(10000);
            let effective_bid = validator.effective_bid / Decimal::from(1000);

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
            let effective_sam_stake: u64 =
                min(initial_sam_stake, max_wanted_stake.to_u64().unwrap());
            let effective_total_claim = Decimal::from(effective_sam_stake) * effective_bid;
            let marinade_fee_claim = (effective_total_claim * marinade_payment_percentage)
                .to_u64()
                .unwrap();
            let stakers_total_claim = (effective_total_claim
                * (Decimal::from(1) - marinade_payment_percentage))
                .to_u64()
                .unwrap();

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
                let active_stake: u64 = stake_accounts.values().sum();
                if active_stake > 0 {
                    let claim_amount = ((Decimal::from(active_stake)
                        / Decimal::from(total_active_stake))
                        * Decimal::from(stakers_total_claim))
                    .to_u64()
                    .unwrap();
                    if claim_amount > 0 {
                        claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts,
                            claim_amount,
                            active_stake,
                        });
                        claims_amount += claim_amount;
                    }
                }
            }

            assert!(
                claims_amount <= stakers_total_claim,
                "Claims amount is bigger than stakers total claim"
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

            if effective_sam_stake > 0 && marinade_fee_claim > 0 {
                claims.push(SettlementClaim {
                    withdraw_authority: *settlement_config.marinade_withdraw_authority(),
                    stake_authority: *settlement_config.marinade_stake_authority(),
                    stake_accounts: marinade_fee_deposit_stake_accounts.clone(),
                    claim_amount: marinade_fee_claim,
                    active_stake: effective_sam_stake,
                });
                claims_amount += marinade_fee_claim;

                assert!(
                    claims_amount <= effective_total_claim.to_u64().unwrap(),
                    "The sum of total claims exceeds the sum of total staker and marinade fee claims"
                );
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
        }
    }
    settlement_claim_collections
}
