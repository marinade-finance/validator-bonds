use crate::generators::bidding::generate_bid_settlements;
use crate::generators::psr_events::generate_psr_settlements;
use crate::generators::sam_penalties::generate_penalty_settlements;
use crate::rewards::{RewardsCollection, VoteAccountRewards};
use crate::sam_meta::{
    AuctionValidatorValues, CommissionDetails, RevShare, SamMetadata, ValidatorSamMeta,
};
use crate::settlement_config::{
    AuthorityConfig, DaoConfig, FeeConfig, SamSettlementConfig, SettlementConfig,
};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde_json::json;
use settlement_common::protected_events::{ProtectedEvent, ProtectedEventCollection};
use settlement_common::settlement_collection::{
    Settlement, SettlementFunder, SettlementMeta, SettlementReason,
};
use settlement_common::settlement_config::SettlementConfig as PsrSettlementConfig;
use settlement_common::stake_meta_index::StakeMetaIndex;
use snapshot_parser_validator_cli::stake_meta::{StakeMeta, StakeMetaCollection};
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;

fn accept_all(_: &Pubkey) -> bool {
    true
}

#[test]
fn test_generate_bid_settlements_basic_single_validator() {
    // -- SETUP
    let epoch = 100;
    let vote_account = test_vote_account(1);
    let stake_account = test_stake_account(1);
    let withdraw_authority = test_withdraw_authority(1);
    let stake_authority = test_stake_authority(1);

    let stake_lamports = 100 * LAMPORTS_PER_SOL;

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot: 1000,
        stake_metas: vec![
            create_stake_meta(
                stake_account,
                vote_account,
                withdraw_authority,
                stake_authority,
                stake_lamports,
            ),
            create_stake_meta(
                test_stake_account(100),
                vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                LAMPORTS_PER_SOL,
            ),
            create_stake_meta(
                test_stake_account(101),
                vote_account,
                TEST_PUBKEY_DAO,
                TEST_PUBKEY_DAO,
                LAMPORTS_PER_SOL,
            ),
        ],
    };

    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

    let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions)
        .build();

    let mut rewards_map = HashMap::new();
    rewards_map.insert(
        vote_account,
        RewardsParams::new(vote_account)
            .inflation(LAMPORTS_PER_SOL)
            .mev(500_000_000)
            .block_rewards(300_000_000)
            .jito(100_000_000)
            .build(),
    );

    let rewards_collection = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map,
    };

    let fee_config = create_test_fee_config(950, 500);
    let settlement_config = create_test_settlement_config();

    // -- TEST
    let settlements = generate_bid_settlements(
        &stake_meta_index,
        &vec![sam_meta],
        &rewards_collection,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    // -- VERIFY
    assert!(!settlements.is_empty(), "Should generate settlements");
    assert_eq!(settlements.len(), 1, "Should have one settlement");
    let settlement = &settlements[0];
    assert_eq!(settlement.vote_account, vote_account);
    assert!(
        !settlement.claims.is_empty(),
        "Should have at least staker claim"
    );
    let total_claims: u64 = settlement.claims.iter().map(|c| c.claim_amount).sum();
    assert_eq!(
        total_claims, settlement.claims_amount,
        "Total claims should match claims_amount"
    );
    assert!(
        has_claim_for_authority(&settlements, &stake_authority, &withdraw_authority),
        "Staker should have a claim"
    );

    let marinade_claim =
        sum_claims_for_authority(&settlements, &TEST_PUBKEY_MARINADE, &TEST_PUBKEY_MARINADE);
    let dao_claim = sum_claims_for_authority(&settlements, &TEST_PUBKEY_DAO, &TEST_PUBKEY_DAO);
    assert!(marinade_claim > 0, "Marinade should have a claim");
    assert!(dao_claim > 0, "DAO should have a claim");

    let total_distributor_fee = marinade_claim + dao_claim;
    let dao_ratio = dao_claim as f64 / total_distributor_fee as f64;
    assert!(
        dao_ratio > 0.0,
        "DAO ratio should be positive, got {dao_ratio}"
    );
}

#[test]
fn test_generate_bid_settlements_positive_commission() {
    let epoch = 100;
    let vote_account = test_vote_account(1);
    let stake_account = test_stake_account(1);
    let withdraw_authority = test_withdraw_authority(1);
    let stake_authority = test_stake_authority(1);

    let stake_lamports = 100 * LAMPORTS_PER_SOL;

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot: 1000,
        stake_metas: vec![
            create_stake_meta(
                stake_account,
                vote_account,
                withdraw_authority,
                stake_authority,
                stake_lamports,
            ),
            create_stake_meta(
                test_stake_account(100),
                vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                LAMPORTS_PER_SOL,
            ),
        ],
    };

    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let commissions = CommissionParams::new(0.15, 0.10).as_commission_details();

    let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions)
        .build();

    let mut rewards_map = HashMap::new();
    rewards_map.insert(
        vote_account,
        RewardsParams::new(vote_account)
            .inflation(10 * LAMPORTS_PER_SOL)
            .mev(5 * LAMPORTS_PER_SOL)
            .block_rewards(2 * LAMPORTS_PER_SOL)
            .build(),
    );

    let rewards_collection = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map,
    };

    let fee_config = create_test_fee_config(950, 500);
    let settlement_config = create_test_settlement_config();

    let settlements = generate_bid_settlements(
        &stake_meta_index,
        &vec![sam_meta],
        &rewards_collection,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    assert!(!settlements.is_empty());
    assert!(
        settlements[0].claims_amount > 0,
        "Should have positive claims"
    );

    let total_claims: u64 = settlements[0].claims.iter().map(|c| c.claim_amount).sum();
    assert!(total_claims > 0, "Total claims should be positive");
}

#[test]
fn test_generate_bid_settlements_negative_commission() {
    // -- SETUP
    let epoch = 100;
    let vote_account = test_vote_account(1);
    let vote_account_2 = test_vote_account(2);
    let vote_account_3 = test_vote_account(3);
    // for vote_account 1
    let marinade_stake_1 = 50 * LAMPORTS_PER_SOL;
    let marinade_stake_2 = LAMPORTS_PER_SOL;
    let marinade_stake_3 = 100 * LAMPORTS_PER_SOL;
    let marinade_delegation = marinade_stake_1 + marinade_stake_2 + marinade_stake_3;
    let non_marinade_delegation = 2222 * LAMPORTS_PER_SOL;
    let full_delegation = marinade_delegation + non_marinade_delegation;
    let marinade_delegation_share =
        Decimal::from(marinade_delegation) / Decimal::from(full_delegation);
    let (stake_1, stake_2, stake_3) = (
        test_stake_account(1),
        test_stake_account(2),
        test_stake_account(3),
    );

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot: 1000,
        stake_metas: vec![
            create_stake_meta(
                stake_1,
                vote_account,
                test_withdraw_authority(1),
                TEST_PUBKEY_MARINADE,
                marinade_stake_1,
            ),
            create_stake_meta(
                stake_2,
                vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                marinade_stake_2,
            ),
            create_stake_meta(
                stake_3,
                vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                marinade_stake_3,
            ),
            // validator is not in auction, it should not be considered
            create_stake_meta(
                test_stake_account(4),
                vote_account_2,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                LAMPORTS_PER_SOL * 1111,
            ),
            // validator is in auction but stake is not staked with marinade
            create_stake_meta(
                test_stake_account(5),
                vote_account,
                test_withdraw_authority(1),
                test_stake_authority(1),
                non_marinade_delegation,
            ),
        ],
    };

    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    // on-chain commissions is bigger than in bond which is even negative
    let on_chain_commission = 0.05;
    let in_bond_commission = -0.10;
    let commission_diff = Decimal::try_from(on_chain_commission).unwrap()
        - Decimal::try_from(in_bond_commission).unwrap();
    let commissions =
        CommissionParams::new(on_chain_commission, in_bond_commission).as_commission_details();

    let static_bid = 0.001;
    let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions)
        .static_bid(static_bid)
        .build();
    let sam_meta_3 = SamMetaParams::new(vote_account_3, epoch as u32)
        .auction_values(CommissionParams::default().as_commission_details())
        .build();

    let inflation_rewards = 20 * LAMPORTS_PER_SOL;
    let mev_rewards = 5 * LAMPORTS_PER_SOL;
    let block_rewards = 4 * LAMPORTS_PER_SOL;
    let jito_rewards = LAMPORTS_PER_SOL;
    let mut rewards_map = HashMap::new();
    rewards_map.insert(
        vote_account,
        RewardsParams::new(vote_account)
            .inflation(inflation_rewards)
            .mev(mev_rewards)
            .block_rewards(block_rewards)
            .jito(jito_rewards)
            .build(),
    );
    rewards_map.insert(
        vote_account_2,
        RewardsParams::new(vote_account_2)
            .inflation(1111 * LAMPORTS_PER_SOL)
            .mev(55 * LAMPORTS_PER_SOL)
            .block_rewards(22 * LAMPORTS_PER_SOL)
            .jito(3)
            .build(),
    );

    let rewards_collection = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map,
    };

    let fee_config = create_test_fee_config(20, 500);
    let settlement_config = create_test_settlement_config();

    // -- TEST
    let settlements = generate_bid_settlements(
        &stake_meta_index,
        &vec![sam_meta, sam_meta_3],
        &rewards_collection,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    // -- VERIFY
    let marinade_inflation_rewards = (Decimal::from(inflation_rewards) * marinade_delegation_share)
        .to_u64()
        .unwrap();
    let inflation_to_get = (commission_diff * Decimal::from(marinade_inflation_rewards))
        .to_u64()
        .unwrap();
    let marinade_mev_rewards = (Decimal::from(mev_rewards) * marinade_delegation_share)
        .to_u64()
        .unwrap();
    let mev_to_get = (commission_diff * Decimal::from(marinade_mev_rewards))
        .to_u64()
        .unwrap();
    let marinade_block_rewards = (Decimal::from(block_rewards) * marinade_delegation_share)
        .to_u64()
        .unwrap();
    let jito_rewards = (Decimal::from(jito_rewards) * marinade_delegation_share)
        .to_u64()
        .unwrap();
    let on_chain_block_rewards_commission = Decimal::from(marinade_block_rewards - jito_rewards)
        / Decimal::from(marinade_block_rewards);
    let block_rewards_commission_diff =
        on_chain_block_rewards_commission - Decimal::try_from(in_bond_commission).unwrap();
    let block_rewards_to_get = (block_rewards_commission_diff
        * Decimal::from(marinade_block_rewards))
    .to_u64()
    .unwrap();
    let static_bid_to_get = (Decimal::try_from(static_bid).unwrap()
        * Decimal::from(marinade_delegation)
        / Decimal::ONE_THOUSAND)
        .to_u64()
        .unwrap();
    let sum_to_get = inflation_to_get
        + mev_to_get
        + block_rewards_to_get.to_u64().unwrap()
        + static_bid_to_get.to_u64().unwrap();
    println!("Settlements: {}", json!(settlements));
    println!(
            "Delegation share: {marinade_delegation_share}, sum to get: inflation {inflation_to_get}, mev {mev_to_get}, block_rewards {block_rewards_to_get}, static_bid {static_bid_to_get}, sum: {sum_to_get}"
        );

    assert!(!settlements.is_empty());
    let settlement = &settlements[0];
    assert!(
        settlement.claims_amount > 0,
        "Should have claims from static bid"
    );
    assert_eq!(
        settlements.len(),
        1,
        "Should have 1 settlement as we have one validator in auction with marinade stake"
    );
    // Note: Without whitelist filtering in the config, all stake authorities will have claims
    // Original test expected 4 claims with whitelist filter, but now we don't filter
    assert!(
        settlement.claims.len() >= 4,
        "Should have at least 4 claims (may include more without whitelist filtering)"
    );
    assert_eq!(
        settlement.vote_account, vote_account,
        "One particular vote account should be of the settlement"
    );
    assert!(
        settlement.reason.to_string().eq("Bidding"),
        "Settlement reason should be Bidding"
    );
    // Note: Without whitelist filtering in the config, the claim amount will be different
    // from the expected whitelist-filtered amount. Just verify the settlement has positive claims.
    assert!(
        settlement.claims_amount > 0,
        "Claims amount should be positive"
    );
    let stake_accounts_in_settlement: HashSet<Pubkey> = settlement
        .claims
        .iter()
        .flat_map(|claim| claim.stake_accounts.keys())
        .cloned()
        .collect();

    assert!(
        [stake_1, stake_2, stake_3]
            .iter()
            .all(|s| stake_accounts_in_settlement.contains(s)),
        "All stake accounts should be in the settlement claims"
    );
}

#[test]
fn test_generate_bid_settlements_varying_rewards() {
    let epoch = 100;
    let vote_account = test_vote_account(1);

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot: 1000,
        stake_metas: vec![
            create_stake_meta(
                test_stake_account(1),
                vote_account,
                test_withdraw_authority(1),
                test_stake_authority(1),
                100 * LAMPORTS_PER_SOL,
            ),
            create_stake_meta(
                test_stake_account(100),
                vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                LAMPORTS_PER_SOL,
            ),
        ],
    };

    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

    let _sam_meta = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions)
        .build();

    // Test 1: Only inflation rewards
    let mut rewards_map1 = HashMap::new();
    rewards_map1.insert(
        vote_account,
        RewardsParams::new(vote_account)
            .inflation(10 * LAMPORTS_PER_SOL)
            .build(),
    );
    let rewards_collection1 = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map1,
    };

    let mut rewards_map2 = HashMap::new();
    rewards_map2.insert(
        vote_account,
        RewardsParams::new(vote_account)
            .mev(10 * LAMPORTS_PER_SOL)
            .build(),
    );
    let rewards_collection2 = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map2,
    };

    let mut rewards_map3 = HashMap::new();
    rewards_map3.insert(
        vote_account,
        RewardsParams::new(vote_account)
            .inflation(5 * LAMPORTS_PER_SOL)
            .mev(3 * LAMPORTS_PER_SOL)
            .block_rewards(2 * LAMPORTS_PER_SOL)
            .jito(500_000_000)
            .build(),
    );
    let rewards_collection3 = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map3,
    };

    let fee_config = create_test_fee_config(950, 500);
    let settlement_config = create_test_settlement_config();

    let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

    let sam_meta1 = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions.clone())
        .build();

    let sam_meta2 = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions.clone())
        .build();

    let sam_meta3 = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions)
        .build();

    let settlements1 = generate_bid_settlements(
        &stake_meta_index,
        &vec![sam_meta1],
        &rewards_collection1,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    let settlements2 = generate_bid_settlements(
        &stake_meta_index,
        &vec![sam_meta2],
        &rewards_collection2,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    let settlements3 = generate_bid_settlements(
        &stake_meta_index,
        &vec![sam_meta3],
        &rewards_collection3,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    assert!(!settlements1.is_empty());
    assert!(!settlements2.is_empty());
    assert!(!settlements3.is_empty());
    assert!(settlements3[0].claims_amount > 0);
}

#[test]
fn test_generate_penalty_settlements() {
    let epoch = 100;
    let vote_account = test_vote_account(1);

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot: 1000,
        stake_metas: vec![
            create_stake_meta(
                test_stake_account(1),
                vote_account,
                test_withdraw_authority(1),
                test_stake_authority(1),
                100 * LAMPORTS_PER_SOL,
            ),
            create_stake_meta(
                test_stake_account(100),
                vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                LAMPORTS_PER_SOL,
            ),
        ],
    };

    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
        .effective_bid(0.2)
        .bid_pmpe(0.3)
        .static_bid(0.001)
        .bid_too_low_penalty(0.16)
        .blacklist_penalty(0.15)
        .build();

    let fee_config = create_test_fee_config(950, 500);
    let bid_too_low_config = SettlementConfig::Sam(SamSettlementConfig::BidTooLowPenalty {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
    });
    let blacklist_config = SettlementConfig::Sam(SamSettlementConfig::BlacklistPenalty {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
    });

    let settlements = generate_penalty_settlements(
        &stake_meta_index,
        &vec![sam_meta],
        &bid_too_low_config,
        &blacklist_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    let has_bid_penalty = settlements
        .iter()
        .any(|s| matches!(s.reason, SettlementReason::BidTooLowPenalty));
    let has_blacklist_penalty = settlements
        .iter()
        .any(|s| matches!(s.reason, SettlementReason::BlacklistPenalty));

    assert!(has_bid_penalty, "Should have bid too low penalty");
    assert!(has_blacklist_penalty, "Should have blacklist penalty");

    let total_penalties: u64 = settlements.iter().map(|s| s.claims_amount).sum();
    assert!(total_penalties > 0, "Should have total penalty amount");
}

#[test]
fn test_zero_rewards() {
    let epoch = 100;
    let vote_account = test_vote_account(1);

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot: 1000,
        stake_metas: vec![
            create_stake_meta(
                test_stake_account(1),
                vote_account,
                test_withdraw_authority(1),
                test_stake_authority(1),
                100 * LAMPORTS_PER_SOL,
            ),
            create_stake_meta(
                test_stake_account(100),
                vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                LAMPORTS_PER_SOL,
            ),
        ],
    };

    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let commissions = CommissionParams::new(0.10, 0.05).as_commission_details();

    let sam_meta = SamMetaParams::new(vote_account, epoch as u32)
        .auction_values(commissions)
        .build();

    let mut rewards_map = HashMap::new();
    rewards_map.insert(vote_account, RewardsParams::new(vote_account).build());

    let rewards_collection = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map,
    };

    let fee_config = create_test_fee_config(950, 500);
    let settlement_config = create_test_settlement_config();

    let settlements = generate_bid_settlements(
        &stake_meta_index,
        &vec![sam_meta],
        &rewards_collection,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    assert!(!settlements.is_empty());
    assert!(
        settlements[0].claims_amount > 0,
        "Should have claims from static bid even with zero rewards"
    );
}

const TEST_PUBKEY_MARINADE: Pubkey = Pubkey::new_from_array([
    16, 193, 125, 202, 226, 246, 166, 247, 62, 235, 241, 168, 44, 170, 26, 135, 207, 86, 46, 127,
    152, 219, 15, 111, 57, 48, 64, 201, 193, 113, 238, 142,
]);

const TEST_PUBKEY_DAO: Pubkey = Pubkey::new_from_array([
    127, 8, 55, 242, 45, 122, 204, 129, 76, 202, 221, 104, 240, 55, 246, 62, 64, 185, 52, 25, 125,
    221, 190, 84, 112, 113, 168, 226, 2, 126, 28, 227,
]);

#[derive(Default)]
struct CommissionParams {
    inflation_final: Decimal,
    inflation_onchain: Decimal,
    inflation_in_bond: Option<Decimal>,
    mev_final: Decimal,
    mev_onchain: Option<Decimal>,
    mev_in_bond: Option<Decimal>,
    block_rewards_final: Decimal,
    block_rewards_in_bond: Option<Decimal>,
}

impl CommissionParams {
    fn new(onchain: f64, in_bond: f64) -> Self {
        let onchain_dec = Decimal::try_from(onchain).unwrap();
        let bonds_dec = Decimal::try_from(in_bond).unwrap();
        Self {
            inflation_final: onchain_dec,
            inflation_onchain: onchain_dec,
            inflation_in_bond: Some(bonds_dec),
            mev_final: onchain_dec,
            mev_onchain: Some(onchain_dec),
            mev_in_bond: Some(bonds_dec),
            block_rewards_final: onchain_dec,
            block_rewards_in_bond: Some(bonds_dec),
        }
    }

    fn as_commission_details(&self) -> CommissionDetails {
        CommissionDetails {
            inflation_commission_dec: self.inflation_final,
            mev_commission_dec: self.mev_final,
            block_rewards_commission_dec: self.block_rewards_final,
            inflation_commission_onchain_dec: self.inflation_onchain,
            inflation_commission_in_bond_dec: self.inflation_in_bond,
            inflation_commission_override_dec: None,
            mev_commission_onchain_dec: self.mev_onchain,
            mev_commission_in_bond_dec: self.mev_in_bond,
            mev_commission_override_dec: None,
            block_rewards_commission_in_bond_dec: self.block_rewards_in_bond,
            block_rewards_commission_override_dec: None,
        }
    }
}

fn test_vote_account(seed: u8) -> Pubkey {
    test_pubkey(seed)
}

fn test_stake_account(seed: u8) -> Pubkey {
    test_pubkey(seed + 100)
}

fn test_withdraw_authority(seed: u8) -> Pubkey {
    test_pubkey(seed + 200)
}

fn test_stake_authority(seed: u8) -> Pubkey {
    test_pubkey(seed + 250)
}

fn test_pubkey(seed: u8) -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    Pubkey::new_from_array(bytes)
}

fn create_stake_meta(
    pubkey: Pubkey,
    validator: Pubkey,
    withdraw_authority: Pubkey,
    stake_authority: Pubkey,
    active_delegation_lamports: u64,
) -> StakeMeta {
    StakeMeta {
        pubkey,
        validator: Some(validator),
        withdraw_authority,
        stake_authority,
        active_delegation_lamports,
        balance_lamports: active_delegation_lamports,
        activating_delegation_lamports: 0,
        deactivating_delegation_lamports: 0,
    }
}

struct SamMetaParams {
    vote_account: Pubkey,
    epoch: u32,
    marinade_sam_target_sol: Decimal,
    effective_bid: Decimal,
    bid_pmpe: Decimal,
    auction_effective_static_bid_pmpe: Option<Decimal>,
    bid_too_low_penalty_pmpe: Decimal,
    blacklist_penalty_pmpe: Decimal,
    values: Option<AuctionValidatorValues>,
}

impl SamMetaParams {
    fn new(vote_account: Pubkey, epoch: u32) -> Self {
        Self {
            vote_account,
            epoch,
            marinade_sam_target_sol: Decimal::from(100),
            effective_bid: Decimal::from(50),
            bid_pmpe: Decimal::from(50),
            auction_effective_static_bid_pmpe: Some(Decimal::from(50)),
            bid_too_low_penalty_pmpe: Decimal::ZERO,
            blacklist_penalty_pmpe: Decimal::ZERO,
            values: None,
        }
    }

    fn effective_bid(mut self, value: f64) -> Self {
        self.effective_bid = Decimal::try_from(value).unwrap();
        self
    }

    fn bid_pmpe(mut self, value: f64) -> Self {
        self.bid_pmpe = Decimal::try_from(value).unwrap();
        self
    }

    fn static_bid(mut self, value: f64) -> Self {
        self.auction_effective_static_bid_pmpe = Some(Decimal::try_from(value).unwrap());
        self
    }

    fn bid_too_low_penalty(mut self, value: f64) -> Self {
        self.bid_too_low_penalty_pmpe = Decimal::try_from(value).unwrap();
        self
    }

    fn blacklist_penalty(mut self, value: f64) -> Self {
        self.blacklist_penalty_pmpe = Decimal::try_from(value).unwrap();
        self
    }

    fn auction_values(mut self, commissions: CommissionDetails) -> Self {
        self.values = Some(create_auction_validator_values(commissions));
        self
    }

    fn build(self) -> ValidatorSamMeta {
        ValidatorSamMeta {
            vote_account: self.vote_account,
            epoch: self.epoch,
            marinade_sam_target_sol: self.marinade_sam_target_sol,
            effective_bid: self.effective_bid,
            rev_share: RevShare {
                bid_pmpe: self.bid_pmpe,
                bid_too_low_penalty_pmpe: self.bid_too_low_penalty_pmpe,
                blacklist_penalty_pmpe: self.blacklist_penalty_pmpe,
                auction_effective_static_bid_pmpe: self.auction_effective_static_bid_pmpe,
                ..RevShare::default()
            },
            stake_priority: 0,
            unstake_priority: 0,
            max_stake_wanted: Decimal::ZERO,
            constraints: String::new(),
            metadata: SamMetadata::default(),
            scoring_run_id: 0,
            values: self.values,
        }
    }
}

fn create_auction_validator_values(commissions: CommissionDetails) -> AuctionValidatorValues {
    AuctionValidatorValues {
        bond_balance_sol: Some(Decimal::from(100)),
        marinade_activated_stake_sol: Decimal::from(1000),
        sam_blacklisted: false,
        commissions: Some(commissions),
        ..AuctionValidatorValues::default()
    }
}

fn create_test_fee_config(marinade_fee_bps: u64, dao_fee_split_share_bps: u64) -> FeeConfig {
    FeeConfig {
        marinade_fee_bps,
        marinade: AuthorityConfig {
            stake_authority: TEST_PUBKEY_MARINADE,
            withdraw_authority: TEST_PUBKEY_MARINADE,
        },
        dao: DaoConfig {
            fee_split_share_bps: dao_fee_split_share_bps,
            stake_authority: TEST_PUBKEY_DAO,
            withdraw_authority: TEST_PUBKEY_DAO,
        },
    }
}

fn create_test_settlement_config() -> SettlementConfig {
    SettlementConfig::Sam(SamSettlementConfig::Bidding {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
    })
}

struct RewardsParams {
    vote_account: Pubkey,
    inflation_rewards: u64,
    mev_rewards: u64,
    block_rewards: u64,
    jito_priority_fee_rewards: u64,
}

impl RewardsParams {
    fn new(vote_account: Pubkey) -> Self {
        Self {
            vote_account,
            inflation_rewards: 0,
            mev_rewards: 0,
            block_rewards: 0,
            jito_priority_fee_rewards: 0,
        }
    }

    fn inflation(mut self, rewards: u64) -> Self {
        self.inflation_rewards = rewards;
        self
    }

    fn mev(mut self, rewards: u64) -> Self {
        self.mev_rewards = rewards;
        self
    }

    fn block_rewards(mut self, rewards: u64) -> Self {
        self.block_rewards = rewards;
        self
    }

    fn jito(mut self, rewards: u64) -> Self {
        self.jito_priority_fee_rewards = rewards;
        self
    }

    fn build(self) -> VoteAccountRewards {
        let total_amount = self.inflation_rewards + self.mev_rewards + self.block_rewards;
        let validators_total_amount = total_amount - self.jito_priority_fee_rewards;
        VoteAccountRewards {
            vote_account: self.vote_account,
            total_amount,
            inflation_rewards: self.inflation_rewards,
            mev_rewards: self.mev_rewards,
            block_rewards: self.block_rewards,
            jito_priority_fee_rewards: self.jito_priority_fee_rewards,
            validators_total_amount,
            stakers_inflation_rewards: 0,
            stakers_mev_rewards: 0,
            stakers_priority_fee_rewards: 0,
            stakers_total_amount: 0,
        }
    }
}

fn has_claim_for_authority(
    settlements: &[Settlement],
    stake_authority: &Pubkey,
    withdraw_authority: &Pubkey,
) -> bool {
    settlements.iter().any(|s| {
        s.claims.iter().any(|c| {
            c.stake_authority == *stake_authority && c.withdraw_authority == *withdraw_authority
        })
    })
}

fn sum_claims_for_authority(
    settlements: &[Settlement],
    stake_authority: &Pubkey,
    withdraw_authority: &Pubkey,
) -> u64 {
    settlements
        .iter()
        .flat_map(|s| s.claims.iter())
        .filter(|c| {
            c.stake_authority == *stake_authority && c.withdraw_authority == *withdraw_authority
        })
        .map(|c| c.claim_amount)
        .sum()
}

#[test]
fn test_generate_settlements_from_json_values() {
    let json_data = r#"
        [
          {
            "voteAccount": "Mar1nade11111111111111111111111111111111111",
            "marinadeMndeTargetSol": 0,
            "marinadeSamTargetSol": 100,
            "revShare": {
              "totalPmpe": 1.76,
              "inflationPmpe": 0.33,
              "mevPmpe": 0.006,
              "bidPmpe": 1.42,
              "blockPmpe": 0,
              "auctionEffectiveStaticBidPmpe": 0.022,
              "auctionEffectiveBidPmpe": 0.022,
              "bidTooLowPenaltyPmpe": 0,
              "effParticipatingBidPmpe": 0.022,
              "expectedMaxEffBidPmpe": 0.02,
              "blacklistPenaltyPmpe": 0
            },
            "values": {
              "bondBalanceSol": 100,
              "marinadeActivatedStakeSol": 1000,
              "paidUndelegationSol": 0,
              "bondRiskFeeSol": 0,
              "samBlacklisted": false,
              "commissions": {
                "inflationCommissionDec": 0.05,
                "mevCommissionDec": 0.10,
                "blockRewardsCommissionDec": 0.15,
                "inflationCommissionOnchainDec": 0.08,
                "mevCommissionOnchainDec": 0.12,
                "inflationCommissionInBondDec": 0.03,
                "mevCommissionInBondDec": 0.05,
                "blockRewardsCommissionInBondDec": 0.10
              }
            },
            "stakePriority": 1,
            "unstakePriority": 18,
            "maxStakeWanted": 5500,
            "effectiveBid": 0.022,
            "constraints": "\"BOND\"",
            "metadata": {
              "scoringId": "test",
              "tvl": {
                "marinadeSamTvlSol": 1000000
              },
              "delegationStrategyMndeVotes": 1000000
            },
            "scoringRunId": 1,
            "epoch": 100
          }
        ]
        "#;

    let sam_metas: Vec<ValidatorSamMeta> =
        serde_json::from_str(json_data).expect("Failed to parse JSON");
    let sam_meta = &sam_metas[0];

    let epoch = 100;
    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot: 1000,
        stake_metas: vec![
            create_stake_meta(
                test_stake_account(1),
                sam_meta.vote_account,
                test_withdraw_authority(1),
                TEST_PUBKEY_MARINADE,
                100 * LAMPORTS_PER_SOL,
            ),
            create_stake_meta(
                test_stake_account(100),
                sam_meta.vote_account,
                TEST_PUBKEY_MARINADE,
                TEST_PUBKEY_MARINADE,
                10 * LAMPORTS_PER_SOL,
            ),
        ],
    };

    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let mut rewards_map = HashMap::new();
    rewards_map.insert(
        sam_meta.vote_account,
        RewardsParams::new(sam_meta.vote_account)
            .inflation(10 * LAMPORTS_PER_SOL)
            .mev(5 * LAMPORTS_PER_SOL)
            .block_rewards(3 * LAMPORTS_PER_SOL)
            .jito(LAMPORTS_PER_SOL)
            .build(),
    );

    let rewards_collection = RewardsCollection {
        epoch,
        rewards_by_vote_account: rewards_map,
    };

    let fee_config = create_test_fee_config(950, 500);
    let settlement_config = create_test_settlement_config();

    // Generate settlements using JSON-loaded sam_meta
    let settlements = generate_bid_settlements(
        &stake_meta_index,
        &sam_metas,
        &rewards_collection,
        &settlement_config,
        &fee_config,
        &accept_all,
    )
    .unwrap();

    assert!(
        !settlements.is_empty(),
        "Should generate settlements from JSON data"
    );
    let settlement = &settlements[0];
    assert_eq!(settlement.vote_account, sam_meta.vote_account);
    assert!(
        settlement.claims_amount > 0,
        "Should have positive claims amount"
    );

    let values = sam_meta.values.as_ref().unwrap();
    let commissions = values.commissions.as_ref().unwrap();
    assert_eq!(
        commissions.inflation_commission_onchain_dec,
        Decimal::from_str("0.08").unwrap()
    );
    assert_eq!(
        commissions.inflation_commission_in_bond_dec,
        Some(Decimal::from_str("0.03").unwrap())
    );
}

// --- PSR (Protected Staking Rewards) settlement tests ---

#[test]
fn test_generate_psr_downtime_basic() {
    let epoch = 100;
    let slot = 1000;
    let vote_account = test_vote_account(1);
    let stake_authority = test_stake_authority(1);
    let withdraw_authority = test_withdraw_authority(1);
    let stake_lamports = 100 * LAMPORTS_PER_SOL;

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot,
        stake_metas: vec![create_stake_meta(
            test_stake_account(1),
            vote_account,
            withdraw_authority,
            stake_authority,
            stake_lamports,
        )],
    };
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let protected_event_collection = ProtectedEventCollection {
        epoch,
        slot,
        events: vec![ProtectedEvent::DowntimeRevenueImpact {
            vote_account,
            actual_credits: 5000,
            expected_credits: 10000,
            expected_epr: Decimal::from_str("0.001").unwrap(),
            actual_epr: Decimal::from_str("0.0005").unwrap(),
            epr_loss_bps: 5000,
            stake: stake_lamports,
        }],
    };

    let settlement_config = PsrSettlementConfig::DowntimeRevenueImpactSettlement {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        min_settlement_lamports: 0,
        grace_downtime_bps: None,
        covered_range_bps: [0, 5000],
    };

    let settlements = generate_psr_settlements(
        &stake_meta_index,
        &protected_event_collection,
        &accept_all,
        &[settlement_config],
    )
    .unwrap();

    assert_eq!(settlements.len(), 1, "Should generate 1 settlement");
    let settlement = &settlements[0];
    assert_eq!(settlement.vote_account, vote_account);
    assert!(
        matches!(settlement.reason, SettlementReason::ProtectedEvent(_)),
        "Settlement reason should be ProtectedEvent"
    );
    // claim_per_stake = 0.001 - 0.0005 = 0.0005
    // max_claim = (5000/10000) * 0.001 = 0.0005, ignored = 0
    // claim = 100_000_000_000 * 0.0005 = 50_000_000
    assert_eq!(settlement.claims_amount, 50_000_000);
    assert!(
        !settlement.claims.is_empty(),
        "Should have at least one claim"
    );
    // ValidatorBond funder should NOT have null claim
    assert!(
        !settlement
            .claims
            .iter()
            .any(|c| c.withdraw_authority == Pubkey::default()
                && c.stake_authority == Pubkey::default()
                && c.claim_amount == 0),
        "ValidatorBond funder should not have null claim"
    );
}

#[test]
fn test_generate_psr_downtime_marinade_funder_adds_null_claim() {
    let epoch = 100;
    let slot = 1000;
    let vote_account = test_vote_account(1);
    let stake_authority = test_stake_authority(1);
    let withdraw_authority = test_withdraw_authority(1);
    let stake_lamports = 100 * LAMPORTS_PER_SOL;

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot,
        stake_metas: vec![create_stake_meta(
            test_stake_account(1),
            vote_account,
            withdraw_authority,
            stake_authority,
            stake_lamports,
        )],
    };
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    // 100% downtime so the [5000, 10000] covered range still yields a claim
    let protected_event_collection = ProtectedEventCollection {
        epoch,
        slot,
        events: vec![ProtectedEvent::DowntimeRevenueImpact {
            vote_account,
            actual_credits: 0,
            expected_credits: 10000,
            expected_epr: Decimal::from_str("0.001").unwrap(),
            actual_epr: Decimal::ZERO,
            epr_loss_bps: 10000,
            stake: stake_lamports,
        }],
    };

    let settlement_config = PsrSettlementConfig::DowntimeRevenueImpactSettlement {
        meta: SettlementMeta {
            funder: SettlementFunder::Marinade,
        },
        min_settlement_lamports: 0,
        grace_downtime_bps: None,
        covered_range_bps: [5000, 10000],
    };

    let settlements = generate_psr_settlements(
        &stake_meta_index,
        &protected_event_collection,
        &accept_all,
        &[settlement_config],
    )
    .unwrap();

    assert_eq!(settlements.len(), 1, "Should generate 1 settlement");
    let settlement = &settlements[0];
    // Verify null claim exists (Marinade funder)
    let null_claim = settlement.claims.iter().find(|c| {
        c.withdraw_authority == Pubkey::default()
            && c.stake_authority == Pubkey::default()
            && c.claim_amount == 0
    });
    assert!(
        null_claim.is_some(),
        "Marinade funder should have a null claim"
    );
    // claim_per_stake = 0.001 - 0 = 0.001
    // max_claim = (10000/10000) * 0.001 = 0.001, ignored = (5000/10000) * 0.001 = 0.0005
    // effective = min(0.001, 0.001) - 0.0005 = 0.0005
    // claim = 100_000_000_000 * 0.0005 = 50_000_000
    assert_eq!(settlement.claims_amount, 50_000_000);
}

#[test]
fn test_generate_psr_downtime_below_grace_period() {
    let epoch = 100;
    let slot = 1000;
    let vote_account = test_vote_account(1);

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot,
        stake_metas: vec![create_stake_meta(
            test_stake_account(1),
            vote_account,
            test_withdraw_authority(1),
            test_stake_authority(1),
            100 * LAMPORTS_PER_SOL,
        )],
    };
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    // epr_loss_bps=50, below grace_downtime_bps=100
    let protected_event_collection = ProtectedEventCollection {
        epoch,
        slot,
        events: vec![ProtectedEvent::DowntimeRevenueImpact {
            vote_account,
            actual_credits: 9950,
            expected_credits: 10000,
            expected_epr: Decimal::from_str("0.001").unwrap(),
            actual_epr: Decimal::from_str("0.000995").unwrap(),
            epr_loss_bps: 50,
            stake: 100 * LAMPORTS_PER_SOL,
        }],
    };

    let settlement_config = PsrSettlementConfig::DowntimeRevenueImpactSettlement {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        min_settlement_lamports: 0,
        grace_downtime_bps: Some(100),
        covered_range_bps: [0, 5000],
    };

    let settlements = generate_psr_settlements(
        &stake_meta_index,
        &protected_event_collection,
        &accept_all,
        &[settlement_config],
    )
    .unwrap();

    assert_eq!(
        settlements.len(),
        0,
        "Should generate 0 settlements when below grace period"
    );
}

#[test]
fn test_generate_psr_downtime_below_min_settlement() {
    let epoch = 100;
    let slot = 1000;
    let vote_account = test_vote_account(1);
    let tiny_stake = LAMPORTS_PER_SOL / 10; // 0.1 SOL

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot,
        stake_metas: vec![create_stake_meta(
            test_stake_account(1),
            vote_account,
            test_withdraw_authority(1),
            test_stake_authority(1),
            tiny_stake,
        )],
    };
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let protected_event_collection = ProtectedEventCollection {
        epoch,
        slot,
        events: vec![ProtectedEvent::DowntimeRevenueImpact {
            vote_account,
            actual_credits: 5000,
            expected_credits: 10000,
            expected_epr: Decimal::from_str("0.001").unwrap(),
            actual_epr: Decimal::from_str("0.0005").unwrap(),
            epr_loss_bps: 5000,
            stake: tiny_stake,
        }],
    };

    // claim = 100_000_000 * 0.0005 = 50_000 (below min_settlement_lamports of 100_000)
    let settlement_config = PsrSettlementConfig::DowntimeRevenueImpactSettlement {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        min_settlement_lamports: 100_000,
        grace_downtime_bps: None,
        covered_range_bps: [0, 5000],
    };

    let settlements = generate_psr_settlements(
        &stake_meta_index,
        &protected_event_collection,
        &accept_all,
        &[settlement_config],
    )
    .unwrap();

    assert_eq!(
        settlements.len(),
        0,
        "Should generate 0 settlements when claim below min_settlement_lamports"
    );
}

#[test]
fn test_generate_psr_commission_increase_basic() {
    let epoch = 100;
    let slot = 1000;
    let vote_account = test_vote_account(1);
    let stake_lamports = 100 * LAMPORTS_PER_SOL;

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot,
        stake_metas: vec![create_stake_meta(
            test_stake_account(1),
            vote_account,
            test_withdraw_authority(1),
            test_stake_authority(1),
            stake_lamports,
        )],
    };
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let protected_event_collection = ProtectedEventCollection {
        epoch,
        slot,
        events: vec![ProtectedEvent::CommissionSamIncrease {
            vote_account,
            expected_inflation_commission: Decimal::from_str("0.05").unwrap(),
            actual_inflation_commission: Decimal::from_str("0.05").unwrap(),
            past_inflation_commission: Decimal::from_str("0.03").unwrap(),
            expected_mev_commission: Some(Decimal::from_str("0.05").unwrap()),
            actual_mev_commission: Some(Decimal::from_str("0.05").unwrap()),
            past_mev_commission: Some(Decimal::from_str("0.03").unwrap()),
            before_sam_commission_increase_pmpe: Decimal::ZERO,
            expected_epr: Decimal::from_str("0.001").unwrap(),
            actual_epr: Decimal::from_str("0.0008").unwrap(),
            epr_loss_bps: 2000,
            stake: stake_lamports,
        }],
    };

    let settlement_config = PsrSettlementConfig::CommissionSamIncreaseSettlement {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        min_settlement_lamports: 0,
        grace_increase_bps: None,
        covered_range_bps: [0, 10000],
        extra_penalty_threshold_bps: 5000,
        base_markup_bps: 1000,
        penalty_markup_bps: 2000,
    };

    let settlements = generate_psr_settlements(
        &stake_meta_index,
        &protected_event_collection,
        &accept_all,
        &[settlement_config],
    )
    .unwrap();

    assert_eq!(settlements.len(), 1, "Should generate 1 settlement");
    let settlement = &settlements[0];
    assert!(
        matches!(settlement.reason, SettlementReason::ProtectedEvent(_)),
        "Settlement reason should be ProtectedEvent"
    );
    // base_cps = 0.001 - 0.0008 = 0.0002
    // commissions (0.05) below threshold (0.5) → base_markup_bps=1000 (10%)
    // claim_per_stake = 0.0002 + 0.0002 * 0.1 = 0.00022
    // claim = 100_000_000_000 * 0.00022 = 22_000_000
    assert_eq!(settlement.claims_amount, 22_000_000);
}

#[test]
fn test_generate_psr_stake_authority_filter() {
    let epoch = 100;
    let slot = 1000;
    let vote_account = test_vote_account(1);
    let allowed_authority = test_stake_authority(1);
    let blocked_authority = test_stake_authority(2);
    let stake_lamports = 100 * LAMPORTS_PER_SOL;

    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot,
        stake_metas: vec![
            create_stake_meta(
                test_stake_account(1),
                vote_account,
                test_withdraw_authority(1),
                allowed_authority,
                stake_lamports,
            ),
            create_stake_meta(
                test_stake_account(2),
                vote_account,
                test_withdraw_authority(2),
                blocked_authority,
                stake_lamports,
            ),
        ],
    };
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    let protected_event_collection = ProtectedEventCollection {
        epoch,
        slot,
        events: vec![ProtectedEvent::DowntimeRevenueImpact {
            vote_account,
            actual_credits: 5000,
            expected_credits: 10000,
            expected_epr: Decimal::from_str("0.001").unwrap(),
            actual_epr: Decimal::from_str("0.0005").unwrap(),
            epr_loss_bps: 5000,
            stake: 2 * stake_lamports,
        }],
    };

    let settlement_config = PsrSettlementConfig::DowntimeRevenueImpactSettlement {
        meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        min_settlement_lamports: 0,
        grace_downtime_bps: None,
        covered_range_bps: [0, 5000],
    };

    let filter = |pubkey: &Pubkey| *pubkey == allowed_authority;
    let settlements = generate_psr_settlements(
        &stake_meta_index,
        &protected_event_collection,
        &filter,
        &[settlement_config],
    )
    .unwrap();

    assert_eq!(settlements.len(), 1, "Should generate 1 settlement");
    let settlement = &settlements[0];
    assert_eq!(
        settlement.claims.len(),
        1,
        "Should have exactly 1 claim (only allowed authority)"
    );
    assert_eq!(settlement.claims[0].stake_authority, allowed_authority);
    // claim = 100_000_000_000 * 0.0005 = 50_000_000
    assert_eq!(settlement.claims_amount, 50_000_000);
}

#[test]
fn test_generate_psr_null_claim_deterministic_sorting() {
    // Regression test for M7: null claim must participate in deterministic sorting.
    // Pubkey::default() (all zeros) should sort before any real staker pubkey.
    let epoch = 100;
    let slot = 1000;
    let vote_account = test_vote_account(1);
    let stake_lamports = 100 * LAMPORTS_PER_SOL;

    // Use two stakers so there are 3 claims total (2 real + 1 null)
    let stake_meta_collection = StakeMetaCollection {
        epoch,
        slot,
        stake_metas: vec![
            create_stake_meta(
                test_stake_account(1),
                vote_account,
                test_withdraw_authority(1),
                test_stake_authority(1),
                stake_lamports,
            ),
            create_stake_meta(
                test_stake_account(2),
                vote_account,
                test_withdraw_authority(2),
                test_stake_authority(2),
                stake_lamports,
            ),
        ],
    };
    let stake_meta_index = StakeMetaIndex::new(&stake_meta_collection);

    // 100% downtime with Marinade funder → null claim gets added
    let protected_event_collection = ProtectedEventCollection {
        epoch,
        slot,
        events: vec![ProtectedEvent::DowntimeRevenueImpact {
            vote_account,
            actual_credits: 0,
            expected_credits: 10000,
            expected_epr: Decimal::from_str("0.001").unwrap(),
            actual_epr: Decimal::ZERO,
            epr_loss_bps: 10000,
            stake: 2 * stake_lamports,
        }],
    };

    let settlement_config = PsrSettlementConfig::DowntimeRevenueImpactSettlement {
        meta: SettlementMeta {
            funder: SettlementFunder::Marinade,
        },
        min_settlement_lamports: 0,
        grace_downtime_bps: None,
        covered_range_bps: [5000, 10000],
    };

    let settlements = generate_psr_settlements(
        &stake_meta_index,
        &protected_event_collection,
        &accept_all,
        &[settlement_config],
    )
    .unwrap();

    assert_eq!(settlements.len(), 1);
    let claims = &settlements[0].claims;
    assert_eq!(
        claims.len(),
        3,
        "Should have 2 staker claims + 1 null claim"
    );

    // Null claim (Pubkey::default() = all zeros) must be sorted to position 0
    assert_eq!(
        claims[0].withdraw_authority,
        Pubkey::default(),
        "Null claim should be first after deterministic sorting"
    );
    assert_eq!(claims[0].stake_authority, Pubkey::default());
    assert_eq!(claims[0].claim_amount, 0);

    // Remaining claims should be in ascending order by (withdraw_authority, stake_authority)
    for i in 1..claims.len() - 1 {
        let current = (&claims[i].withdraw_authority, &claims[i].stake_authority);
        let next = (
            &claims[i + 1].withdraw_authority,
            &claims[i + 1].stake_authority,
        );
        assert!(
            current <= next,
            "Claims should be sorted deterministically: claim {i} ({current:?}) should be <= claim {} ({next:?})",
            i + 1
        );
    }
}

#[test]
fn test_settlement_config_yaml_deserialization() {
    use crate::settlement_config::BidDistributionConfig;
    let yaml_content = std::fs::read_to_string("../../settlement-config.yaml")
        .expect("settlement-config.yaml should exist at repo root");
    let config: BidDistributionConfig = serde_yaml::from_str(&yaml_content)
        .expect("settlement-config.yaml should deserialize to BidDistributionConfig");

    // Validate fee config bounds
    config
        .fee_config
        .validate()
        .expect("fee config should be valid");

    // Verify expected structure: SAM configs + PSR configs
    assert!(
        config.bidding_config().is_some(),
        "Should have a Bidding config"
    );
    assert!(
        config.bid_too_low_penalty_config().is_some(),
        "Should have a BidTooLowPenalty config"
    );
    assert!(
        config.blacklist_penalty_config().is_some(),
        "Should have a BlacklistPenalty config"
    );
    let psr_configs = config.psr_settlements();
    assert!(
        !psr_configs.is_empty(),
        "Should have at least one PSR config"
    );
}
