#!/usr/bin/env python3
"""
Generate fabricated but valid test input data for the settlement distribution pipeline.

This creates internally consistent data for epoch 99999 with several validators
exercising different settlement types:
  - Validator A: SAM bidder only (no PSR events) -> Bidding settlement
  - Validator B: SAM bidder + downtime -> Bidding + DowntimeRevenueImpact settlements
  - Validator C: SAM bidder + commission increase -> Bidding + CommissionSamIncrease settlements
  - Validator D: No SAM bid, healthy -> No settlements
  - Validator E: Institutional validator -> InstitutionalPayout settlement

Usage:
  python3 scripts/generate-fabricated-test-data.py --output-dir ./regression-data/99999/inputs
"""
import argparse
import json
import os
import sys

# ============================================================================
# Constants
# ============================================================================
EPOCH = 99999
SLOT = 432000000

# Whitelisted stake authorities (from settlement-config.yaml)
WHITELIST_STAKE_AUTHORITIES = [
    "stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq",
    "4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk",
    "ex9CfkBZZd6Nv9XdnoDmmB45ymbu4arXVk7g5pWnt3N",
]

# Fee authorities (from settlement-config.yaml)
MARINADE_FEE_STAKE_AUTH = "BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x"
MARINADE_FEE_WITHDRAW_AUTH = "BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x"
DAO_FEE_STAKE_AUTH = "mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz"
DAO_FEE_WITHDRAW_AUTH = "mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz"

# Bonds config addresses
BID_BONDS_CONFIG = "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU"
INST_BONDS_CONFIG = "VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE"

# --- Fabricated Pubkeys (deterministic SHA-256 hashes, valid 32-byte base58) ---
# Vote accounts
VOTE_A = "BYzAP4H8Q58hRmmD7ACiB4H6za5DA9n9UU81AfqxYP8J"
VOTE_B = "4co4bhV9ymiGyjYdG9mGchWwNTctWDUbPtRDGCNenWaR"
VOTE_C = "B1x5iZjuqzVXJRff4Qy7oJDzVoSRs4VwJbPfXJnRAUkZ"
VOTE_D = "CpoLiMNF9eAWfrhiAfbNm9stM1H2X2nW6uETF9QMCMA"
VOTE_E = "EErHYU5dbb1Ac67BQfvgCi8Dwx6vhDAQbmonf4JdPytj"

# Identity/node pubkeys (for validators_blocks)
IDENTITY_A = "8KpUxwq2HvTLzwhyCdHBRN3FKnDYmtmWxeAp9y6e4EQD"
IDENTITY_B = "APrcDPaRTKpJnENgeXd7n2VM62bveT8ij9kPsK8j7DyP"
IDENTITY_C = "Z9G7kfWQvnWBZvLbfLjqtR886H2WRyhPDNJ7xMuoNfE"
IDENTITY_D = "DmwBdGE5zjZQpEkoFEEFcEXwRrS8M4tejCqVRcQfGhB5"
IDENTITY_E = "77f9Bfn69eoaThPsZXjMWBcWhVkb8tXPKqpb47ZbTLZR"

# Stake accounts
STAKE_A1 = "29QLayKS7wGvstJQCkN7FBjt547LDfMk8Pf3mEjC9iMk"
STAKE_A2 = "CksA4kJhdXnmGxrDp3LXdMd5M1Zvh5bRrmURJdTDN21M"
STAKE_B1 = "31SDX6NCjj9FbCxLDDHV455QXfw2QG9YZmr9CzPtGFf4"
STAKE_B2 = "9JpBzCjW2b62yNsudH3kr3a6aKYaK2KxwZaaotttGjEV"
STAKE_C1 = "GnRaENDBX4v5REa5xZjEw1hniAAFrNYCYjxY8Xp3hziK"
STAKE_D1 = "BTchMX19vZJFhQ8Wga5EYwzqZCqUyqg2tgb3TYXDwQ7X"
STAKE_E1 = "9hw64jykT4ZvxCzmryU6K8XUwFj1ra3iLAqD32EJ1xB1"
STAKE_E2 = "DLeGZgDVWJULWdDcRiaYQ52AcBL3GZio86TRGTgG5Qjb"

# Institutional staker authorities (use known valid keys from existing test fixtures)
INST_STAKER_AUTH = "STNi1NHDUi6Hvibvonawgze8fM83PFLeJhuGMEXyGps"
INST_WITHDRAWER = "2tdyKn8fzKADQCdPbdoqmRw3t7gpJnuDZUEGBTuHLBpU"

# Withdraw authority for marinade stakers
MARINADE_WITHDRAW = "8KgMejEmFWsFq4sEUDcw4njrYYxfUMBntdPA9WPRpyAr"

# Non-whitelisted authority
NON_WL_AUTH = "3WCgSBRsWnpitayjCWne9DEBEcVHBeXXPdCr7ah5uVD4"

# --- Stake amounts ---
# 1000 SOL = 1_000_000_000_000 lamports
SOL = 1_000_000_000

STAKE_A1_AMOUNT = 50_000 * SOL  # 50k SOL
STAKE_A2_AMOUNT = 30_000 * SOL  # 30k SOL
STAKE_B1_AMOUNT = 40_000 * SOL  # 40k SOL
STAKE_B2_AMOUNT = 20_000 * SOL  # 20k SOL
STAKE_C1_AMOUNT = 60_000 * SOL  # 60k SOL
STAKE_D1_AMOUNT = 25_000 * SOL  # 25k SOL (non-whitelisted, won't get SAM settlements)
STAKE_E1_AMOUNT = 100_000 * SOL  # 100k SOL (institutional)
STAKE_E2_AMOUNT = 50_000 * SOL  # 50k SOL (institutional)

# Total stakes per validator (for validator_metas)
TOTAL_STAKE_A = STAKE_A1_AMOUNT + STAKE_A2_AMOUNT  # 80k SOL
TOTAL_STAKE_B = STAKE_B1_AMOUNT + STAKE_B2_AMOUNT  # 60k SOL
TOTAL_STAKE_C = STAKE_C1_AMOUNT  # 60k SOL
TOTAL_STAKE_D = STAKE_D1_AMOUNT  # 25k SOL
TOTAL_STAKE_E = STAKE_E1_AMOUNT + STAKE_E2_AMOUNT  # 150k SOL

# Credits
EXPECTED_CREDITS = 6_800_000  # Normal expected credits for an epoch
CREDITS_A = 6_800_000  # Normal
CREDITS_B = 5_000_000  # ~26% downtime (triggers DowntimeRevenueImpact > 1% grace)
CREDITS_C = 6_800_000  # Normal credits (commission increase triggers CommissionSamIncrease)
CREDITS_D = 6_800_000  # Normal
CREDITS_E = 6_800_000  # Normal

# Commissions (0 = no commission)
COMMISSION_A = 0
COMMISSION_B = 0
COMMISSION_C = 5  # 5% commission (increased from expected 0%)
COMMISSION_D = 0
COMMISSION_E = 0

# MEV commissions (None or a value)
MEV_COMMISSION_A = 0
MEV_COMMISSION_B = 0
MEV_COMMISSION_C = 800  # 8% MEV commission in bps (increased from expected 0%)
MEV_COMMISSION_D = 0
MEV_COMMISSION_E = 0

# --- Reward amounts ---
# Approximate rewards per validator for one epoch
INFLATION_REWARD_PER_SOL = 100  # ~100 lamports per SOL per epoch (simplified)
MEV_REWARD_PER_SOL = 50


# ============================================================================
# Data generation functions
# ============================================================================

def generate_stakes_json():
    """Generate StakeMetaCollection (stakes.json)"""
    stake_metas = [
        # Validator A - two stake accounts with whitelisted authority
        {
            "pubkey": STAKE_A1,
            "balance_lamports": STAKE_A1_AMOUNT + 2 * SOL,
            "active_delegation_lamports": STAKE_A1_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_A,
            "stake_authority": WHITELIST_STAKE_AUTHORITIES[0],
            "withdraw_authority": MARINADE_WITHDRAW,
        },
        {
            "pubkey": STAKE_A2,
            "balance_lamports": STAKE_A2_AMOUNT + SOL,
            "active_delegation_lamports": STAKE_A2_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_A,
            "stake_authority": WHITELIST_STAKE_AUTHORITIES[0],
            "withdraw_authority": MARINADE_WITHDRAW,
        },
        # Validator B - two stake accounts with whitelisted authority
        {
            "pubkey": STAKE_B1,
            "balance_lamports": STAKE_B1_AMOUNT + 2 * SOL,
            "active_delegation_lamports": STAKE_B1_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_B,
            "stake_authority": WHITELIST_STAKE_AUTHORITIES[1],
            "withdraw_authority": MARINADE_WITHDRAW,
        },
        {
            "pubkey": STAKE_B2,
            "balance_lamports": STAKE_B2_AMOUNT + SOL,
            "active_delegation_lamports": STAKE_B2_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_B,
            "stake_authority": WHITELIST_STAKE_AUTHORITIES[1],
            "withdraw_authority": MARINADE_WITHDRAW,
        },
        # Validator C - one stake account with whitelisted authority
        {
            "pubkey": STAKE_C1,
            "balance_lamports": STAKE_C1_AMOUNT + 2 * SOL,
            "active_delegation_lamports": STAKE_C1_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_C,
            "stake_authority": WHITELIST_STAKE_AUTHORITIES[2],
            "withdraw_authority": MARINADE_WITHDRAW,
        },
        # Validator D - non-whitelisted authority (won't get SAM settlements)
        {
            "pubkey": STAKE_D1,
            "balance_lamports": STAKE_D1_AMOUNT + SOL,
            "active_delegation_lamports": STAKE_D1_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_D,
            "stake_authority": NON_WL_AUTH,
            "withdraw_authority": NON_WL_AUTH,
        },
        # Validator E - institutional staker authority
        {
            "pubkey": STAKE_E1,
            "balance_lamports": STAKE_E1_AMOUNT + 3 * SOL,
            "active_delegation_lamports": STAKE_E1_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_E,
            "stake_authority": INST_STAKER_AUTH,
            "withdraw_authority": INST_WITHDRAWER,
        },
        {
            "pubkey": STAKE_E2,
            "balance_lamports": STAKE_E2_AMOUNT + SOL,
            "active_delegation_lamports": STAKE_E2_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_E,
            "stake_authority": INST_STAKER_AUTH,
            "withdraw_authority": INST_WITHDRAWER,
        },
    ]
    return {
        "epoch": EPOCH,
        "slot": SLOT,
        "stake_metas": stake_metas,
    }


def generate_sam_scores_json():
    """Generate SAM scores (sam-scores.json) - Vec<ValidatorSamMeta> in camelCase"""
    scores = [
        # Validator A: Normal bidder
        {
            "voteAccount": VOTE_A,
            "marinadeSamTargetSol": 80000,
            "revShare": {
                "totalPmpe": 1.0,
                "inflationPmpe": 0.3,
                "mevPmpe": 0.0,
                "bidPmpe": 0.7,
                "auctionEffectiveBidPmpe": 0.035,
                "bidTooLowPenaltyPmpe": 0,
                "blacklistPenaltyPmpe": 0,
                "effParticipatingBidPmpe": 0.035,
                "expectedMaxEffBidPmpe": 0.04,
                "blockPmpe": 0.0,
                "onchainDistributedPmpe": 0.0,
                "bondObligationPmpe": 0.0,
                "auctionEffectiveStaticBidPmpe": 0.03,
            },
            "stakePriority": 5,
            "unstakePriority": 95,
            "maxStakeWanted": 400000,
            "effectiveBid": 0.035,
            "constraints": "",
            "metadata": {
                "scoringId": "test-scoring-1",
                "tvl": {"marinadeSamTvlSol": 80000},
            },
            "scoringRunId": 1,
            "epoch": EPOCH,
            "values": {
                "bondBalanceSol": 100,
                "marinade_activated_stake_sol": 80000,
                "marinadeActivatedStakeSol": 80000,
                "bondRiskFeeSol": 0.5,
                "paidUndelegationSol": 0,
                "samBlacklisted": False,
                "commissions": {
                    "inflationCommissionDec": 0.0,
                    "mevCommissionDec": 0.0,
                    "blockRewardsCommissionDec": 0.0,
                    "inflationCommissionOnchainDec": 0.0,
                    "inflationCommissionInBondDec": 0.0,
                    "inflationCommissionOverrideDec": None,
                    "mevCommissionOnchainDec": 0.0,
                    "mevCommissionInBondDec": 0.0,
                    "mevCommissionOverrideDec": None,
                    "blockRewardsCommissionInBondDec": 0.0,
                    "blockRewardsCommissionOverrideDec": None,
                },
            },
        },
        # Validator B: Bidder with downtime
        {
            "voteAccount": VOTE_B,
            "marinadeSamTargetSol": 60000,
            "revShare": {
                "totalPmpe": 0.8,
                "inflationPmpe": 0.3,
                "mevPmpe": 0.0,
                "bidPmpe": 0.5,
                "auctionEffectiveBidPmpe": 0.025,
                "bidTooLowPenaltyPmpe": 0,
                "blacklistPenaltyPmpe": 0,
                "effParticipatingBidPmpe": 0.025,
                "expectedMaxEffBidPmpe": 0.035,
                "blockPmpe": 0.0,
                "onchainDistributedPmpe": 0.0,
                "bondObligationPmpe": 0.0,
                "auctionEffectiveStaticBidPmpe": 0.02,
            },
            "stakePriority": 8,
            "unstakePriority": 92,
            "maxStakeWanted": 300000,
            "effectiveBid": 0.025,
            "constraints": "",
            "metadata": {
                "scoringId": "test-scoring-2",
                "tvl": {"marinadeSamTvlSol": 60000},
            },
            "scoringRunId": 1,
            "epoch": EPOCH,
            "values": {
                "bondBalanceSol": 80,
                "marinade_activated_stake_sol": 60000,
                "marinadeActivatedStakeSol": 60000,
                "bondRiskFeeSol": 0.3,
                "paidUndelegationSol": 0,
                "samBlacklisted": False,
                "commissions": {
                    "inflationCommissionDec": 0.0,
                    "mevCommissionDec": 0.0,
                    "blockRewardsCommissionDec": 0.0,
                    "inflationCommissionOnchainDec": 0.0,
                    "inflationCommissionInBondDec": 0.0,
                    "inflationCommissionOverrideDec": None,
                    "mevCommissionOnchainDec": 0.0,
                    "mevCommissionInBondDec": 0.0,
                    "mevCommissionOverrideDec": None,
                    "blockRewardsCommissionInBondDec": 0.0,
                    "blockRewardsCommissionOverrideDec": None,
                },
            },
        },
        # Validator C: Commission increase
        {
            "voteAccount": VOTE_C,
            "marinadeSamTargetSol": 60000,
            "revShare": {
                "totalPmpe": 0.6,
                "inflationPmpe": 0.3,
                "mevPmpe": 0.0,
                "bidPmpe": 0.3,
                "auctionEffectiveBidPmpe": 0.015,
                "bidTooLowPenaltyPmpe": 0,
                "blacklistPenaltyPmpe": 0,
                "effParticipatingBidPmpe": 0.015,
                "expectedMaxEffBidPmpe": 0.02,
                "blockPmpe": 0.0,
                "onchainDistributedPmpe": 0.0,
                "bondObligationPmpe": 0.0,
                "auctionEffectiveStaticBidPmpe": 0.012,
            },
            "stakePriority": 12,
            "unstakePriority": 88,
            "maxStakeWanted": 200000,
            "effectiveBid": 0.015,
            "constraints": "",
            "metadata": {
                "scoringId": "test-scoring-3",
                "tvl": {"marinadeSamTvlSol": 60000},
            },
            "scoringRunId": 1,
            "epoch": EPOCH,
            "values": {
                "bondBalanceSol": 50,
                "marinade_activated_stake_sol": 60000,
                "marinadeActivatedStakeSol": 60000,
                "bondRiskFeeSol": 0.2,
                "paidUndelegationSol": 0,
                "samBlacklisted": False,
                "commissions": {
                    "inflationCommissionDec": 0.0,
                    "mevCommissionDec": 0.0,
                    "blockRewardsCommissionDec": 0.0,
                    "inflationCommissionOnchainDec": 0.05,  # Increased to 5% on-chain
                    "inflationCommissionInBondDec": 0.0,
                    "inflationCommissionOverrideDec": None,
                    "mevCommissionOnchainDec": 0.08,  # Increased to 8% on-chain
                    "mevCommissionInBondDec": 0.0,
                    "mevCommissionOverrideDec": None,
                    "blockRewardsCommissionInBondDec": 0.0,
                    "blockRewardsCommissionOverrideDec": None,
                },
            },
        },
    ]
    return scores


def generate_validators_json():
    """Generate ValidatorMetaCollection (validators.json)"""
    # total stake across all validators (for computing expected credits)
    total_capitalization = 600_000_000 * SOL  # 600M SOL approx
    total_validator_rewards = 137_000_000 * SOL  # simplified
    epoch_duration_years = 0.005476  # ~2 days

    validator_metas = [
        {
            "vote_account": VOTE_A,
            "commission": COMMISSION_A,
            "mev_commission": MEV_COMMISSION_A,
            "jito_priority_fee_commission": None,
            "jito_priority_fee_lamports": 0,
            "stake": TOTAL_STAKE_A,
            "credits": CREDITS_A,
        },
        {
            "vote_account": VOTE_B,
            "commission": COMMISSION_B,
            "mev_commission": MEV_COMMISSION_B,
            "jito_priority_fee_commission": None,
            "jito_priority_fee_lamports": 0,
            "stake": TOTAL_STAKE_B,
            "credits": CREDITS_B,  # Reduced! Triggers DowntimeRevenueImpact
        },
        {
            "vote_account": VOTE_C,
            "commission": COMMISSION_C,
            "mev_commission": MEV_COMMISSION_C,
            "jito_priority_fee_commission": None,
            "jito_priority_fee_lamports": 0,
            "stake": TOTAL_STAKE_C,
            "credits": CREDITS_C,
        },
        {
            "vote_account": VOTE_D,
            "commission": COMMISSION_D,
            "mev_commission": MEV_COMMISSION_D,
            "jito_priority_fee_commission": None,
            "jito_priority_fee_lamports": 0,
            "stake": TOTAL_STAKE_D,
            "credits": CREDITS_D,
        },
        {
            "vote_account": VOTE_E,
            "commission": COMMISSION_E,
            "mev_commission": MEV_COMMISSION_E,
            "jito_priority_fee_commission": None,
            "jito_priority_fee_lamports": 0,
            "stake": TOTAL_STAKE_E,
            "credits": CREDITS_E,
        },
    ]
    return {
        "epoch": EPOCH,
        "slot": SLOT,
        "capitalization": total_capitalization,
        "epoch_duration_in_years": epoch_duration_years,
        "validator_rate": 0.04039,
        "validator_rewards": total_validator_rewards,
        "validator_metas": validator_metas,
    }


def generate_evaluation_json():
    """Generate RevenueExpectationMetaCollection (evaluation.json) in camelCase"""
    # Expected EPR ~0.3234 per 1000 SOL per epoch (typical non-bid revenue)
    expected_non_bid_pmpe = 0.3234
    # For validator B: actual is lower due to downtime
    # uptime_B = 5000000/6800000 = ~0.7353
    # actual_non_bid_pmpe_B = expected * uptime = 0.3234 * 0.7353 = ~0.2378
    actual_non_bid_pmpe_B = expected_non_bid_pmpe * (CREDITS_B / EXPECTED_CREDITS)

    # For validator C: commission increase causes loss
    # Commission goes from 0% to 5% inflation, 0% to 8% MEV
    # before_sam_commission_increase_pmpe represents the extra revenue expected
    # that was lost due to commission increase
    before_sam_commission_increase_pmpe_C = 0.05  # Extra expected revenue before increase

    revenue_expectations = [
        {
            "voteAccount": VOTE_A,
            "expectedInflationCommission": 0.0,
            "actualInflationCommission": 0.0,
            "pastInflationCommission": 0.0,
            "expectedMevCommission": 0.0,
            "actualMevCommission": 0.0,
            "pastMevCommission": None,
            "expectedNonBidPmpe": expected_non_bid_pmpe,
            "actualNonBidPmpe": expected_non_bid_pmpe,  # No loss
            "expectedSamPmpe": expected_non_bid_pmpe + 0.035,
            "beforeSamCommissionIncreasePmpe": 0.0,
            "maxSamStake": 80000,
            "samStakeShare": 1.0,
            "lossPerStake": 0.0,
        },
        {
            "voteAccount": VOTE_B,
            "expectedInflationCommission": 0.0,
            "actualInflationCommission": 0.0,
            "pastInflationCommission": 0.0,
            "expectedMevCommission": 0.0,
            "actualMevCommission": 0.0,
            "pastMevCommission": None,
            "expectedNonBidPmpe": expected_non_bid_pmpe,
            "actualNonBidPmpe": round(actual_non_bid_pmpe_B, 16),  # Reduced due to downtime
            "expectedSamPmpe": expected_non_bid_pmpe + 0.025,
            "beforeSamCommissionIncreasePmpe": 0.0,
            "maxSamStake": 60000,
            "samStakeShare": 1.0,
            "lossPerStake": 0.0,
        },
        {
            "voteAccount": VOTE_C,
            "expectedInflationCommission": 0.0,
            "actualInflationCommission": 0.05,  # Increased to 5%
            "pastInflationCommission": 0.0,
            "expectedMevCommission": 0.0,
            "actualMevCommission": 0.08,  # Increased to 8%
            "pastMevCommission": None,
            "expectedNonBidPmpe": expected_non_bid_pmpe,
            # Actual is reduced due to commission increase
            "actualNonBidPmpe": expected_non_bid_pmpe * 0.92,  # ~8% loss from commission
            "expectedSamPmpe": expected_non_bid_pmpe + 0.015,
            "beforeSamCommissionIncreasePmpe": before_sam_commission_increase_pmpe_C,
            "maxSamStake": 60000,
            "samStakeShare": 1.0,
            "lossPerStake": 0.0,
        },
        {
            "voteAccount": VOTE_D,
            "expectedInflationCommission": 0.0,
            "actualInflationCommission": 0.0,
            "pastInflationCommission": 0.0,
            "expectedMevCommission": 0.0,
            "actualMevCommission": 0.0,
            "pastMevCommission": None,
            "expectedNonBidPmpe": expected_non_bid_pmpe,
            "actualNonBidPmpe": expected_non_bid_pmpe,
            "expectedSamPmpe": expected_non_bid_pmpe,
            "beforeSamCommissionIncreasePmpe": 0.0,
            "maxSamStake": None,
            "samStakeShare": 0.0,
            "lossPerStake": 0.0,
        },
        {
            "voteAccount": VOTE_E,
            "expectedInflationCommission": 0.0,
            "actualInflationCommission": 0.0,
            "pastInflationCommission": 0.0,
            "expectedMevCommission": 0.0,
            "actualMevCommission": 0.0,
            "pastMevCommission": None,
            "expectedNonBidPmpe": expected_non_bid_pmpe,
            "actualNonBidPmpe": expected_non_bid_pmpe,
            "expectedSamPmpe": expected_non_bid_pmpe,
            "beforeSamCommissionIncreasePmpe": 0.0,
            "maxSamStake": None,
            "samStakeShare": 0.0,
            "lossPerStake": 0.0,
        },
    ]
    return {
        "epoch": EPOCH,
        "slot": SLOT,
        "revenueExpectations": revenue_expectations,
    }


def generate_rewards_inflation():
    """Generate inflation rewards per stake account (rewards/inflation.json)"""
    rewards = []
    # Simplified: reward proportional to stake
    for stake_pubkey, amount, vote in [
        (STAKE_A1, int(STAKE_A1_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_A),
        (STAKE_A2, int(STAKE_A2_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_A),
        (STAKE_B1, int(STAKE_B1_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_B),
        (STAKE_B2, int(STAKE_B2_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_B),
        (STAKE_C1, int(STAKE_C1_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_C),
        (STAKE_D1, int(STAKE_D1_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_D),
        (STAKE_E1, int(STAKE_E1_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_E),
        (STAKE_E2, int(STAKE_E2_AMOUNT * INFLATION_REWARD_PER_SOL / SOL), VOTE_E),
    ]:
        rewards.append({
            "epoch": EPOCH,
            "stake_account": stake_pubkey,
            "amount": str(amount),
        })
    return rewards


def generate_rewards_mev():
    """Generate MEV rewards per stake account (rewards/mev.json)"""
    rewards = []
    for stake_pubkey, amount in [
        (STAKE_A1, int(STAKE_A1_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
        (STAKE_A2, int(STAKE_A2_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
        (STAKE_B1, int(STAKE_B1_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
        (STAKE_B2, int(STAKE_B2_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
        (STAKE_C1, int(STAKE_C1_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
        (STAKE_D1, int(STAKE_D1_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
        (STAKE_E1, int(STAKE_E1_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
        (STAKE_E2, int(STAKE_E2_AMOUNT * MEV_REWARD_PER_SOL / SOL)),
    ]:
        rewards.append({
            "epoch": EPOCH,
            "stake_account": stake_pubkey,
            "amount": str(amount),
        })
    return rewards


def generate_rewards_jito_priority_fee():
    """Generate Jito priority fee rewards (rewards/jito_priority_fee.json)"""
    # Simplified: small amounts
    rewards = []
    for stake_pubkey, amount in [
        (STAKE_A1, 500000),
        (STAKE_A2, 300000),
        (STAKE_B1, 400000),
        (STAKE_B2, 200000),
        (STAKE_C1, 600000),
        (STAKE_D1, 250000),
        (STAKE_E1, 1000000),
        (STAKE_E2, 500000),
    ]:
        rewards.append({
            "epoch": EPOCH,
            "stake_account": stake_pubkey,
            "amount": str(amount),
        })
    return rewards


def generate_validators_inflation():
    """Generate validator inflation rewards (rewards/validators_inflation.json)"""
    rewards = []
    for vote, total_stake in [
        (VOTE_A, TOTAL_STAKE_A),
        (VOTE_B, TOTAL_STAKE_B),
        (VOTE_C, TOTAL_STAKE_C),
        (VOTE_D, TOTAL_STAKE_D),
        (VOTE_E, TOTAL_STAKE_E),
    ]:
        # Validator commission share of inflation rewards
        amount = int(total_stake * INFLATION_REWARD_PER_SOL / SOL * 0.05)  # ~5% of total
        rewards.append({
            "epoch": EPOCH,
            "vote_account": vote,
            "amount": str(amount),
        })
    return rewards


def generate_validators_mev():
    """Generate validator MEV rewards (rewards/validators_mev.json)"""
    rewards = []
    for vote, total_stake in [
        (VOTE_A, TOTAL_STAKE_A),
        (VOTE_B, TOTAL_STAKE_B),
        (VOTE_C, TOTAL_STAKE_C),
        (VOTE_D, TOTAL_STAKE_D),
        (VOTE_E, TOTAL_STAKE_E),
    ]:
        amount = int(total_stake * MEV_REWARD_PER_SOL / SOL * 0.05)
        rewards.append({
            "epoch": EPOCH,
            "vote_account": vote,
            "amount": str(amount),
        })
    return rewards


def generate_validators_blocks():
    """Generate validator block rewards (rewards/validators_blocks.json)"""
    rewards = []
    for vote, identity, total_stake in [
        (VOTE_A, IDENTITY_A, TOTAL_STAKE_A),
        (VOTE_B, IDENTITY_B, TOTAL_STAKE_B),
        (VOTE_C, IDENTITY_C, TOTAL_STAKE_C),
        (VOTE_D, IDENTITY_D, TOTAL_STAKE_D),
        (VOTE_E, IDENTITY_E, TOTAL_STAKE_E),
    ]:
        amount = int(total_stake * 30 / SOL)  # Block rewards ~30 lamports/SOL
        rewards.append({
            "epoch": EPOCH,
            "identity_account": identity,
            "node_pubkey": identity,
            "authorized_voter": identity,
            "vote_account": vote,
            "amount": str(amount),
        })
    return rewards


def generate_institutional_payouts():
    """Generate InstitutionalPayout (institutional/institutional-payouts.json)"""
    return {
        "epoch": EPOCH,
        "slot": str(SLOT),
        "config": {
            "stakerAuthorityFilter": [
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                "11111111111111111111111111111111",
                INST_STAKER_AUTH,
            ],
            "psrPercentile": 99,
            "psrGraceDowntimeBps": 10,
            "validatorMaxFeeBps": 50,
            "distributorFeeBps": 50,
        },
        "institutionalValidators": {
            "validators": [
                {
                    "name": "Test Institutional 1",
                    "vote_pubkey": VOTE_E,
                },
            ],
        },
        "distributorFeeBps": 50,
        "validatorMaxFeeBps": 50,
        "institutionalStakerAuthorities": [
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "11111111111111111111111111111111",
            INST_STAKER_AUTH,
        ],
        "psrPercentileData": {
            "psrPercentile": 99,
            "psrPercentileApy": "0.33190664386139242231",
            "psrPercentileEffectiveStake": str(481_330 * SOL),
            "psrGraceDowntimeBps": 10,
        },
        "payoutStakers": [
            {
                "voteAccount": VOTE_E,
                "stakeAccounts": [
                    {"address": STAKE_E1, "effectiveStake": str(STAKE_E1_AMOUNT)},
                    {"address": STAKE_E2, "effectiveStake": str(STAKE_E2_AMOUNT)},
                ],
                "staker": INST_STAKER_AUTH,
                "withdrawer": INST_WITHDRAWER,
                "activeStake": str(STAKE_E1_AMOUNT + STAKE_E2_AMOUNT),
                "activatingStake": "0",
                "deactivatingStake": "0",
                "effectiveStake": str(STAKE_E1_AMOUNT + STAKE_E2_AMOUNT),
                "balanceLamports": str(STAKE_E1_AMOUNT + STAKE_E2_AMOUNT + 4 * SOL),
                "shareInstitutional": 1,
                "shareDeactivation": 0,
                "effectivePayoutLamports": str(15_000_000),  # 0.015 SOL payout to staker
                "deactivatingPayoutLamports": "0",
                "payoutLamports": str(15_000_000),
            },
        ],
        "payoutDistributors": [
            {
                "voteAccount": VOTE_E,
                "stakeAccounts": [
                    {"address": STAKE_E1, "effectiveStake": str(STAKE_E1_AMOUNT)},
                    {"address": STAKE_E2, "effectiveStake": str(STAKE_E2_AMOUNT)},
                ],
                "payoutLamports": str(750_000),  # Distributor fee
            },
        ],
        "validators": [
            {
                "voteAccount": VOTE_E,
                "stakedAmounts": {
                    "voteAccount": VOTE_E,
                    "stakeAccounts": [
                        {"address": STAKE_E1, "effectiveStake": str(STAKE_E1_AMOUNT)},
                        {"address": STAKE_E2, "effectiveStake": str(STAKE_E2_AMOUNT)},
                    ],
                    "totalActive": str(TOTAL_STAKE_E),
                    "totalActivating": "0",
                    "totalDeactivating": "0",
                    "totalEffective": str(TOTAL_STAKE_E),
                    "institutionalActive": str(TOTAL_STAKE_E),
                    "institutionalActivating": "0",
                    "institutionalDeactivating": "0",
                    "institutionalEffective": str(TOTAL_STAKE_E),
                },
                "validatorRewards": "510000",
                "stakersInflationRewards": "8500000",
                "stakersMevRewards": "4200000",
                "stakersRewards": "12700000",
                "totalRewards": "13210000",
                "isInstitutional": True,
                "name": "Test Institutional 1",
                "apy": "0.3351098545862417967",
                "institutionalStakedRatio": "1",
                "apyPercentileDiff": "0.00320321072484937439",
                "commission": COMMISSION_E,
                "mevCommission": None,
                "credits": str(CREDITS_E),
                "uptime": "1.3987038626875478458",
                "uptimeDeviationBps": "-3987.0386268754784581",
            },
            # Include a non-institutional validator for coverage
            {
                "voteAccount": VOTE_A,
                "stakedAmounts": {
                    "voteAccount": VOTE_A,
                    "stakeAccounts": [],
                    "totalActive": str(TOTAL_STAKE_A),
                    "totalActivating": "0",
                    "totalDeactivating": "0",
                    "totalEffective": str(TOTAL_STAKE_A),
                    "institutionalActive": "0",
                    "institutionalActivating": "0",
                    "institutionalDeactivating": "0",
                    "institutionalEffective": "0",
                },
                "validatorRewards": "22",
                "stakersInflationRewards": "936000",
                "stakersMevRewards": "424000",
                "stakersRewards": "1360000",
                "totalRewards": "1360022",
                "isInstitutional": False,
                "name": None,
                "apy": "0.2817230091720860017",
                "institutionalStakedRatio": "0",
                "apyPercentileDiff": "-0.05018363468930642061",
                "commission": COMMISSION_A,
                "mevCommission": None,
                "credits": str(CREDITS_A),
                "uptime": "1.3987038626875478458",
                "uptimeDeviationBps": "-3987.0386268754784581",
            },
        ],
        "validatorPayoutInfo": [
            {
                "voteAccount": VOTE_E,
                "isInstitutional": True,
                "stakeAccounts": [
                    {"address": STAKE_E1, "effectiveStake": str(STAKE_E1_AMOUNT)},
                    {"address": STAKE_E2, "effectiveStake": str(STAKE_E2_AMOUNT)},
                ],
                "payoutType": "institutional",
                "distributorFeeLamports": str(750_000),
                "validatorFeeLamports": str(750_000),
                "distributeToStakersLamports": str(15_000_000),
                "psrFeeLamports": "0",
            },
        ],
    }


def generate_institutional_stakes():
    """Generate StakeMetaCollection for institutional (institutional/stakes.json)
    This is a snapshot-based stakes file, same format as the bid-distribution one.
    """
    # For institutional, we need stake accounts that match the institutional payouts
    stake_metas = [
        {
            "pubkey": STAKE_E1,
            "balance_lamports": STAKE_E1_AMOUNT + 3 * SOL,
            "active_delegation_lamports": STAKE_E1_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_E,
            "stake_authority": INST_STAKER_AUTH,
            "withdraw_authority": INST_WITHDRAWER,
        },
        {
            "pubkey": STAKE_E2,
            "balance_lamports": STAKE_E2_AMOUNT + SOL,
            "active_delegation_lamports": STAKE_E2_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_E,
            "stake_authority": INST_STAKER_AUTH,
            "withdraw_authority": INST_WITHDRAWER,
        },
        # Include some other stake accounts for other validators
        {
            "pubkey": STAKE_A1,
            "balance_lamports": STAKE_A1_AMOUNT + 2 * SOL,
            "active_delegation_lamports": STAKE_A1_AMOUNT,
            "activating_delegation_lamports": 0,
            "deactivating_delegation_lamports": 0,
            "validator": VOTE_A,
            "stake_authority": WHITELIST_STAKE_AUTHORITIES[0],
            "withdraw_authority": MARINADE_WITHDRAW,
        },
    ]
    return {
        "epoch": EPOCH,
        "slot": SLOT,
        "stake_metas": stake_metas,
    }


# ============================================================================
# Main
# ============================================================================

def write_json(data, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Written: {path}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate fabricated test input data for settlement regression testing"
    )
    parser.add_argument(
        "--output-dir",
        default="./regression-data/99999/inputs",
        help="Output directory for the generated data (default: ./regression-data/99999/inputs)",
    )
    args = parser.parse_args()
    out = args.output_dir

    print(f"Generating fabricated test data for epoch {EPOCH}...")
    print(f"Output directory: {out}")
    print()

    # Bid distribution inputs
    print("Bid distribution inputs:")
    write_json(generate_stakes_json(), os.path.join(out, "stakes.json"))
    write_json(generate_sam_scores_json(), os.path.join(out, "sam-scores.json"))
    write_json(generate_validators_json(), os.path.join(out, "validators.json"))
    write_json(generate_evaluation_json(), os.path.join(out, "evaluation.json"))

    # Rewards
    print("\nRewards:")
    rewards_dir = os.path.join(out, "rewards")
    write_json(generate_rewards_inflation(), os.path.join(rewards_dir, "inflation.json"))
    write_json(generate_rewards_mev(), os.path.join(rewards_dir, "mev.json"))
    write_json(generate_rewards_jito_priority_fee(), os.path.join(rewards_dir, "jito_priority_fee.json"))
    write_json(generate_validators_inflation(), os.path.join(rewards_dir, "validators_inflation.json"))
    write_json(generate_validators_mev(), os.path.join(rewards_dir, "validators_mev.json"))
    write_json(generate_validators_blocks(), os.path.join(rewards_dir, "validators_blocks.json"))

    # Institutional inputs
    print("\nInstitutional inputs:")
    inst_dir = os.path.join(out, "institutional")
    write_json(generate_institutional_payouts(), os.path.join(inst_dir, "institutional-payouts.json"))
    write_json(generate_institutional_stakes(), os.path.join(inst_dir, "stakes.json"))

    print()
    print("=" * 60)
    print("Data generation complete!")
    print()
    print("Test scenario summary:")
    print(f"  Epoch: {EPOCH}")
    print(f"  Validator A ({VOTE_A[:20]}...): SAM bidder only -> Bidding settlement")
    print(f"  Validator B ({VOTE_B[:20]}...): SAM + downtime -> Bidding + DowntimeRevenueImpact")
    print(f"  Validator C ({VOTE_C[:20]}...): SAM + commission increase -> Bidding + CommissionSamIncrease")
    print(f"  Validator D ({VOTE_D[:20]}...): No SAM bid -> No settlements")
    print(f"  Validator E ({VOTE_E[:20]}...): Institutional -> InstitutionalPayout settlement")
    print()
    print("Next steps:")
    print("  1. Run generate-expected-outputs.sh to produce expected/ from main branch")
    print("  2. Run regression-test-settlements.sh on current branch to produce actual/ and compare")


if __name__ == "__main__":
    main()
