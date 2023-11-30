#![allow(clippy::type_complexity)]
use std::collections::HashSet;

use snapshot_parser::stake_meta::StakeMeta;

use {
    crate::insured_events::InsuredEventCollection,
    serde::{Deserialize, Serialize},
    snapshot_parser::stake_meta::StakeMetaCollection,
    std::collections::HashMap,
};

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct InsuranceClaim {
    pub withdraw_authority: String,
    pub stake_authority: String,
    pub vote_account: String,
    pub stake_accounts: HashMap<String, u64>,
    pub stake: u64,
    pub claim: u64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct InsuranceClaimCollection {
    pub epoch: u64,
    pub slot: u64,
    pub claims: Vec<InsuranceClaim>,
}

pub fn stake_authorities_filter(whitelist: HashSet<String>) -> Box<dyn Fn(&StakeMeta) -> bool> {
    Box::new(move |s| whitelist.contains(&s.stake_authority))
}

fn no_filter() -> Box<dyn Fn(&StakeMeta) -> bool> {
    Box::new(|_| true)
}

pub fn generate_insurance_claim_collection(
    stake_meta_collection: StakeMetaCollection,
    insured_event_collection: InsuredEventCollection,
    stake_meta_filter: Option<Box<dyn Fn(&StakeMeta) -> bool>>,
) -> InsuranceClaimCollection {
    assert_eq!(stake_meta_collection.epoch, insured_event_collection.epoch);
    assert_eq!(stake_meta_collection.slot, insured_event_collection.slot);

    let stake_meta_filter = stake_meta_filter.unwrap_or_else(|| no_filter());

    let filtered_stake_meta_iter = stake_meta_collection
        .stake_metas
        .into_iter()
        .filter(stake_meta_filter);

    let mut grouped_stake_meta: HashMap<(String, String, String), Vec<StakeMeta>> =
        Default::default();
    for stake_meta in filtered_stake_meta_iter {
        if stake_meta.active_delegation_lamports == 0 {
            continue;
        }
        if let Some(validator) = &stake_meta.validator {
            grouped_stake_meta
                .entry((
                    validator.clone(),
                    stake_meta.withdraw_authority.clone(),
                    stake_meta.stake_authority.clone(),
                ))
                .or_default()
                .push(stake_meta);
        }
    }

    let claims = grouped_stake_meta
        .into_iter()
        .flat_map(
            |((vote_account, withdraw_authority, stake_authority), stake_metas)| {
                let stake_accounts = stake_metas
                    .iter()
                    .map(|s| (s.pubkey.clone(), s.active_delegation_lamports))
                    .collect();

                let stake: u64 = stake_metas
                    .iter()
                    .map(|s| s.active_delegation_lamports)
                    .sum();

                let claim: Option<u64> = insured_event_collection
                    .events_by_validator(&vote_account)
                    .map(|events| events.iter().map(|e| e.claim_amount(stake)).sum());

                claim.map(|claim| InsuranceClaim {
                    withdraw_authority,
                    stake_authority,
                    vote_account,
                    stake_accounts,
                    stake,
                    claim,
                })
            },
        )
        .collect();

    InsuranceClaimCollection {
        epoch: insured_event_collection.epoch,
        slot: insured_event_collection.slot,
        claims,
    }
}
