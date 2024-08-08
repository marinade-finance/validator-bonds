use crate::sam_meta::ValidatorSamMeta;
use log::info;
use settlement_engine::stake_meta_index::StakeMetaIndex;
use crate::settlement_config::SettlementConfig;
use solana_sdk::native_token::sol_to_lamports;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::cmp::min;
use settlement_engine::settlement_claims::{SettlementReason, Settlement, SettlementClaim, SettlementCollection};

pub fn generate_bid_settlement_collection(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &Vec<ValidatorSamMeta>,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_config: &SettlementConfig,
) -> SettlementCollection {
    let settlements = generate_bid_settlements(&stake_meta_index, &sam_validator_metas, &stake_authority_filter, &settlement_config);

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
    let mut settlement_claim_collections = vec![];

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
            if validator.effective_bid == 0.0 {
                continue;
            }
            let sam_target_stake = sol_to_lamports(validator.marinade_sam_target_sol);
            let mnde_target_stake = sol_to_lamports(validator.marinade_mnde_target_sol);
            let max_wanted_stake = sol_to_lamports(validator.max_stake_wanted);
            let marinade_payment_percentage = *settlement_config.marinade_fee_bps() as f64 / 10000.0;
            
            let marinade_stake: u64 = stake_meta_index.iter_grouped_stake_metas(&validator.vote_account).unwrap()
                .filter(|(&(_, &stake_authority), _)| stake_authority_filter(&stake_authority))
                .flat_map(|(_, metas)| metas.iter())
                .map(|meta| meta.active_delegation_lamports)
                .sum();

            if sam_target_stake + mnde_target_stake == 0 {
                continue;
            }
            let stake_sam_percentage = sam_target_stake as f64 / (sam_target_stake as f64 + mnde_target_stake as f64);
            let initial_sam_stake =  (marinade_stake as f64 * stake_sam_percentage) as u64;
            let effective_sam_stake: u64 = min(initial_sam_stake, max_wanted_stake);
            let effective_total_bid_claim = (effective_sam_stake as f64 * validator.effective_bid) as u64;
            let marinade_fee_claim = (effective_total_bid_claim as f64 * marinade_payment_percentage) as u64;
            let stakers_total_claim = (effective_total_bid_claim as f64 * (1.0 - marinade_payment_percentage)) as u64;

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
                let claim_amount = ((active_stake as f64 / effective_sam_stake as f64) * stakers_total_claim as f64) as u64;

                if **withdraw_authority == *settlement_config.marinade_withdraw_authority() && **stake_authority == *settlement_config.marinade_stake_authority() {
                    claims.push(SettlementClaim {
                        withdraw_authority: **withdraw_authority,
                        stake_authority: **stake_authority,
                        stake_accounts: stake_accounts,
                        claim_amount: marinade_fee_claim,
                        active_stake: active_stake,
                    });
                    claims_amount += marinade_fee_claim;
                }
                else if active_stake > 0 && claim_amount > 0 {
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

            if claims_amount > 0 {
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
