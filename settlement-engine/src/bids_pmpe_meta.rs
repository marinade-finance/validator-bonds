use solana_sdk::clock::Epoch;
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;
use {
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    std::fmt::Debug,
};

#[derive(Clone, Deserialize, Serialize, Debug, Eq, PartialEq)]
pub struct BidsPmpeMetaCollection {
    pub epoch: Epoch,
    pub slot: u64,
    pub bid_pmpe_metas: Vec<BidPmpeMeta>,
}

#[derive(Clone, Deserialize, Serialize, Debug, Eq, PartialEq)]
pub struct BidPmpeMeta {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    // cost per mille per epoch: what's expected to be paid to staker
    // the number in lamports that the validator "promised" to pay for staked 1000 SOLs
    pub expected_bid_pmpe: u64,
    // cost per mille per epoch in lamports: what's actually paid to staker
    pub actual_bid_pmpe: u64,
    // TODO: some metadata
    // pub inflation_rewards_pmpe: u64,
    // pub mev_rewards_pmpe: u64,
    // pub max_bid: u64,
    // pub effective_bid: u64,
}

impl BidsPmpeMetaCollection {
    /// calculates staker reward per one staked lamport for particular pmpe
    pub fn epr_calculator() -> impl Fn(u64) -> f64 {
        move |pmpe: u64| pmpe as f64 / 1000.0 / LAMPORTS_PER_SOL as f64
    }
}
