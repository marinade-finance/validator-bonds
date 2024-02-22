#![allow(clippy::type_complexity)]
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;

use snapshot_parser::stake_meta::StakeMeta;

use {
    crate::insured_events::InsuredEventCollection,
    serde::{Deserialize, Serialize},
    snapshot_parser::stake_meta::StakeMetaCollection,
    std::collections::HashMap,
};

#[derive(Clone, Debug)]
pub struct InsuranceClaim {
    pub withdraw_authority: Pubkey,
    pub stake_authority: Pubkey,
    pub vote_account: Pubkey,
    pub stake_accounts: HashMap<Pubkey, u64>,
    pub stake: u64,
    pub claim: u64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
struct InsuranceClaimJson {
    pub withdraw_authority: Pubkey,
    pub stake_authority: Pubkey,
    pub vote_account: Pubkey,
    pub stake_accounts: HashMap<String, u64>,
    pub stake: u64,
    pub claim: u64,
}

impl Serialize for InsuranceClaim {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        InsuranceClaimJson::from(self.clone()).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for InsuranceClaim {
    fn deserialize<D>(deserializer: D) -> Result<InsuranceClaim, D::Error>
    where
        D: serde::de::Deserializer<'de>,
    {
        let iecj = InsuranceClaimJson::deserialize(deserializer)?;
        Ok(InsuranceClaim {
            withdraw_authority: iecj.withdraw_authority,
            stake_authority: iecj.stake_authority,
            vote_account: iecj.vote_account,
            stake_accounts: iecj
                .stake_accounts
                .into_iter()
                .map(|(k, v)| (k.parse().unwrap(), v))
                .collect(),
            stake: iecj.stake,
            claim: iecj.claim,
        })
    }
}

impl From<InsuranceClaim> for InsuranceClaimJson {
    fn from(iec: InsuranceClaim) -> Self {
        InsuranceClaimJson {
            withdraw_authority: iec.withdraw_authority,
            stake_authority: iec.stake_authority,
            vote_account: iec.vote_account,
            stake_accounts: iec
                .stake_accounts
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
            stake: iec.stake,
            claim: iec.claim,
        }
    }
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
