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
