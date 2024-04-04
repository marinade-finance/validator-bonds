#![allow(clippy::type_complexity)]
use crate::{
    protected_events::ProtectedEvent,
    settlement_config::{build_protected_event_matcher, SettlementConfig},
    stake_meta_index::StakeMetaIndex,
};
use log::info;
use solana_sdk::pubkey::Pubkey;

use {
    crate::protected_events::ProtectedEventCollection,
    merkle_tree::serde_serialize::{map_pubkey_string_conversion, pubkey_string_conversion},
    serde::{Deserialize, Serialize},
    std::collections::HashMap,
};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SettlementClaim {
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    #[serde(with = "map_pubkey_string_conversion")]
    pub stake_accounts: HashMap<Pubkey, u64>,
    pub active_stake: u64,
    pub claim_amount: u64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum SettlementReason {
    ProtectedEvent(ProtectedEvent),
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub enum SettlementFunder {
    ValidatorBond,
    Marinade,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct SettlementMeta {
    funder: SettlementFunder,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct Settlement {
    pub reason: SettlementReason,
    pub meta: SettlementMeta,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub claims_count: usize,
    pub claims_amount: u64,
    pub claims: Vec<SettlementClaim>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct SettlementCollection {
    pub slot: u64,
    pub epoch: u64,
    pub settlements: Vec<Settlement>,
}

pub fn generate_settlements(
    stake_meta_index: &StakeMetaIndex,
    protected_event_collection: &ProtectedEventCollection,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_config: &SettlementConfig,
) -> Vec<Settlement> {
    info!("Generating settlement claim collection {settlement_config:?}...");
    assert_eq!(
        stake_meta_index.stake_meta_collection.epoch, protected_event_collection.epoch,
        "Protected event collection epoch must be same as stake meta collection epoch"
    );
    assert_eq!(
        stake_meta_index.stake_meta_collection.slot,
        protected_event_collection.slot
    );

    let protected_event_matcher = build_protected_event_matcher(settlement_config);
    let matching_protected_events = protected_event_collection
        .events
        .iter()
        .filter(|event| protected_event_matcher(event));

    let mut settlement_claim_collections = vec![];

    for protected_event in matching_protected_events {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(protected_event.vote_account())
        {
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
                let active_stake = stake_accounts.values().sum();

                let claim_amount = protected_event.claim_amount_in_loss_range(
                    settlement_config.covered_range_bps(),
                    active_stake,
                );

                if active_stake > 0 && claim_amount > 0 {
                    claims.push(SettlementClaim {
                        withdraw_authority: **withdraw_authority,
                        stake_authority: **stake_authority,
                        stake_accounts,
                        active_stake,
                        claim_amount,
                    });
                    claims_amount += claim_amount;
                }
            }

            if claims_amount >= settlement_config.min_settlement_lamports() {
                settlement_claim_collections.push(Settlement {
                    reason: SettlementReason::ProtectedEvent(protected_event.clone()),
                    meta: settlement_config.meta().clone(),
                    vote_account: *protected_event.vote_account(),
                    claims_count: claims.len(),
                    claims_amount,
                    claims,
                });
            }
        }
    }
    settlement_claim_collections
}

pub fn generate_settlement_collection(
    stake_meta_index: &StakeMetaIndex,
    protected_event_collection: &ProtectedEventCollection,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_configs: &[SettlementConfig],
) -> SettlementCollection {
    assert_eq!(
        stake_meta_index.stake_meta_collection.epoch, protected_event_collection.epoch,
        "Protected event collection epoch must be same as stake meta collection epoch"
    );
    assert_eq!(
        stake_meta_index.stake_meta_collection.slot,
        protected_event_collection.slot
    );

    let settlements: Vec<_> = settlement_configs
        .iter()
        .flat_map(|settlement_config| {
            generate_settlements(
                stake_meta_index,
                protected_event_collection,
                stake_authority_filter,
                settlement_config,
            )
        })
        .collect();

    SettlementCollection {
        slot: stake_meta_index.stake_meta_collection.slot,
        epoch: stake_meta_index.stake_meta_collection.epoch,
        settlements,
    }
}
