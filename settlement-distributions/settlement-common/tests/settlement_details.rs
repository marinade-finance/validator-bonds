use settlement_common::settlement_details::{
    BidSettlementDetails, BondRiskFeeDetails, SettlementDetails,
};

#[test]
fn bidding_variant_serializes_with_kind_tag_and_flattened_fields() {
    let details = SettlementDetails::Bidding(Box::new(BidSettlementDetails {
        total_active_stake: 100,
        total_marinade_active_stake: 60,
        total_marinade_redelegation_stake: 0,
        auction_effective_static_bid: "0.5".to_string(),
        marinade_stake_share: "0.6".to_string(),
        marinade_inflation_rewards: "1".to_string(),
        marinade_mev_rewards: "2".to_string(),
        marinade_block_rewards: "3".to_string(),
        staker_inflation_rewards: None,
        staker_mev_rewards: None,
        staker_block_rewards: None,
        staker_bid_rewards: None,
        total_marinade_stakers_rewards: "6".to_string(),
        settlement_claims: serde_json::json!({"activating_bid_claim": "9"}),
        stakers_total_claim: 6,
        marinade_fee_claim: 1,
        dao_fee_claim: 1,
    }));

    let value = serde_json::to_value(&details).unwrap();
    // Internal tag at the top level, struct fields flattened alongside it.
    assert_eq!(value["kind"], "Bidding");
    assert_eq!(value["total_active_stake"], 100);
    assert_eq!(value["settlement_claims"]["activating_bid_claim"], "9");
    // No extra nesting wrapper around the variant payload.
    assert!(value.get("Bidding").is_none());
}

#[test]
fn penalty_variant_round_trips() {
    let details = SettlementDetails::BondRiskFee(BondRiskFeeDetails {
        total_marinade_active_stake: 10,
        effective_sam_marinade_active_stake: 10,
        bond_risk_fee_sol: "0.1".to_string(),
        stakers_bond_risk_fee_claim: 5,
    });

    let json = serde_json::to_string(&details).unwrap();
    assert!(json.contains("\"kind\":\"BondRiskFee\""));
    let back: SettlementDetails = serde_json::from_str(&json).unwrap();
    match back {
        SettlementDetails::BondRiskFee(d) => {
            assert_eq!(d.stakers_bond_risk_fee_claim, 5)
        }
        other => panic!("expected BondRiskFee, got {other:?}"),
    }
}
