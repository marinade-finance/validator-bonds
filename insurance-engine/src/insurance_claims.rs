#![allow(clippy::type_complexity)]
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;

use snapshot_parser::stake_meta::StakeMeta;

use {
    crate::insured_events::InsuredEventCollection,
    merkle_tree::serde_serialize::{map_pubkey_string_conversion, pubkey_string_conversion},
    serde::{Deserialize, Serialize},
    snapshot_parser::stake_meta::StakeMetaCollection,
    std::collections::HashMap,
};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct InsuranceClaim {
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    #[serde(with = "map_pubkey_string_conversion")]
    pub stake_accounts: HashMap<Pubkey, u64>,
    pub stake: u64,
    pub claim: u64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct InsuranceClaimCollection {
    pub epoch: u64,
    pub slot: u64,
    pub claims: Vec<InsuranceClaim>,
}

pub fn stake_authorities_filter(whitelist: HashSet<Pubkey>) -> Box<dyn Fn(&StakeMeta) -> bool> {
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

    let mut grouped_stake_meta: HashMap<(Pubkey, Pubkey, Pubkey), Vec<StakeMeta>> =
        Default::default();
    for stake_meta in filtered_stake_meta_iter {
        if stake_meta.active_delegation_lamports == 0 {
            continue;
        }
        if let Some(validator) = &stake_meta.validator {
            grouped_stake_meta
                .entry((
                    *validator,
                    stake_meta.withdraw_authority,
                    stake_meta.stake_authority,
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
                    .map(|s| (s.pubkey, s.active_delegation_lamports))
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
