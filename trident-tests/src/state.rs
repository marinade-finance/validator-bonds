//! On-chain account layouts (decoded from raw data) and test-account builders.

use borsh::BorshDeserialize;
use solana_stake_interface::stake_flags::StakeFlags;
use solana_stake_interface::state::{Authorized, Delegation, Lockup, Meta, Stake, StakeStateV2};
use trident_fuzz::fuzzing::*;

use crate::ix::*;

#[derive(BorshDeserialize, Clone, Debug)]
pub struct Config {
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub epochs_to_claim_settlement: u64,
    pub withdraw_lockup_epochs: u64,
    pub minimum_stake_lamports: u64,
    pub bonds_withdrawer_authority_bump: u8,
    pub pause_authority: Pubkey,
    pub paused: bool,
    pub slots_to_start_settlement_claiming: u64,
    pub min_bond_max_stake_wanted: u64,
}

#[derive(BorshDeserialize, Clone, Debug)]
pub struct Bond {
    pub config: Pubkey,
    pub vote_account: Pubkey,
    pub authority: Pubkey,
    pub cpmpe: u64,
    pub bump: u8,
    pub max_stake_wanted: u64,
}

#[derive(BorshDeserialize, Clone, Debug)]
pub struct Settlement {
    pub bond: Pubkey,
    pub staker_authority: Pubkey,
    pub merkle_root: [u8; 32],
    pub max_total_claim: u64,
    pub max_merkle_nodes: u64,
    pub lamports_funded: u64,
    pub lamports_claimed: u64,
    pub merkle_nodes_claimed: u64,
    pub epoch_created_for: u64,
    pub slot_created_at: u64,
    pub rent_collector: Pubkey,
    pub split_rent_collector: Option<Pubkey>,
    pub split_rent_amount: u64,
}

#[derive(BorshDeserialize, Clone, Debug)]
pub struct SettlementClaimsHeader {
    pub settlement: Pubkey,
    pub version: u8,
    pub max_records: u64,
}

#[derive(BorshDeserialize, Clone, Debug)]
pub struct WithdrawRequest {
    pub vote_account: Pubkey,
    pub bond: Pubkey,
    pub epoch: u64,
    pub requested_amount: u64,
    pub withdrawn_amount: u64,
}

pub const CLAIMS_HEADER: usize = 56;

/// Decodes an Anchor account: 8-byte discriminator + borsh body (trailing bytes ignored).
pub fn decode<T: BorshDeserialize>(acc: &AccountSharedData) -> Option<T> {
    if acc.owner() != &PROGRAM_ID || acc.data().len() < 8 {
        return None;
    }
    T::deserialize(&mut &acc.data()[8..]).ok()
}

pub fn claims_bitmap_popcount(acc: &AccountSharedData) -> u64 {
    acc.data()
        .get(CLAIMS_HEADER..)
        .map(|b| b.iter().map(|x| x.count_ones() as u64).sum())
        .unwrap_or(0)
}

pub fn claims_is_set(acc: &AccountSharedData, index: u64) -> bool {
    acc.data()
        .get(CLAIMS_HEADER + (index / 8) as usize)
        .map(|b| b & (1 << (7 - (index % 8))) != 0)
        .unwrap_or(false)
}

// ---- stake ------------------------------------------------------------------

pub fn stake_rent() -> u64 {
    // 200-byte account, default rent (3480 lamports/byte-year * 2 years)
    (200 + 128) * 3480 * 2
}

pub fn decode_stake(acc: &AccountSharedData) -> Option<StakeStateV2> {
    if acc.owner() != &STAKE_PROGRAM {
        return None;
    }
    bincode::deserialize(acc.data()).ok()
}

pub fn stake_meta(acc: &AccountSharedData) -> Option<Meta> {
    match decode_stake(acc)? {
        StakeStateV2::Initialized(m) | StakeStateV2::Stake(m, _, _) => Some(m),
        _ => None,
    }
}

pub fn stake_delegation(acc: &AccountSharedData) -> Option<Delegation> {
    match decode_stake(acc)? {
        StakeStateV2::Stake(_, s, _) => Some(s.delegation),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Activation {
    /// Fully effective stake.
    Active,
    /// Activation epoch is the current epoch (no effective stake yet).
    Activating,
    /// Deactivation requested in the past (fully deactivated).
    Deactivated,
}

#[allow(clippy::too_many_arguments)]
pub fn make_stake(
    vote: Option<Pubkey>,
    staker: Pubkey,
    withdrawer: Pubkey,
    lockup: Lockup,
    delegated: u64,
    extra: u64,
    activation: Activation,
    epoch: u64,
) -> AccountSharedData {
    let rent = stake_rent();
    let meta = Meta {
        rent_exempt_reserve: rent,
        authorized: Authorized { staker, withdrawer },
        lockup,
    };
    let state = match vote {
        None => StakeStateV2::Initialized(meta),
        Some(v) => {
            let (act, deact) = match activation {
                Activation::Active => (epoch.saturating_sub(2), u64::MAX),
                Activation::Activating => (epoch, u64::MAX),
                Activation::Deactivated => (epoch.saturating_sub(3), epoch.saturating_sub(2)),
            };
            StakeStateV2::Stake(
                meta,
                Stake {
                    delegation: Delegation {
                        voter_pubkey: v,
                        stake: delegated,
                        activation_epoch: act,
                        deactivation_epoch: deact,
                        ..Delegation::default()
                    },
                    credits_observed: 0,
                },
                StakeFlags::empty(),
            )
        }
    };
    let mut data = vec![0u8; 200];
    bincode::serialize_into(&mut data[..], &state).unwrap();
    let lamports = rent + if vote.is_some() { delegated } else { 0 } + extra;
    let mut acc = AccountSharedData::new(lamports, 200, &STAKE_PROGRAM);
    acc.set_data_from_slice(&data);
    acc
}

// ---- vote -------------------------------------------------------------------

pub fn make_vote(identity: Pubkey, withdrawer: Pubkey) -> AccountSharedData {
    use solana_vote_interface::state::{VoteInit, VoteState, VoteStateVersions};
    let init = VoteInit {
        node_pubkey: identity,
        authorized_voter: identity,
        authorized_withdrawer: withdrawer,
        commission: 5,
    };
    let clock = solana_sdk::clock::Clock::default();
    let vs = VoteState::new(&init, &clock);
    let mut data = vec![0u8; VoteState::size_of()];
    bincode::serialize_into(&mut data[..], &VoteStateVersions::new_current(vs)).unwrap();
    let mut acc = AccountSharedData::new(10_000_000_000, data.len(), &VOTE_PROGRAM);
    acc.set_data_from_slice(&data);
    acc
}

// ---- marinade liquid fixtures ------------------------------------------------

/// Loads a `solana account -o json` fixture (base64 or base64+zstd).
pub fn load_fixture(json: &str) -> (Pubkey, AccountSharedData) {
    use base64::Engine;
    use std::io::Read;
    let v: serde_json::Value = serde_json::from_str(json).unwrap();
    let key: Pubkey = v["pubkey"].as_str().unwrap().parse().unwrap();
    let a = &v["account"];
    let raw = base64::engine::general_purpose::STANDARD
        .decode(a["data"][0].as_str().unwrap())
        .unwrap();
    let data = if a["data"][1].as_str() == Some("base64+zstd") {
        let mut out = Vec::new();
        ruzstd::StreamingDecoder::new(&raw[..])
            .unwrap()
            .read_to_end(&mut out)
            .unwrap();
        out
    } else {
        raw
    };
    let owner: Pubkey = a["owner"].as_str().unwrap().parse().unwrap();
    let mut acc = AccountSharedData::new(a["lamports"].as_u64().unwrap(), data.len(), &owner);
    acc.set_data_from_slice(&data);
    (key, acc)
}

/// Records of the Marinade liquid stake list (first 32 bytes of every item).
pub fn stake_list_members(state: &AccountSharedData, list: &AccountSharedData) -> Vec<Pubkey> {
    let sd = state.data();
    let item = u32::from_le_bytes(sd[182..186].try_into().unwrap()) as usize;
    let count = u32::from_le_bytes(sd[186..190].try_into().unwrap()) as usize;
    (0..count)
        .map(|i| {
            Pubkey::new_from_array(
                list.data()[8 + i * item..8 + i * item + 32]
                    .try_into()
                    .unwrap(),
            )
        })
        .collect()
}
