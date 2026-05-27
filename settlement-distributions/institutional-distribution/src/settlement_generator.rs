use crate::institutional_payouts::InstitutionalPayout;
use log::info;
use settlement_common::settlement_collection::{
    ClaimDetail, Settlement, SettlementClaim, SettlementCollection,
};

use crate::settlement_config::InstitutionalDistributionConfig;
use settlement_common::stake_meta_index::StakeMetaIndex;
use settlement_common::utils::sort_claims_deterministically;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

enum PayoutKind {
    Staker,
    FeeDeposit,
}

pub fn generate_institutional_settlement_collection(
    config: &InstitutionalDistributionConfig,
    institutional_payout: &InstitutionalPayout,
    // Kept for binary-API compatibility; no longer consumed after §1.5 dropped
    // fee-deposit stake-account info from FeeDeposit claims.
    _stake_meta_index: &StakeMetaIndex,
) -> SettlementCollection {
    let settlements = generate_institutional_settlements(config, institutional_payout);

    SettlementCollection {
        epoch: institutional_payout.epoch,
        slot: config.snapshot_slot,
        settlements,
    }
}

struct Payout {
    vote_account: Pubkey,
    withdrawer: Pubkey,
    staker: Pubkey,
    stake_amount: u64,
    payout_lamports: u64,
    stake_accounts: HashMap<Pubkey, u64>,
    kind: PayoutKind,
}

fn merge_payouts(
    config: &InstitutionalDistributionConfig,
    institutional_payout: &InstitutionalPayout,
) -> Vec<Payout> {
    let mut payouts: Vec<Payout> = Vec::new();

    for payout_staker in institutional_payout.payout_stakers.iter() {
        let stake_accounts = payout_staker
            .stake_accounts
            .iter()
            .map(|account| (account.address, account.effective_stake))
            .collect::<HashMap<Pubkey, u64>>();
        let effective_stake: u64 = stake_accounts.values().sum();
        assert_eq!(effective_stake, payout_staker.effective_stake);
        payouts.push(Payout {
            vote_account: payout_staker.vote_account,
            withdrawer: payout_staker.withdrawer,
            staker: payout_staker.staker,
            stake_amount: payout_staker.effective_stake,
            payout_lamports: payout_staker.payout_lamports,
            stake_accounts,
            kind: PayoutKind::Staker,
        });
    }

    for payout_distributor in institutional_payout.payout_distributors.iter() {
        let dao_payout = payout_distributor
            .payout_lamports
            .saturating_mul(config.dao_fee_split_share_bps)
            / 10_000;
        let marinade_payout = payout_distributor
            .payout_lamports
            .saturating_sub(dao_payout);

        payouts.push(Payout {
            vote_account: payout_distributor.vote_account,
            withdrawer: config.marinade_withdraw_authority,
            staker: config.marinade_stake_authority,
            stake_amount: 0,
            payout_lamports: marinade_payout,
            stake_accounts: HashMap::new(),
            kind: PayoutKind::FeeDeposit,
        });
        payouts.push(Payout {
            vote_account: payout_distributor.vote_account,
            withdrawer: config.dao_withdraw_authority,
            staker: config.dao_stake_authority,
            stake_amount: 0,
            payout_lamports: dao_payout,
            stake_accounts: HashMap::new(),
            kind: PayoutKind::FeeDeposit,
        });
    }

    payouts
}

fn generate_institutional_settlements(
    config: &InstitutionalDistributionConfig,
    institutional_payout: &InstitutionalPayout,
) -> Vec<Settlement> {
    info!("Generating Institutional Payout Bonds settlements...");

    // vote account -> Settlement
    let mut settlements: HashMap<Pubkey, Settlement> = HashMap::new();

    let payouts = merge_payouts(config, institutional_payout);
    for payout in payouts {
        let settlement = settlements
            .entry(payout.vote_account)
            .or_insert(Settlement {
                reason: config.settlement_reason.clone(),
                meta: config.settlement_meta.clone(),
                vote_account: payout.vote_account,
                claims_count: 0,
                claims_amount: 0,
                claims: vec![],
                details: None,
            });
        settlement.claims_amount += payout.payout_lamports;

        let incoming_is_staker = matches!(payout.kind, PayoutKind::Staker);
        if let Some(existing_claim) = settlement.claims.iter_mut().find(|claim| {
            let existing_is_staker = matches!(claim.detail, ClaimDetail::StakerPayout { .. });
            claim.withdraw_authority == payout.withdrawer
                && claim.stake_authority == payout.staker
                && existing_is_staker == incoming_is_staker
        }) {
            existing_claim.claim_amount += payout.payout_lamports;
            if let ClaimDetail::StakerPayout {
                active_stake,
                stake_accounts: existing_accounts,
                ..
            } = &mut existing_claim.detail
            {
                *active_stake += payout.stake_amount;
                for (k, v) in &payout.stake_accounts {
                    *existing_accounts.entry(*k).or_insert(0) += *v;
                }
            }
        } else {
            let claim = match payout.kind {
                PayoutKind::Staker => SettlementClaim::staker_payout(
                    payout.withdrawer,
                    payout.staker,
                    payout.stake_amount,
                    0,
                    payout.payout_lamports,
                    payout.stake_accounts,
                ),
                PayoutKind::FeeDeposit => SettlementClaim::fee_deposit(
                    payout.withdrawer,
                    payout.staker,
                    payout.payout_lamports,
                ),
            };
            settlement.claims.push(claim);
        }
    }

    settlements
        .into_values()
        .map(|mut settlement| {
            sort_claims_deterministically(&mut settlement.claims);
            settlement.claims_count = settlement.claims.len();
            settlement
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement_config::InstitutionalDistributionConfig;
    use settlement_common::settlement_collection::{
        SettlementFunder, SettlementMeta, SettlementReason,
    };
    use std::collections::HashSet;

    use solana_sdk::pubkey::Pubkey;
    use std::fs::File;
    use std::io::BufReader;
    use std::path::Path;

    // 28Qeabkx5pB1fhT23W3mvMmTydXZzPN76MeKofR4xG1j
    const TEST_PUBKEY_MARINADE: Pubkey = Pubkey::new_from_array([
        16, 193, 125, 202, 226, 246, 166, 247, 62, 235, 241, 168, 44, 170, 26, 135, 207, 86, 46,
        127, 152, 219, 15, 111, 57, 48, 64, 201, 193, 113, 238, 142,
    ]);
    // 9Yt3gCARfU7ESgoUuLDEjPtiGPEXFFSwD1BmiPFdwu1c
    const TEST_PUBKEY_DAO: Pubkey = Pubkey::new_from_array([
        127, 8, 55, 242, 45, 122, 204, 129, 76, 202, 221, 104, 240, 55, 246, 62, 64, 185, 52, 25,
        125, 221, 190, 84, 112, 113, 168, 226, 2, 126, 28, 227,
    ]);
    const TEST_CONFIG: InstitutionalDistributionConfig = InstitutionalDistributionConfig {
        settlement_meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        marinade_stake_authority: TEST_PUBKEY_MARINADE,
        marinade_withdraw_authority: TEST_PUBKEY_MARINADE,
        dao_fee_split_share_bps: 2500,
        dao_stake_authority: TEST_PUBKEY_DAO,
        dao_withdraw_authority: TEST_PUBKEY_DAO,
        settlement_reason: SettlementReason::InstitutionalPayout,
        snapshot_slot: 0,
    };

    #[derive(Debug, Eq, PartialEq, Hash)]
    struct PayoutCombo {
        vote_account: Pubkey,
        staker: Pubkey,
        withdrawer: Pubkey,
    }

    pub fn count_unique_payout_combinations(
        payout: &InstitutionalPayout,
        marinade_pubkey: &Pubkey,
        dao_pubkey: &Pubkey,
    ) -> usize {
        let mut unique_combos = HashSet::new();
        for staker in &payout.payout_stakers {
            unique_combos.insert(PayoutCombo {
                vote_account: staker.vote_account,
                staker: staker.staker,
                withdrawer: staker.withdrawer,
            });
        }
        for distributor in &payout.payout_distributors {
            unique_combos.insert(PayoutCombo {
                vote_account: distributor.vote_account,
                staker: *marinade_pubkey,
                withdrawer: *marinade_pubkey,
            });
            unique_combos.insert(PayoutCombo {
                vote_account: distributor.vote_account,
                staker: *dao_pubkey,
                withdrawer: *dao_pubkey,
            });
        }
        unique_combos.len()
    }

    fn sum_distributors_payout(payout: &InstitutionalPayout) -> u64 {
        payout
            .payout_distributors
            .iter()
            .map(|p| p.payout_lamports)
            .sum()
    }

    fn sum_stakers_payout(payout: &InstitutionalPayout) -> u64 {
        payout
            .payout_stakers
            .iter()
            .map(|p| p.payout_lamports)
            .sum()
    }

    pub fn sum_payout_lamports(payout: &InstitutionalPayout) -> u64 {
        sum_stakers_payout(payout) + sum_distributors_payout(payout)
    }

    fn sum_claims_for_authority(settlements: &[Settlement], auth: &Pubkey) -> u64 {
        settlements
            .iter()
            .flat_map(|s| {
                s.claims.iter().filter_map(|c| {
                    if c.stake_authority == *auth && c.withdraw_authority == *auth {
                        Some(c.claim_amount)
                    } else {
                        None
                    }
                })
            })
            .sum()
    }

    fn read_json_payout(payout_type: &str) -> InstitutionalPayout {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let file_path = Path::new(manifest_dir)
            .join("tests")
            .join("fixtures")
            .join(format!("output-{payout_type}-payouts.json"));
        let file = File::open(file_path).unwrap();
        let reader = BufReader::new(file);
        serde_json::from_reader(reader).unwrap()
    }

    #[test]
    fn test_generate_marinade() {
        let institutional_payout = read_json_payout("marinade");

        let settlements = generate_institutional_settlements(&TEST_CONFIG, &institutional_payout);

        // 4 different validators
        assert_eq!(settlements.len(), 4);

        let claims_number = settlements.iter().map(|s| s.claims_count).sum::<usize>();
        assert_eq!(
            count_unique_payout_combinations(
                &institutional_payout,
                &TEST_PUBKEY_MARINADE,
                &TEST_PUBKEY_DAO,
            ),
            claims_number
        );

        let claims_amount = settlements.iter().map(|s| s.claims_amount).sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claims_amount);
        let claiming_amount = settlements
            .iter()
            .flat_map(|s| s.claims.iter().map(|c| c.claim_amount))
            .sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claiming_amount);

        let distributor_payout = sum_distributors_payout(&institutional_payout);
        let marinade_claims_amount = sum_claims_for_authority(&settlements, &TEST_PUBKEY_MARINADE);
        let dao_claims_amount = sum_claims_for_authority(&settlements, &TEST_PUBKEY_DAO);
        assert_eq!(
            marinade_claims_amount + dao_claims_amount,
            distributor_payout
        );
        assert_eq!(
            // 1 lamport rounding error
            dao_claims_amount + 1,
            (distributor_payout * TEST_CONFIG.dao_fee_split_share_bps) / 10_000
        );
    }

    #[test]
    fn test_generate_prime() {
        let institutional_payout = read_json_payout("prime");

        let settlements = generate_institutional_settlements(&TEST_CONFIG, &institutional_payout);

        // 6 different validators
        assert_eq!(settlements.len(), 6);

        let claims_number = settlements.iter().map(|s| s.claims_count).sum::<usize>();
        assert_eq!(
            count_unique_payout_combinations(
                &institutional_payout,
                &TEST_PUBKEY_MARINADE,
                &TEST_PUBKEY_DAO,
            ),
            claims_number
        );

        let claims_amount = settlements.iter().map(|s| s.claims_amount).sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claims_amount);
        let claiming_amount = settlements
            .iter()
            .flat_map(|s| s.claims.iter().map(|c| c.claim_amount))
            .sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claiming_amount);

        let distributor_payout = sum_distributors_payout(&institutional_payout);
        let marinade_claims_amount = sum_claims_for_authority(&settlements, &TEST_PUBKEY_MARINADE);
        let dao_claims_amount = sum_claims_for_authority(&settlements, &TEST_PUBKEY_DAO);
        assert_eq!(
            marinade_claims_amount + dao_claims_amount,
            distributor_payout
        );
        assert_eq!(
            // 1 lamport rounding error
            dao_claims_amount + 1,
            (distributor_payout * TEST_CONFIG.dao_fee_split_share_bps) / 10_000
        );
    }

    fn make_payout_staker(
        vote_account: Pubkey,
        staker: Pubkey,
        withdrawer: Pubkey,
        stake_accounts: Vec<(Pubkey, u64)>,
        payout_lamports: u64,
    ) -> crate::institutional_payouts::PayoutStaker {
        use crate::institutional_payouts::{PayoutStaker, StakeAccount};
        use rust_decimal::Decimal;

        let stake_accounts: Vec<StakeAccount> = stake_accounts
            .into_iter()
            .map(|(address, effective_stake)| StakeAccount {
                address,
                effective_stake,
            })
            .collect();
        let effective_stake: u64 = stake_accounts.iter().map(|s| s.effective_stake).sum();
        PayoutStaker {
            vote_account,
            stake_accounts,
            staker,
            withdrawer,
            active_stake: 0,
            effective_stake,
            activating_stake: 0,
            deactivating_stake: 0,
            balance_lamports: 0,
            share_institutional: Decimal::ZERO,
            share_deactivation: Decimal::ZERO,
            payout_lamports,
        }
    }

    fn make_empty_institutional_payout(
        epoch: u64,
    ) -> crate::institutional_payouts::InstitutionalPayout {
        use crate::institutional_payouts::{
            ConfigDto, InstitutionalPayout, InstitutionalValidatorsDto, PsrPercentileData,
        };
        use rust_decimal::Decimal;

        InstitutionalPayout {
            epoch,
            slot: 0,
            config: ConfigDto {
                staker_authority_filter: vec![],
                psr_percentile: 0,
                psr_grace_downtime_bps: 0,
                validator_fee_bps: 0,
                distributor_fee_bps: 0,
            },
            institutional_validators: InstitutionalValidatorsDto { validators: vec![] },
            psr_percentile_data: PsrPercentileData {
                psr_percentile: 0,
                psr_percentile_apy: Decimal::ZERO,
                psr_percentile_effective_stake: 0,
                psr_grace_downtime_bps: 0,
            },
            institutional_staker_authorities: vec![],
            validator_fee_bps: 0,
            distributor_fee_bps: 0,
            payout_stakers: vec![],
            payout_distributors: vec![],
            validators: vec![],
            validator_payout_info: vec![],
        }
    }

    #[test]
    fn test_existing_claim_merge_sums_stake_accounts() {
        // On merge, claim_amount/active_stake/stake_accounts are all summed; claims_count == claims.len().
        let vote_account = Pubkey::new_unique();
        let staker = Pubkey::new_unique();
        let withdrawer = Pubkey::new_unique();
        let stake_a = Pubkey::new_unique();
        let stake_b = Pubkey::new_unique();
        let stake_c = Pubkey::new_unique();

        let mut payout = make_empty_institutional_payout(123);
        payout.payout_stakers = vec![
            make_payout_staker(
                vote_account,
                staker,
                withdrawer,
                vec![(stake_a, 100), (stake_b, 200)],
                1_000,
            ),
            make_payout_staker(
                vote_account,
                staker,
                withdrawer,
                vec![(stake_b, 999), (stake_c, 400)],
                2_000,
            ),
        ];

        let settlements = generate_institutional_settlements(&TEST_CONFIG, &payout);

        assert_eq!(settlements.len(), 1);
        let settlement = &settlements[0];
        assert_eq!(
            settlement.claims.len(),
            1,
            "collision collapses into one claim"
        );
        assert_eq!(
            settlement.claims_count, 1,
            "claims_count == claims.len() after merge",
        );
        assert_eq!(settlement.claims_amount, 3_000);

        let claim = &settlement.claims[0];
        assert_eq!(claim.claim_amount, 3_000, "claim_amount summed");
        let active_stake = claim.active_stake().expect("StakerPayout has active_stake");
        assert_eq!(active_stake, 1_699, "active_stake summed (300 + 1399)");

        let stake_accounts = claim
            .stake_accounts()
            .expect("staker payout must carry stake_accounts");
        assert_eq!(stake_accounts.len(), 3);
        assert_eq!(stake_accounts.get(&stake_a), Some(&100));
        assert_eq!(
            stake_accounts.get(&stake_b),
            Some(&1_199),
            "B summed across payouts (200 + 999)",
        );
        assert_eq!(stake_accounts.get(&stake_c), Some(&400));

        let stake_accounts_sum: u64 = stake_accounts.values().sum();
        assert_eq!(
            active_stake, stake_accounts_sum,
            "active_stake ({active_stake}) == sum(stake_accounts.values()) ({stake_accounts_sum})",
        );
    }

    #[test]
    fn test_cross_kind_authority_collision_creates_distinct_claims() {
        // Defensive: when an institutional staker shares authorities with the Marinade
        // fee deposit (config-defined), staker and fee_deposit payouts must NOT merge.
        use crate::institutional_payouts::PayoutDistributor;

        let vote_account = Pubkey::new_unique();
        let stake_a = Pubkey::new_unique();

        let mut payout = make_empty_institutional_payout(456);
        // Staker uses MARINADE authorities — same as TEST_CONFIG.marinade_{stake,withdraw}_authority.
        payout.payout_stakers = vec![make_payout_staker(
            vote_account,
            TEST_PUBKEY_MARINADE,
            TEST_PUBKEY_MARINADE,
            vec![(stake_a, 100)],
            1_000,
        )];
        payout.payout_distributors = vec![PayoutDistributor {
            vote_account,
            payout_lamports: 400,
            stake_accounts: vec![],
        }];

        let settlements = generate_institutional_settlements(&TEST_CONFIG, &payout);

        assert_eq!(settlements.len(), 1);
        let claims = &settlements[0].claims;
        // 2 claims: one Staker, one FeeDeposit — all with same (withdraw, stake) authorities.
        // TEST_CONFIG.dao_fee_split_share_bps = 2500 → dao_payout = 100, marinade_payout = 300.
        let staker = claims
            .iter()
            .find(|c| matches!(c.detail, ClaimDetail::StakerPayout { .. }))
            .expect("Staker claim must remain distinct");
        let fee = claims
            .iter()
            .find(|c| matches!(c.detail, ClaimDetail::FeeDeposit))
            .expect("FeeDeposit claim must remain distinct");
        assert_eq!(staker.withdraw_authority, TEST_PUBKEY_MARINADE);
        assert_eq!(fee.withdraw_authority, TEST_PUBKEY_MARINADE);
        assert_eq!(staker.claim_amount, 1_000);
        assert_eq!(fee.claim_amount, 300);
    }
}
