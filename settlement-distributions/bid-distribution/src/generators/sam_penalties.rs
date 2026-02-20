use crate::sam_meta::ValidatorSamMeta;
use crate::settlement_config::{FeeConfig, SettlementConfig};
use log::{info, warn};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::{Settlement, SettlementClaim, SettlementReason};
use settlement_common::stake_meta_index::StakeMetaIndex;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

use super::{add_to_settlement_collection, get_fee_deposit_stake_accounts};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BondRiskFeeDetails {
    pub total_marinade_active_stake: u64,
    pub effective_sam_marinade_active_stake: u64,
    pub bond_risk_fee_sol: String,
    pub stakers_bond_risk_fee_claim: u64,
}

pub fn generate_penalty_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &[ValidatorSamMeta],
    bid_too_low_penalty_config: &SettlementConfig,
    blacklist_penalty_config: &SettlementConfig,
    bond_risk_fee_config: &SettlementConfig,
    fee_config: &FeeConfig,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
) -> Vec<Settlement> {
    info!("Generating penalty settlements...");

    let bid_fee_percentages = fee_config.fee_percentages();

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

            let effective_sam_marinade_active_stake = total_marinade_active_stake;

            let bid_too_low_penalty_total_claim =
                Decimal::from(effective_sam_marinade_active_stake) * bid_too_low_penalty;
            let distributor_bid_too_low_penalty_claim = (bid_too_low_penalty_total_claim
                * bid_fee_percentages.marinade_distributor_fee)
                .to_u64()
                .expect("Failed to_u64 for distributor_bid_penalty_claim");
            let stakers_bid_too_low_penalty_claim = bid_too_low_penalty_total_claim
                .to_u64()
                .expect("Failed to_u64 for stakers_bid_penalty_claim")
                .saturating_sub(distributor_bid_too_low_penalty_claim);
            let dao_bid_too_low_penalty_claim =
                (Decimal::from(distributor_bid_too_low_penalty_claim)
                    * bid_fee_percentages.dao_fee_share)
                    .to_u64()
                    .expect("Failed to_u64 for dao_bid_penalty_claim");
            let marinade_bid_too_low_penalty_claim =
                distributor_bid_too_low_penalty_claim.saturating_sub(dao_bid_too_low_penalty_claim);

            let blacklist_penalty_total_claim =
                Decimal::from(effective_sam_marinade_active_stake) * blacklist_penalty;
            let stakers_blacklist_penalty_claim = blacklist_penalty_total_claim
                .to_u64()
                .expect("Failed to_u64 for stakers_blacklist_penalty_claim");

            let stakers_bond_risk_fee_claim = validator
                .values
                .as_ref()
                .map(|v| (v.bond_risk_fee_sol * Decimal::from(LAMPORTS_PER_SOL)).to_u64().unwrap_or(0))
                .unwrap_or(0);

            let mut bid_too_low_penalty_claims = vec![];
            let mut claimed_bid_too_low_penalty_amount = 0;

            let mut blacklist_penalty_claims = vec![];
            let mut claimed_blacklist_penalty_amount = 0;

            let mut bond_risk_fee_claims = vec![];
            let mut claimed_bond_risk_fee_amount = 0;

            let (marinade_fee_deposit_stake_accounts, dao_fee_deposit_stake_accounts) =
                get_fee_deposit_stake_accounts(stake_meta_index, fee_config);

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
                    let bond_risk_fee_claim_amount = (staker_share
                        * Decimal::from(stakers_bond_risk_fee_claim))
                    .to_u64()
                    .expect("bond_risk_fee_claim_amount is not integral");

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
                            stake_accounts: stake_accounts.clone(),
                            claim_amount: blacklist_penalty_claim_amount,
                            active_stake,
                        });
                        claimed_blacklist_penalty_amount += blacklist_penalty_claim_amount;
                    }
                    if bond_risk_fee_claim_amount > 0 {
                        bond_risk_fee_claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount: bond_risk_fee_claim_amount,
                            active_stake,
                        });
                        claimed_bond_risk_fee_amount += bond_risk_fee_claim_amount;
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
            assert!(
                claimed_bond_risk_fee_amount <= stakers_bond_risk_fee_claim,
                "Total claimed bond_risk_fee amount is bigger than stakers bond_risk_fee claim"
            );

            if effective_sam_marinade_active_stake > 0 {
                if marinade_bid_too_low_penalty_claim > 0 {
                    let (marinade_withdraw, marinade_stake, _, _) = fee_config.fee_authorities();
                    bid_too_low_penalty_claims.push(SettlementClaim {
                        withdraw_authority: *marinade_withdraw,
                        stake_authority: *marinade_stake,
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
                    let (_, _, dao_withdraw, dao_stake) = fee_config.fee_authorities();
                    bid_too_low_penalty_claims.push(SettlementClaim {
                        withdraw_authority: *dao_withdraw,
                        stake_authority: *dao_stake,
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

            // Build settlement for bid_too_low_penalty
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
                    bid_too_low_penalty_config.meta(),
                    Some(details_json),
                );
            }

            // Build settlement for blacklist_penalty
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
                    blacklist_penalty_config.meta(),
                    Some(details_json),
                );
            }

            // Build settlement for bond_risk_fee
            if !bond_risk_fee_claims.is_empty() {
                let bond_risk_fee_details = BondRiskFeeDetails {
                    total_marinade_active_stake,
                    effective_sam_marinade_active_stake,
                    bond_risk_fee_sol: validator
                        .values
                        .as_ref()
                        .map(|v| v.bond_risk_fee_sol.to_string())
                        .unwrap_or_default(),
                    stakers_bond_risk_fee_claim,
                };
                let details_json = serde_json::to_value(&bond_risk_fee_details)
                    .expect("Failed to serialize BondRiskFeeDetails");

                add_to_settlement_collection(
                    &mut penalty_settlement_collection,
                    bond_risk_fee_claims,
                    claimed_bond_risk_fee_amount,
                    SettlementReason::BondRiskFee,
                    validator.vote_account,
                    bond_risk_fee_config.meta(),
                    Some(details_json),
                );
            }
        }
    }
    penalty_settlement_collection
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BondRiskFeeDetails {
    pub total_marinade_active_stake: u64,
    pub bond_risk_fee_sol: String,
    pub stakers_bond_risk_fee_claim: u64,
}

pub fn generate_bond_risk_fee_settlements(
    stake_meta_index: &StakeMetaIndex,
    sam_validator_metas: &[ValidatorSamMeta],
    bond_risk_fee_config: &SettlementConfig,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
) -> Vec<Settlement> {
    info!("Generating bond risk fee settlements...");

    let mut settlement_collection = vec![];

    for validator in sam_validator_metas {
        let bond_risk_fee_sol = match &validator.values {
            Some(values) => values.bond_risk_fee_sol,
            None => continue,
        };
        if bond_risk_fee_sol <= Decimal::ZERO {
            continue;
        }

        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
            let stakers_bond_risk_fee_claim = (bond_risk_fee_sol * Decimal::from(LAMPORTS_PER_SOL))
                .to_u64()
                .expect("Failed to_u64 for stakers_bond_risk_fee_claim");

            if stakers_bond_risk_fee_claim == 0 {
                continue;
            }

            let total_marinade_active_stake: u64 = stake_meta_index
                .iter_grouped_stake_metas(&validator.vote_account)
                .expect("No items from iter_grouped_stake_metas")
                .filter(|(&(_, &stake_authority), _)| stake_authority_filter(&stake_authority))
                .flat_map(|(_, metas)| metas.iter())
                .map(|meta| meta.active_delegation_lamports)
                .sum();

            if total_marinade_active_stake == 0 {
                warn!(
                    "Skipping bond risk fee for validator {} with zero marinade active stake",
                    validator.vote_account
                );
                continue;
            }

            let mut bond_risk_fee_claims = vec![];
            let mut claimed_bond_risk_fee_amount = 0;

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
                    let bond_risk_fee_claim_amount = (staker_share
                        * Decimal::from(stakers_bond_risk_fee_claim))
                    .to_u64()
                    .expect("bond_risk_fee_claim_amount is not integral");

                    if bond_risk_fee_claim_amount > 0 {
                        bond_risk_fee_claims.push(SettlementClaim {
                            withdraw_authority: **withdraw_authority,
                            stake_authority: **stake_authority,
                            stake_accounts,
                            claim_amount: bond_risk_fee_claim_amount,
                            active_stake,
                        });
                        claimed_bond_risk_fee_amount += bond_risk_fee_claim_amount;
                    }
                }
            }

            assert!(
                claimed_bond_risk_fee_amount <= stakers_bond_risk_fee_claim,
                "Validator {}: total claimed bond_risk_fee amount {} is bigger than stakers bond_risk_fee claim {}",
                validator.vote_account,
                claimed_bond_risk_fee_amount,
                stakers_bond_risk_fee_claim
            );

            if !bond_risk_fee_claims.is_empty() {
                let details = BondRiskFeeDetails {
                    total_marinade_active_stake,
                    bond_risk_fee_sol: bond_risk_fee_sol.to_string(),
                    stakers_bond_risk_fee_claim,
                };
                let details_json =
                    serde_json::to_value(&details).expect("Failed to serialize BondRiskFeeDetails");

                add_to_settlement_collection(
                    &mut settlement_collection,
                    bond_risk_fee_claims,
                    claimed_bond_risk_fee_amount,
                    SettlementReason::BondRiskFee,
                    validator.vote_account,
                    bond_risk_fee_config.meta(),
                    Some(details_json),
                );
            }
        }
    }
    settlement_collection
}
