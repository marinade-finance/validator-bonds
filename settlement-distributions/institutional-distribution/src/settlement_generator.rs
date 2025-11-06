use crate::institutional_payouts::InstitutionalPayout;
use bid_psr_distribution::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection,
};
use log::info;

use crate::settlement_config::InstitutionalDistributionConfig;
use bid_psr_distribution::stake_meta_index::StakeMetaIndex;
use bid_psr_distribution::utils::sort_claims_deterministically;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

pub fn generate_institutional_settlement_collection(
    config: &InstitutionalDistributionConfig,
    institutional_payout: &InstitutionalPayout,
    stake_meta_index: &StakeMetaIndex,
) -> SettlementCollection {
    let settlements =
        generate_institutional_settlements(config, institutional_payout, stake_meta_index);

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
    active_stake: u64,
    payout_lamports: u64,
    stake_accounts: HashMap<Pubkey, u64>,
}

fn merge_payouts(
    config: &InstitutionalDistributionConfig,
    institutional_payout: &InstitutionalPayout,
    stake_meta_index: &StakeMetaIndex,
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
            active_stake: payout_staker.effective_stake,
            payout_lamports: payout_staker.payout_lamports,
            stake_accounts,
        });
    }

    let marinade_fee_deposit_stake_accounts: HashMap<_, _> = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| {
            x.withdraw_authority.eq(&config.marinade_withdraw_authority)
                && x.stake_authority.eq(&config.marinade_stake_authority)
        })
        .iter()
        .map(|s| (s.pubkey, s.active_delegation_lamports))
        .collect();

    let dao_fee_deposit_stake_accounts: HashMap<_, _> = stake_meta_index
        .stake_meta_collection
        .stake_metas
        .iter()
        .find(|x| {
            x.withdraw_authority.eq(&config.dao_withdraw_authority)
                && x.stake_authority.eq(&config.dao_stake_authority)
        })
        .iter()
        .map(|s| (s.pubkey, s.active_delegation_lamports))
        .collect();

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
            active_stake: marinade_fee_deposit_stake_accounts
                .iter()
                .fold(0, |acc, (_, v)| acc.saturating_add(*v)),
            payout_lamports: marinade_payout,
            stake_accounts: marinade_fee_deposit_stake_accounts.clone(),
        });
        payouts.push(Payout {
            vote_account: payout_distributor.vote_account,
            withdrawer: config.dao_withdraw_authority,
            staker: config.dao_stake_authority,
            active_stake: dao_fee_deposit_stake_accounts
                .iter()
                .fold(0, |acc, (_, v)| acc.saturating_add(*v)),
            payout_lamports: dao_payout,
            stake_accounts: dao_fee_deposit_stake_accounts.clone(),
        });
    }

    payouts
}

fn generate_institutional_settlements(
    config: &InstitutionalDistributionConfig,
    institutional_payout: &InstitutionalPayout,
    stake_meta_index: &StakeMetaIndex,
) -> Vec<Settlement> {
    info!("Generating Institutional Payout Bonds settlements...");

    // vote account -> Settlement
    let mut settlements: HashMap<Pubkey, Settlement> = HashMap::new();

    let payouts = merge_payouts(config, institutional_payout, stake_meta_index);
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
            });
        settlement.claims_count += 1;
        settlement.claims_amount += payout.payout_lamports;

        if let Some(existing_claim) = settlement.claims.iter_mut().find(|claim| {
            claim.withdraw_authority == payout.withdrawer && claim.stake_authority == payout.staker
        }) {
            existing_claim.claim_amount += payout.payout_lamports;
            existing_claim.active_stake += payout.active_stake;
            for (k, v) in &payout.stake_accounts {
                existing_claim.stake_accounts.entry(*k).or_insert(*v);
            }
        } else {
            settlement.claims.push(SettlementClaim {
                withdraw_authority: payout.withdrawer,
                stake_authority: payout.staker,
                active_stake: payout.active_stake,
                stake_accounts: payout.stake_accounts,
                claim_amount: payout.payout_lamports,
            });
        }
    }

    settlements
        .into_values()
        .map(|mut settlement| {
            sort_claims_deterministically(&mut settlement.claims);
            settlement
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement_config::InstitutionalDistributionConfig;
    use bid_psr_distribution::settlement_collection::{
        SettlementFunder, SettlementMeta, SettlementReason,
    };
    use std::collections::HashSet;

    use snapshot_parser_validator_cli::stake_meta::StakeMetaCollection;
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
            .join(format!("output-{}-payouts.json", payout_type));
        let file = File::open(file_path).unwrap();
        let reader = BufReader::new(file);
        serde_json::from_reader(reader).unwrap()
    }

    #[test]
    fn test_generate_marinade() {
        let institutional_payout = read_json_payout("marinade");

        let stake_meta_index = default_stake_meta_index();
        let settlements = generate_institutional_settlements(
            &TEST_CONFIG,
            &institutional_payout,
            &stake_meta_index,
        );

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

        let stake_meta_index = default_stake_meta_index();
        let settlements = generate_institutional_settlements(
            &TEST_CONFIG,
            &institutional_payout,
            &stake_meta_index,
        );

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

    fn default_stake_meta_index() -> StakeMetaIndex<'static> {
        static EMPTY_COLLECTION: once_cell::sync::Lazy<StakeMetaCollection> =
            once_cell::sync::Lazy::new(|| StakeMetaCollection {
                epoch: 0,
                slot: 0,
                stake_metas: vec![],
            });
        StakeMetaIndex::new(&EMPTY_COLLECTION)
    }
}
