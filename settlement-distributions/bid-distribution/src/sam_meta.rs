use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use {
    merkle_tree::serde_serialize::pubkey_string_conversion,
    serde::{Deserialize, Serialize},
    std::fmt::Debug,
};

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tvl {
    pub(crate) marinade_sam_tvl_sol: Decimal,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SamMetadata {
    pub(crate) scoring_id: String,
    pub(crate) tvl: Tvl,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ValidatorSamMeta {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub marinade_sam_target_sol: Decimal,
    pub rev_share: RevShare,
    pub stake_priority: u32,
    pub unstake_priority: u32,
    pub max_stake_wanted: Decimal,
    // ds-scoring passes revShare.auctionEffectiveBid here as effective_bid
    pub effective_bid: Decimal,
    pub constraints: String,
    pub metadata: SamMetadata,
    pub scoring_run_id: u32,
    pub epoch: u32,
    pub values: Option<AuctionValidatorValues>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RevShare {
    pub total_pmpe: Decimal,
    pub inflation_pmpe: Decimal,
    pub mev_pmpe: Decimal,
    pub bid_pmpe: Decimal,
    pub auction_effective_bid_pmpe: Decimal,
    pub bid_too_low_penalty_pmpe: Decimal,
    pub blacklist_penalty_pmpe: Decimal,
    pub eff_participating_bid_pmpe: Decimal,
    pub expected_max_eff_bid_pmpe: Decimal,

    pub block_pmpe: Option<Decimal>,
    pub onchain_distributed_pmpe: Option<Decimal>,
    pub bond_obligation_pmpe: Option<Decimal>,
    pub auction_effective_static_bid_pmpe: Option<Decimal>,
    pub activating_stake_pmpe: Option<Decimal>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuctionValidatorValues {
    pub bond_balance_sol: Option<Decimal>,
    pub marinade_activated_stake_sol: Decimal,
    pub bond_risk_fee_sol: Decimal,
    pub paid_undelegation_sol: Decimal,
    pub sam_blacklisted: bool,
    pub commissions: Option<CommissionDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommissionDetails {
    pub inflation_commission_dec: Decimal,
    pub mev_commission_dec: Decimal,
    pub block_rewards_commission_dec: Decimal,
    pub inflation_commission_in_bond_dec: Option<Decimal>,
    pub inflation_commission_override_dec: Option<Decimal>,
    pub mev_commission_in_bond_dec: Option<Decimal>,
    pub mev_commission_override_dec: Option<Decimal>,
    pub block_rewards_commission_in_bond_dec: Option<Decimal>,
    pub block_rewards_commission_override_dec: Option<Decimal>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SamAuctionResult {
    pub auction_data: SamAuctionData,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SamAuctionData {
    pub epoch: u32,
    pub validators: Vec<SamAuctionValidator>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SamAuctionValidator {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub rev_share: RevShare,
    pub auction_stake: SamAuctionStake,
    pub max_stake_wanted: Option<Decimal>,
    pub stake_priority: u32,
    pub unstake_priority: u32,
    pub last_cap_constraint: Option<SamLastCapConstraint>,
    pub values: Option<AuctionValidatorValues>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SamAuctionStake {
    pub marinade_sam_target_sol: Decimal,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SamLastCapConstraint {
    pub constraint_type: String,
}

impl SamAuctionResult {
    pub fn into_validator_sam_metas(self) -> Vec<ValidatorSamMeta> {
        let epoch = self.auction_data.epoch;
        self.auction_data
            .validators
            .into_iter()
            .map(|v| {
                // mirrors ds-scoring's transformSAMRecord: effective_bid is revShare.auctionEffectiveBidPmpe
                let effective_bid = v.rev_share.auction_effective_bid_pmpe;
                ValidatorSamMeta {
                    vote_account: v.vote_account,
                    marinade_sam_target_sol: v.auction_stake.marinade_sam_target_sol,
                    rev_share: v.rev_share,
                    stake_priority: v.stake_priority,
                    unstake_priority: v.unstake_priority,
                    max_stake_wanted: v.max_stake_wanted.unwrap_or(Decimal::ZERO),
                    effective_bid,
                    constraints: v
                        .last_cap_constraint
                        .map(|c| c.constraint_type)
                        .unwrap_or_default(),
                    // scoring_run_id/metadata are scoring-API artifacts not present in results.json; unused by generators
                    metadata: SamMetadata::default(),
                    scoring_run_id: 0,
                    epoch,
                    values: v.values,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESULTS_JSON: &str = r#"{
      "winningTotalPmpe": 1.23,
      "auctionData": {
        "epoch": 977,
        "stakeAmounts": {},
        "blacklist": [],
        "validators": [
          {
            "voteAccount": "FuMxFv5RBN5Mwj7gXMSPVdvBxXR8Ki5kLZxjsGAjnAtv",
            "clientVersion": "2.0.0",
            "stakePriority": 3,
            "unstakePriority": 7,
            "maxStakeWanted": 1000.5,
            "auctionStake": { "externalActivatedSol": 76309.45, "marinadeSamTargetSol": 42.0 },
            "lastCapConstraint": { "constraintType": "BOND", "validators": 1 },
            "revShare": {
              "totalPmpe": 10.0, "inflationPmpe": 1.0, "mevPmpe": 2.0, "bidPmpe": 3.0,
              "auctionEffectiveBidPmpe": 9.5, "bidTooLowPenaltyPmpe": 0.0,
              "blacklistPenaltyPmpe": 0.0, "effParticipatingBidPmpe": 4.0,
              "expectedMaxEffBidPmpe": 5.0, "activatingStakePmpe": 0.5
            },
            "values": {
              "marinadeActivatedStakeSol": 100.0, "bondRiskFeeSol": 0.0,
              "paidUndelegationSol": 0.0, "samBlacklisted": false
            }
          },
          {
            "voteAccount": "9QU2QSxhb24FUX3Tu2FpczXjpK3VYrvRudywSZaM29mF",
            "stakePriority": 0,
            "unstakePriority": 0,
            "auctionStake": { "marinadeSamTargetSol": 0.0 },
            "revShare": {
              "totalPmpe": 0.0, "inflationPmpe": 0.0, "mevPmpe": 0.0, "bidPmpe": 0.0,
              "auctionEffectiveBidPmpe": 0.0, "bidTooLowPenaltyPmpe": 0.0,
              "blacklistPenaltyPmpe": 0.0, "effParticipatingBidPmpe": 0.0,
              "expectedMaxEffBidPmpe": 0.0
            }
          }
        ]
      }
    }"#;

    #[test]
    fn results_json_maps_into_validator_sam_metas() {
        let parsed: SamAuctionResult = serde_json::from_str(RESULTS_JSON).unwrap();
        let metas = parsed.into_validator_sam_metas();
        assert_eq!(metas.len(), 2);

        let first = &metas[0];
        assert_eq!(first.epoch, 977);
        assert_eq!(
            first.marinade_sam_target_sol,
            Decimal::try_from(42.0).unwrap()
        );
        assert_eq!(
            first.effective_bid,
            first.rev_share.auction_effective_bid_pmpe
        );
        assert_eq!(first.effective_bid, Decimal::try_from(9.5).unwrap());
        assert_eq!(first.stake_priority, 3);
        assert_eq!(first.unstake_priority, 7);
        assert_eq!(first.max_stake_wanted, Decimal::try_from(1000.5).unwrap());
        assert_eq!(first.constraints, "BOND");
        assert!(first.values.is_some());

        let second = &metas[1];
        assert_eq!(second.epoch, 977);
        assert_eq!(
            second.max_stake_wanted,
            Decimal::ZERO,
            "missing maxStakeWanted defaults to 0"
        );
        assert_eq!(
            second.constraints, "",
            "missing lastCapConstraint yields empty string"
        );
        assert!(second.values.is_none());
    }
}
