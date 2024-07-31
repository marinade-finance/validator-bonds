use solana_sdk::clock::Epoch;
use solana_sdk::pubkey::Pubkey;

use {
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    std::fmt::Debug,
};

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RevenueExpectationMetaCollection {
    pub epoch: Epoch,
    pub slot: u64,
    pub revenue_expectations: Vec<RevenueExpectationMeta>,
}

// TODO: should not be used bigdecimal instead of f64?
/// A struct that represents the expected and actual revenue for a staker.
/// PMPE stands for "cost per mille per epoch"
/// which is a number of lamports to be paid for staked 1000 SOLs
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RevenueExpectationMeta {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    /// changes in inflation and MEV commissions
    pub expected_inflation_commission: f64,
    pub actual_inflation_commission: f64,
    pub expected_mev_commission: Option<f64>,
    pub actual_mev_commission: Option<f64>,
    /// expected PMPE in SOLs for part of stake that is not part of SAM (e.g., MNDE part, (calculated from `1-samStakeShare`)
    /// how many SOLs was expected to be paid by validator for get stake of 1000 SOLs
    pub expected_non_bid_pmpe: f64,
    pub actual_non_bid_pmpe: f64,
    /// expected PMPE in SOLs for part of stake that is part of SAM (calculated from `samStakeShare`)
    pub expected_sam_pmpe: f64,
    /// max sam stake in SOLs
    pub max_sam_stake: Option<f64>,
    /// in bps; used to find what part of the stake is part of SAM
    pub sam_stake_share: f64,
    /// loss of lamports per 1 SOL for commission change
    pub loss_per_stake: f64,
}

impl RevenueExpectationMeta {
    /// Sanityt check if calculation on Non bid pmpe fits loss per stake data
    pub fn check_commission_loss_per_stake(&self) {
        let loss_per_stake =
            ((self.expected_non_bid_pmpe - self.actual_non_bid_pmpe) / 1000.0).max(0.0);
        assert_eq!(loss_per_stake, self.loss_per_stake);
    }
}
