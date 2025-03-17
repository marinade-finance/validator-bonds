use crate::institutional_payouts::InstitutionalPayout;
use bid_psr_distribution::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection,
};
use log::info;

use crate::settlement_config::InstitutionalDistributionConfig;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

pub fn generate_institutional_settlement_collection(
    config: &InstitutionalDistributionConfig,
    institutional_payout: &InstitutionalPayout,
) -> SettlementCollection {
    let settlements = generate_institutional_settlements(config, institutional_payout);

    SettlementCollection {
        epoch: institutional_payout.epoch,
        slot: institutional_payout.slot,
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
) -> Vec<Payout> {
    let mut payouts: Vec<Payout> = Vec::new();

    for payout_staker in institutional_payout.payout_stakers.iter() {
        payouts.push(Payout {
            vote_account: payout_staker.vote_account,
            withdrawer: payout_staker.withdrawer,
            staker: payout_staker.staker,
            active_stake: payout_staker.active_stake,
            payout_lamports: payout_staker.payout_lamports,
            stake_accounts: payout_staker
                .stake_accounts
                .iter()
                .map(|account| (account.address, account.active_stake))
                .collect(),
        });
    }

    for payout_distributor in institutional_payout.payout_distributors.iter() {
        payouts.push(Payout {
            vote_account: payout_distributor.vote_account,
            withdrawer: config.marinade_withdraw_authority,
            staker: config.marinade_stake_authority,
            active_stake: payout_distributor
                .stake_accounts
                .iter()
                .fold(0u64, |acc, account| {
                    acc.saturating_add(account.active_stake)
                }),
            payout_lamports: payout_distributor.payout_lamports,
            stake_accounts: payout_distributor
                .stake_accounts
                .iter()
                .map(|account| (account.address, account.active_stake))
                .collect(),
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
            });
        settlement.claims_count += 1;
        settlement.claims_amount += payout.payout_lamports;

        if let Some(existing_claim) = settlement.claims.iter_mut().find(|claim| {
            claim.withdraw_authority == payout.withdrawer && claim.stake_authority == payout.staker
        }) {
            existing_claim.claim_amount += payout.payout_lamports;
            existing_claim.active_stake += payout.active_stake;
            existing_claim
                .stake_accounts
                .extend(payout.stake_accounts.iter().map(|(k, v)| (*k, *v)));
        } else {
            settlement.claims.push(SettlementClaim {
                withdraw_authority: payout.withdrawer,
                stake_authority: payout.staker,
                stake_accounts: payout.stake_accounts,
                active_stake: payout.active_stake,
                claim_amount: payout.payout_lamports,
            });
        }
    }

    settlements.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement_config::InstitutionalDistributionConfig;
    use bid_psr_distribution::settlement_collection::{
        SettlementFunder, SettlementMeta, SettlementReason,
    };
    use std::collections::HashSet;

    use solana_sdk::pubkey::Pubkey;
    use std::fs::File;
    use std::io::BufReader;
    use std::path::Path;

    // 28Qeabkx5pB1fhT23W3mvMmTydXZzPN76MeKofR4xG1j
    const TEST_PUBKEY: Pubkey = Pubkey::new_from_array([
        16, 193, 125, 202, 226, 246, 166, 247, 62, 235, 241, 168, 44, 170, 26, 135, 207, 86, 46,
        127, 152, 219, 15, 111, 57, 48, 64, 201, 193, 113, 238, 142,
    ]);
    const TEST_CONFIG: InstitutionalDistributionConfig = InstitutionalDistributionConfig {
        settlement_meta: SettlementMeta {
            funder: SettlementFunder::ValidatorBond,
        },
        marinade_stake_authority: TEST_PUBKEY,
        marinade_withdraw_authority: TEST_PUBKEY,
        settlement_reason: SettlementReason::InstitutionalPayout,
    };

    #[derive(Debug, Eq, PartialEq, Hash)]
    struct PayoutCombo {
        vote_account: Pubkey,
        staker: Pubkey,
        withdrawer: Pubkey,
    }

    pub fn count_unique_payout_combinations(
        payout: &InstitutionalPayout,
        distributor_pubkey: &Pubkey,
    ) -> usize {
        let mut unique_combos = HashSet::new();
        for staker in &payout.payout_stakers {
            let combo = PayoutCombo {
                vote_account: staker.vote_account,
                staker: staker.staker,
                withdrawer: staker.withdrawer,
            };
            unique_combos.insert(combo);
        }
        for distributor in &payout.payout_distributors {
            let combo = PayoutCombo {
                vote_account: distributor.vote_account,
                staker: *distributor_pubkey,
                withdrawer: *distributor_pubkey,
            };
            unique_combos.insert(combo);
        }
        unique_combos.len()
    }

    pub fn sum_payout_lamports(payout: &InstitutionalPayout) -> u64 {
        let mut total = 0;
        for staker in &payout.payout_stakers {
            total += staker.payout_lamports;
        }
        for distributor in &payout.payout_distributors {
            total += distributor.payout_lamports;
        }
        total
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

        let settlements = generate_institutional_settlements(&TEST_CONFIG, &institutional_payout);

        // 4 different validators
        assert_eq!(settlements.len(), 4);

        let claims_number = settlements.iter().map(|s| s.claims_count).sum::<usize>();
        assert_eq!(
            count_unique_payout_combinations(&institutional_payout, &Pubkey::new_unique()),
            claims_number
        );

        let claims_amount = settlements.iter().map(|s| s.claims_amount).sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claims_amount);
        let claiming_amount = settlements
            .iter()
            .flat_map(|s| s.claims.iter().map(|c| c.claim_amount))
            .sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claiming_amount);
    }

    #[test]
    fn test_generate_prime() {
        let institutional_payout = read_json_payout("prime");

        let settlements = generate_institutional_settlements(&TEST_CONFIG, &institutional_payout);

        // 6 different validators
        assert_eq!(settlements.len(), 6);

        let claims_number = settlements.iter().map(|s| s.claims_count).sum::<usize>();
        assert_eq!(
            count_unique_payout_combinations(&institutional_payout, &Pubkey::new_unique()),
            claims_number
        );

        let claims_amount = settlements.iter().map(|s| s.claims_amount).sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claims_amount);
        let claiming_amount = settlements
            .iter()
            .flat_map(|s| s.claims.iter().map(|c| c.claim_amount))
            .sum::<u64>();
        assert_eq!(sum_payout_lamports(&institutional_payout), claiming_amount);
    }
}
