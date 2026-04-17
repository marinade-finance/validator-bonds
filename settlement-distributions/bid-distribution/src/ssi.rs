use crate::rewards::RewardsCollection;
use rust_decimal::Decimal;
use snapshot_parser_validator_cli::validator_meta::ValidatorMetaCollection;

/// Computes SSI (Solana Staking Index) for the epoch in PMPE (per-mille per epoch).
///
/// SSI = (inflation rewards + block rewards) / total activated stake * 1000
///
/// Methodology: solstakingindex.com — inflation emissions + block rewards, MEV excluded,
/// 0%-commission gross rate, single-epoch (not annualized).
///
/// `validator_meta.validator_rewards` = theoretical 0%-commission inflation (network-wide).
/// `block_rewards` summed from rewards_collection = actual block rewards (network-wide via
/// validators_blocks.json).
pub fn calculate_ssi_pmpe(
    rewards: &RewardsCollection,
    validator_meta: &ValidatorMetaCollection,
) -> anyhow::Result<Decimal> {
    let total_stake = validator_meta.total_stake();
    anyhow::ensure!(total_stake > 0, "total stake is zero, cannot compute SSI");
    let total_block_rewards: u64 = rewards
        .rewards_by_vote_account
        .values()
        .map(|r| r.block_rewards)
        .sum();
    Ok(
        (Decimal::from(validator_meta.validator_rewards) + Decimal::from(total_block_rewards))
            / Decimal::from(total_stake)
            * Decimal::ONE_THOUSAND,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rewards::{RewardsCollection, VoteAccountRewards};
    use snapshot_parser_validator_cli::validator_meta::{ValidatorMeta, ValidatorMetaCollection};
    use solana_sdk::pubkey::Pubkey;
    use std::collections::HashMap;

    fn make_validator_meta_collection(validator_rewards: u64, total_stake: u64) -> ValidatorMetaCollection {
        ValidatorMetaCollection {
            epoch: 100,
            slot: 1000,
            capitalization: 0,
            epoch_duration_in_years: 0.0,
            validator_rate: 0.0,
            validator_rewards,
            validator_metas: vec![ValidatorMeta {
                vote_account: Pubkey::default(),
                commission: 0,
                mev_commission: None,
                jito_priority_fee_commission: None,
                jito_priority_fee_lamports: 0,
                stake: total_stake,
                credits: 0,
            }],
        }
    }

    fn make_rewards_with_block(block_rewards: u64) -> RewardsCollection {
        let mut map = HashMap::new();
        map.insert(
            Pubkey::default(),
            VoteAccountRewards {
                vote_account: Pubkey::default(),
                block_rewards,
                ..VoteAccountRewards::default()
            },
        );
        RewardsCollection {
            epoch: 100,
            rewards_by_vote_account: map,
        }
    }

    #[test]
    fn test_ssi_basic_calculation() {
        // SSI = (validator_rewards + block_rewards) / total_stake * 1000 = (100 + 50) / 1000 * 1000 = 150
        let ssi = calculate_ssi_pmpe(
            &make_rewards_with_block(50),
            &make_validator_meta_collection(100, 1000),
        )
        .unwrap();
        assert_eq!(ssi, Decimal::from(150));
    }

    #[test]
    fn test_ssi_zero_stake_returns_error() {
        let result = calculate_ssi_pmpe(
            &make_rewards_with_block(0),
            &make_validator_meta_collection(100, 0),
        );
        assert!(result.is_err(), "zero total stake must return an error");
    }

    #[test]
    fn test_ssi_no_block_rewards() {
        // SSI = 200 / 2000 * 1000 = 100
        let rewards = RewardsCollection {
            epoch: 100,
            rewards_by_vote_account: HashMap::new(),
        };
        let ssi = calculate_ssi_pmpe(&rewards, &make_validator_meta_collection(200, 2000)).unwrap();
        assert_eq!(ssi, Decimal::from(100));
    }
}
