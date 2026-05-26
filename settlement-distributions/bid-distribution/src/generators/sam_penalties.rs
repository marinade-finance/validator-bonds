use crate::sam_meta::ValidatorSamMeta;
use crate::settlement_config::{FeeConfig, SettlementConfig};
use anyhow::{anyhow, ensure, Context};
use log::info;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::{Settlement, SettlementClaim, SettlementReason};
use settlement_common::stake_meta_index::StakeMetaIndex;
use solana_sdk::native_token::LAMPORTS_PER_SOL;
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
) -> anyhow::Result<Vec<Settlement>> {
    info!("Generating penalty settlements...");

    let bid_fee_percentages = fee_config.fee_percentages();

    let mut penalty_settlement_collection = vec![];
    let fee_deposit = get_fee_deposit_stake_accounts(stake_meta_index, fee_config);

    for validator in sam_validator_metas {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(&validator.vote_account)
        {
            let grouped_stake_metas: Vec<_> = grouped_stake_metas.collect();
            let bid_too_low_penalty =
                validator.rev_share.bid_too_low_penalty_pmpe / Decimal::ONE_THOUSAND;
            let blacklist_penalty =
                validator.rev_share.blacklist_penalty_pmpe / Decimal::ONE_THOUSAND;

            // Compute total_marinade_active_stake in a single pass (no double iteration)
            let total_marinade_active_stake: u64 = grouped_stake_metas
                .iter()
                .filter(|(&(_, &stake_authority), _)| stake_authority_filter(&stake_authority))
                .flat_map(|(_, metas)| metas.iter())
                .map(|meta| meta.active_delegation_lamports)
                .sum();

            let bid_too_low_penalty_total_claim =
                Decimal::from(total_marinade_active_stake) * bid_too_low_penalty;
            let distributor_bid_too_low_penalty_claim = (bid_too_low_penalty_total_claim
                * bid_fee_percentages.max_fee)
                .to_u64()
                .ok_or_else(|| anyhow!("Failed to_u64 for distributor_bid_penalty_claim"))?;
            let stakers_bid_too_low_penalty_claim = bid_too_low_penalty_total_claim
                .to_u64()
                .ok_or_else(|| anyhow!("Failed to_u64 for stakers_bid_penalty_claim"))?
                .saturating_sub(distributor_bid_too_low_penalty_claim);
            let dao_bid_too_low_penalty_claim =
                (Decimal::from(distributor_bid_too_low_penalty_claim)
                    * bid_fee_percentages.dao_fee_share)
                    .to_u64()
                    .ok_or_else(|| anyhow!("Failed to_u64 for dao_bid_penalty_claim"))?;
            let marinade_bid_too_low_penalty_claim =
                distributor_bid_too_low_penalty_claim.saturating_sub(dao_bid_too_low_penalty_claim);

            let blacklist_penalty_total_claim =
                Decimal::from(total_marinade_active_stake) * blacklist_penalty;
            let stakers_blacklist_penalty_claim = blacklist_penalty_total_claim
                .to_u64()
                .ok_or_else(|| anyhow!("Failed to_u64 for stakers_blacklist_penalty_claim"))?;

            let stakers_bond_risk_fee_claim = validator
                .values
                .as_ref()
                .map(|v| {
                    (v.bond_risk_fee_sol * Decimal::from(LAMPORTS_PER_SOL))
                        .to_u64()
                        .unwrap_or(0)
                })
                .unwrap_or(0);

            let mut bid_too_low_penalty_claims = vec![];
            let mut claimed_bid_too_low_penalty_amount = 0;

            let mut blacklist_penalty_claims = vec![];
            let mut claimed_blacklist_penalty_amount = 0;

            let mut bond_risk_fee_claims = vec![];
            let mut claimed_bond_risk_fee_amount = 0;

            for (&(withdraw_authority, stake_authority), stake_metas) in grouped_stake_metas
                .iter()
                .filter(|(&(_, &stake_authority), _)| stake_authority_filter(&stake_authority))
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
                    .ok_or_else(|| {
                        anyhow!("bid_penalty_claim_amount is not representable as u64")
                    })?;
                    let blacklist_penalty_claim_amount = (staker_share
                        * Decimal::from(stakers_blacklist_penalty_claim))
                    .to_u64()
                    .ok_or_else(|| {
                        anyhow!("blacklist_penalty_claim_amount is not representable as u64")
                    })?;
                    let bond_risk_fee_claim_amount = (staker_share
                        * Decimal::from(stakers_bond_risk_fee_claim))
                    .to_u64()
                    .ok_or_else(|| {
                        anyhow!("bond_risk_fee_claim_amount is not representable as u64")
                    })?;

                    if bid_penalty_claim_amount > 0 {
                        bid_too_low_penalty_claims.push(SettlementClaim {
                            withdraw_authority: *withdraw_authority,
                            stake_authority: *stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount: bid_penalty_claim_amount,
                            active_stake,
                            activating_stake: 0,
                        });
                        claimed_bid_too_low_penalty_amount += bid_penalty_claim_amount;
                    }
                    if blacklist_penalty_claim_amount > 0 {
                        blacklist_penalty_claims.push(SettlementClaim {
                            withdraw_authority: *withdraw_authority,
                            stake_authority: *stake_authority,
                            stake_accounts: stake_accounts.clone(),
                            claim_amount: blacklist_penalty_claim_amount,
                            active_stake,
                            activating_stake: 0,
                        });
                        claimed_blacklist_penalty_amount += blacklist_penalty_claim_amount;
                    }
                    if bond_risk_fee_claim_amount > 0 {
                        bond_risk_fee_claims.push(SettlementClaim {
                            withdraw_authority: *withdraw_authority,
                            stake_authority: *stake_authority,
                            stake_accounts,
                            claim_amount: bond_risk_fee_claim_amount,
                            active_stake,
                            activating_stake: 0,
                        });
                        claimed_bond_risk_fee_amount += bond_risk_fee_claim_amount;
                    }
                }
            }

            ensure!(
                claimed_bid_too_low_penalty_amount <= stakers_bid_too_low_penalty_claim,
                "Total claimed bid_penalty amount {} is bigger than stakers bid_penalty claim {} for validator {}",
                claimed_bid_too_low_penalty_amount,
                stakers_bid_too_low_penalty_claim,
                validator.vote_account
            );
            ensure!(
                claimed_blacklist_penalty_amount <= stakers_blacklist_penalty_claim,
                "Total claimed blacklist_penalty amount {} is bigger than stakers blacklist_penalty claim {} for validator {}",
                claimed_blacklist_penalty_amount,
                stakers_blacklist_penalty_claim,
                validator.vote_account
            );
            ensure!(
                claimed_bond_risk_fee_amount <= stakers_bond_risk_fee_claim,
                "Total claimed bond_risk_fee amount {} is bigger than stakers bond_risk_fee claim {} for validator {}",
                claimed_bond_risk_fee_amount,
                stakers_bond_risk_fee_claim,
                validator.vote_account
            );

            if total_marinade_active_stake > 0 {
                let bid_too_low_penalty_total_claim_u64 = bid_too_low_penalty_total_claim
                    .to_u64()
                    .ok_or_else(|| anyhow!("Failed to_u64 for bid_penalty_total_claim"))?;
                let authorities = fee_config.fee_authorities();
                if marinade_bid_too_low_penalty_claim > 0 {
                    bid_too_low_penalty_claims.push(SettlementClaim {
                        withdraw_authority: authorities.marinade_withdraw,
                        stake_authority: authorities.marinade_stake,
                        stake_accounts: fee_deposit.marinade_active.clone(),
                        claim_amount: marinade_bid_too_low_penalty_claim,
                        active_stake: fee_deposit.marinade_active.values().sum(),
                        activating_stake: 0,
                    });
                    claimed_bid_too_low_penalty_amount += marinade_bid_too_low_penalty_claim;
                }
                if dao_bid_too_low_penalty_claim > 0 {
                    bid_too_low_penalty_claims.push(SettlementClaim {
                        withdraw_authority: authorities.dao_withdraw,
                        stake_authority: authorities.dao_stake,
                        stake_accounts: fee_deposit.dao_active.clone(),
                        claim_amount: dao_bid_too_low_penalty_claim,
                        active_stake: fee_deposit.dao_active.values().sum(),
                        activating_stake: 0,
                    });
                    claimed_bid_too_low_penalty_amount += dao_bid_too_low_penalty_claim;
                }
                ensure!(
                    claimed_bid_too_low_penalty_amount <= bid_too_low_penalty_total_claim_u64,
                    "The sum of total claims {} exceeds the bid penalty amount {} for validator {}",
                    claimed_bid_too_low_penalty_amount,
                    bid_too_low_penalty_total_claim_u64,
                    validator.vote_account
                );
            }

            // Build settlement for bid_too_low_penalty
            if !bid_too_low_penalty_claims.is_empty() {
                let bid_penalty_details = BidTooLowPenaltyDetails {
                    total_marinade_active_stake,
                    effective_sam_marinade_active_stake: total_marinade_active_stake,
                    bid_too_low_penalty_pmpe: bid_too_low_penalty.to_string(),
                    bid_too_low_penalty_total_claim: bid_too_low_penalty_total_claim.to_string(),
                    distributor_bid_too_low_penalty_claim,
                    stakers_bid_too_low_penalty_claim,
                    dao_bid_too_low_penalty_claim,
                    marinade_bid_too_low_penalty_claim,
                };
                let details_json = serde_json::to_value(&bid_penalty_details)?;

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
                    effective_sam_marinade_active_stake: total_marinade_active_stake,
                    blacklist_penalty_pmpe: blacklist_penalty.to_string(),
                    blacklist_penalty_total_claim: blacklist_penalty_total_claim.to_string(),
                    stakers_blacklist_penalty_claim,
                };
                let details_json = serde_json::to_value(&blacklist_penalty_details)?;

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
                    effective_sam_marinade_active_stake: total_marinade_active_stake,
                    bond_risk_fee_sol: validator
                        .values
                        .as_ref()
                        .map(|v| v.bond_risk_fee_sol.to_string())
                        .unwrap_or_default(),
                    stakers_bond_risk_fee_claim,
                };
                let details_json = serde_json::to_value(&bond_risk_fee_details)
                    .context("Failed to serialize BondRiskFeeDetails")?;

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
    Ok(penalty_settlement_collection)
}
