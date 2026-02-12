#!/usr/bin/env python3
"""
Generate fabricated but valid test input data for the settlement distribution pipeline.

Generates internally consistent data for one or more epochs with varying validator
counts, stake amounts, bid rates, downtime severity, and commission changes.
Each epoch uses deterministic randomness (seeded by epoch number) so results are
reproducible.

Usage:
  # Single epoch (original behavior):
  python3 scripts/generate-fabricated-test-data.py --epoch 99999

  # Range of 50 epochs:
  python3 scripts/generate-fabricated-test-data.py --start-epoch 99900 --end-epoch 99950

  # Custom output root:
  python3 scripts/generate-fabricated-test-data.py --start-epoch 99900 --end-epoch 99950 \\
      --output-root ./regression-data-fabricated
"""
import argparse
import hashlib
import json
import os
import random as _random_module
import sys

# ============================================================================
# Constants (same across all epochs)
# ============================================================================
SOL = 1_000_000_000  # lamports per SOL

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

BID_BONDS_CONFIG = "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU"
INST_BONDS_CONFIG = "VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE"

# Known valid authorities reused across epochs
INST_STAKER_AUTH = "STNi1NHDUi6Hvibvonawgze8fM83PFLeJhuGMEXyGps"

EXPECTED_CREDITS = 6_800_000  # Normal expected credits for an epoch


# ============================================================================
# Pubkey generation (deterministic, valid 32-byte base58)
# ============================================================================

try:
    import base58 as _base58
    def _make_pubkey(seed: str) -> str:
        return _base58.b58encode(hashlib.sha256(seed.encode()).digest()).decode()
except ImportError:
    # Fallback: inline minimal base58 encoder (no external dependency)
    _B58_ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    def _make_pubkey(seed: str) -> str:
        data = hashlib.sha256(seed.encode()).digest()
        # Convert bytes to integer
        n = int.from_bytes(data, "big")
        result = bytearray()
        while n > 0:
            n, r = divmod(n, 58)
            result.append(_B58_ALPHABET[r])
        # Preserve leading zero bytes
        for b in data:
            if b == 0:
                result.append(_B58_ALPHABET[0])
            else:
                break
        return bytes(reversed(result)).decode()


def make_pubkey(role: str, epoch: int, index: int = 0) -> str:
    """Generate a deterministic valid Solana pubkey from role/epoch/index."""
    return _make_pubkey(f"{role}-{epoch}-{index}")


# ============================================================================
# Per-epoch validator scenario definition
# ============================================================================

class ValidatorScenario:
    """Describes one fabricated validator for a given epoch."""

    def __init__(self, epoch, rng, index, role):
        self.epoch = epoch
        self.index = index
        self.role = role  # "sam", "sam_downtime", "sam_commission", "passive", "institutional"

        # Generate unique pubkeys
        self.vote_account = make_pubkey("vote", epoch, index)
        self.identity = make_pubkey("identity", epoch, index)

        # Stake accounts: 1-3 per validator
        num_stakes = rng.randint(1, 3)
        self.stake_accounts = []
        for si in range(num_stakes):
            amount = rng.randint(10_000, 120_000) * SOL
            self.stake_accounts.append({
                "pubkey": make_pubkey("stake", epoch, index * 10 + si),
                "amount": amount,
            })

        self.total_stake = sum(s["amount"] for s in self.stake_accounts)

        # Assign whitelisted authority (rotate through the list)
        if role == "passive":
            self.stake_authority = make_pubkey("nonwl-auth", epoch, index)
            self.withdraw_authority = self.stake_authority
        elif role == "institutional":
            self.stake_authority = INST_STAKER_AUTH
            self.withdraw_authority = make_pubkey("inst-withdraw", epoch, index)
        else:
            self.stake_authority = WHITELIST_STAKE_AUTHORITIES[index % len(WHITELIST_STAKE_AUTHORITIES)]
            self.withdraw_authority = make_pubkey("marinade-withdraw", epoch, index)

        # SAM parameters (only for sam* roles)
        self.has_sam = role.startswith("sam")
        if self.has_sam:
            self.bid_pmpe = round(rng.uniform(0.2, 0.9), 4)
            self.static_bid_pmpe = round(self.bid_pmpe * rng.uniform(0.3, 0.6), 4)
            self.effective_bid = round(self.bid_pmpe * rng.uniform(0.4, 0.7), 4)
            self.total_pmpe = round(0.3 + self.bid_pmpe, 4)
        else:
            self.bid_pmpe = 0
            self.static_bid_pmpe = 0
            self.effective_bid = 0
            self.total_pmpe = 0

        # Credits (downtime scenario gets reduced credits)
        if role == "sam_downtime":
            # 5%-40% downtime (must be > 1% grace to trigger)
            downtime_fraction = rng.uniform(0.05, 0.40)
            self.credits = int(EXPECTED_CREDITS * (1.0 - downtime_fraction))
        else:
            self.credits = EXPECTED_CREDITS

        # Commissions
        if role == "sam_commission":
            self.inflation_commission = rng.choice([3, 5, 7, 10])  # percent
            self.mev_commission_bps = rng.choice([500, 800, 1000, 1500])
            self.inflation_commission_onchain = self.inflation_commission / 100.0
            self.mev_commission_onchain = self.mev_commission_bps / 10000.0
            self.before_sam_increase_pmpe = round(rng.uniform(0.02, 0.08), 4)
        else:
            self.inflation_commission = 0
            self.mev_commission_bps = 0
            self.inflation_commission_onchain = 0.0
            self.mev_commission_onchain = 0.0
            self.before_sam_increase_pmpe = 0.0

        # Institutional payout (only for institutional role)
        if role == "institutional":
            self.inst_payout_stakers = rng.randint(5_000_000, 50_000_000)
            self.inst_payout_distributor = rng.randint(200_000, 2_000_000)
        else:
            self.inst_payout_stakers = 0
            self.inst_payout_distributor = 0


def generate_epoch_scenarios(epoch, rng):
    """Generate a varied set of validator scenarios for one epoch."""
    # Decide how many of each type
    num_sam_only = rng.randint(1, 4)
    num_sam_downtime = rng.randint(0, 3)
    num_sam_commission = rng.randint(0, 2)
    num_passive = rng.randint(0, 2)
    num_institutional = rng.randint(0, 2)

    # Ensure at least one SAM bidder
    if num_sam_only + num_sam_downtime + num_sam_commission == 0:
        num_sam_only = 1

    scenarios = []
    idx = 0
    for _ in range(num_sam_only):
        scenarios.append(ValidatorScenario(epoch, rng, idx, "sam"))
        idx += 1
    for _ in range(num_sam_downtime):
        scenarios.append(ValidatorScenario(epoch, rng, idx, "sam_downtime"))
        idx += 1
    for _ in range(num_sam_commission):
        scenarios.append(ValidatorScenario(epoch, rng, idx, "sam_commission"))
        idx += 1
    for _ in range(num_passive):
        scenarios.append(ValidatorScenario(epoch, rng, idx, "passive"))
        idx += 1
    for _ in range(num_institutional):
        scenarios.append(ValidatorScenario(epoch, rng, idx, "institutional"))
        idx += 1

    return scenarios


# ============================================================================
# JSON generation from scenarios
# ============================================================================

def build_stakes_json(epoch, slot, scenarios):
    stake_metas = []
    for v in scenarios:
        for s in v.stake_accounts:
            stake_metas.append({
                "pubkey": s["pubkey"],
                "balance_lamports": s["amount"] + 2 * SOL,
                "active_delegation_lamports": s["amount"],
                "activating_delegation_lamports": 0,
                "deactivating_delegation_lamports": 0,
                "validator": v.vote_account,
                "stake_authority": v.stake_authority,
                "withdraw_authority": v.withdraw_authority,
            })
    return {"epoch": epoch, "slot": slot, "stake_metas": stake_metas}


def build_sam_scores_json(epoch, scenarios):
    scores = []
    for v in scenarios:
        if not v.has_sam:
            continue
        scores.append({
            "voteAccount": v.vote_account,
            "marinadeSamTargetSol": v.total_stake // SOL,
            "revShare": {
                "totalPmpe": v.total_pmpe,
                "inflationPmpe": 0.3,
                "mevPmpe": 0.0,
                "bidPmpe": v.bid_pmpe,
                "auctionEffectiveBidPmpe": v.effective_bid,
                "bidTooLowPenaltyPmpe": 0,
                "blacklistPenaltyPmpe": 0,
                "effParticipatingBidPmpe": v.effective_bid,
                "expectedMaxEffBidPmpe": round(v.effective_bid * 1.2, 4),
                "blockPmpe": 0.0,
                "onchainDistributedPmpe": 0.0,
                "bondObligationPmpe": 0.0,
                "auctionEffectiveStaticBidPmpe": v.static_bid_pmpe,
            },
            "stakePriority": v.index + 1,
            "unstakePriority": 100 - v.index,
            "maxStakeWanted": 400000,
            "effectiveBid": v.effective_bid,
            "constraints": "",
            "metadata": {
                "scoringId": f"test-scoring-{epoch}-{v.index}",
                "tvl": {"marinadeSamTvlSol": v.total_stake // SOL},
            },
            "scoringRunId": 1,
            "epoch": epoch,
            "values": {
                "bondBalanceSol": 100,
                "marinadeActivatedStakeSol": v.total_stake // SOL,
                "bondRiskFeeSol": 0.5,
                "paidUndelegationSol": 0,
                "samBlacklisted": False,
                "commissions": {
                    "inflationCommissionDec": 0.0,
                    "mevCommissionDec": 0.0,
                    "blockRewardsCommissionDec": 0.0,
                    "inflationCommissionOnchainDec": v.inflation_commission_onchain,
                    "inflationCommissionInBondDec": 0.0,
                    "inflationCommissionOverrideDec": None,
                    "mevCommissionOnchainDec": v.mev_commission_onchain,
                    "mevCommissionInBondDec": 0.0,
                    "mevCommissionOverrideDec": None,
                    "blockRewardsCommissionInBondDec": 0.0,
                    "blockRewardsCommissionOverrideDec": None,
                },
            },
        })
    return scores


def build_validators_json(epoch, slot, scenarios):
    validator_metas = []
    for v in scenarios:
        validator_metas.append({
            "vote_account": v.vote_account,
            "commission": v.inflation_commission,
            "mev_commission": v.mev_commission_bps,
            "jito_priority_fee_commission": None,
            "jito_priority_fee_lamports": 0,
            "stake": v.total_stake,
            "credits": v.credits,
        })
    return {
        "epoch": epoch,
        "slot": slot,
        "capitalization": 600_000_000 * SOL,
        "epoch_duration_in_years": 0.005476,
        "validator_rate": 0.04039,
        "validator_rewards": 137_000_000 * SOL,
        "validator_metas": validator_metas,
    }


def build_evaluation_json(epoch, slot, scenarios):
    expected_non_bid_pmpe = 0.3234
    expectations = []
    for v in scenarios:
        if v.role == "sam_downtime":
            actual_pmpe = round(expected_non_bid_pmpe * (v.credits / EXPECTED_CREDITS), 16)
        elif v.role == "sam_commission":
            actual_pmpe = round(expected_non_bid_pmpe * (1.0 - v.inflation_commission_onchain), 10)
        else:
            actual_pmpe = expected_non_bid_pmpe

        expectations.append({
            "voteAccount": v.vote_account,
            "expectedInflationCommission": 0.0,
            "actualInflationCommission": v.inflation_commission_onchain,
            "pastInflationCommission": 0.0,
            "expectedMevCommission": 0.0,
            "actualMevCommission": v.mev_commission_onchain if v.mev_commission_onchain else 0.0,
            "pastMevCommission": None,
            "expectedNonBidPmpe": expected_non_bid_pmpe,
            "actualNonBidPmpe": actual_pmpe,
            "expectedSamPmpe": expected_non_bid_pmpe + v.effective_bid if v.has_sam else expected_non_bid_pmpe,
            "beforeSamCommissionIncreasePmpe": v.before_sam_increase_pmpe,
            "maxSamStake": v.total_stake // SOL if v.has_sam else None,
            "samStakeShare": 1.0 if v.has_sam else 0.0,
            "lossPerStake": 0.0,
        })
    return {"epoch": epoch, "slot": slot, "revenueExpectations": expectations}


def build_rewards(epoch, scenarios, rng):
    """Build all 6 reward files. Returns dict of filename -> data.

    IMPORTANT: The old bid-distribution-cli on main does
    ``block_rewards - jito_priority_fee_rewards`` as u64. To avoid underflow
    the total Jito priority fees per validator MUST be less than its block
    rewards.
    """
    inflation_rate = rng.randint(80, 120)  # lamports per SOL
    mev_rate = rng.randint(30, 70)
    block_rate = rng.randint(20, 40)  # lamports per SOL for block rewards

    inflation = []
    mev = []
    jito = []

    # First pass: compute block rewards per validator so we can cap Jito fees
    validator_block_rewards = {}
    for v in scenarios:
        sol = v.total_stake // SOL
        validator_block_rewards[v.vote_account] = int(sol * block_rate)

    for v in scenarios:
        block_budget = validator_block_rewards[v.vote_account]
        num_stakes = len(v.stake_accounts)
        # Each stake's Jito fee must be small enough that the sum < block_rewards.
        # Cap per-stake Jito fee at 70% of (block_rewards / num_stakes).
        max_jito_per_stake = max(1, int(block_budget * 0.7 / max(num_stakes, 1)))

        for s in v.stake_accounts:
            sol = s["amount"] // SOL
            inflation.append({"epoch": epoch, "stake_account": s["pubkey"], "amount": str(sol * inflation_rate)})
            mev.append({"epoch": epoch, "stake_account": s["pubkey"], "amount": str(sol * mev_rate)})
            jito_amount = rng.randint(1, max(1, max_jito_per_stake))
            jito.append({"epoch": epoch, "stake_account": s["pubkey"], "amount": str(jito_amount)})

    val_inflation = []
    val_mev = []
    val_blocks = []
    for v in scenarios:
        sol = v.total_stake // SOL
        val_inflation.append({"epoch": epoch, "vote_account": v.vote_account, "amount": str(int(sol * inflation_rate * 0.05))})
        val_mev.append({"epoch": epoch, "vote_account": v.vote_account, "amount": str(int(sol * mev_rate * 0.05))})
        val_blocks.append({
            "epoch": epoch,
            "identity_account": v.identity,
            "node_pubkey": v.identity,
            "authorized_voter": v.identity,
            "vote_account": v.vote_account,
            "amount": str(validator_block_rewards[v.vote_account]),
        })

    return {
        "inflation.json": inflation,
        "mev.json": mev,
        "jito_priority_fee.json": jito,
        "validators_inflation.json": val_inflation,
        "validators_mev.json": val_mev,
        "validators_blocks.json": val_blocks,
    }


def build_institutional_payouts(epoch, slot, scenarios, rng):
    """Build institutional-payouts.json and institutional stakes.json."""
    inst_validators = [v for v in scenarios if v.role == "institutional"]
    if not inst_validators:
        return None, None

    payout_stakers = []
    payout_distributors = []
    validators_section = []
    validator_payout_info = []
    inst_stake_metas = []

    for v in inst_validators:
        stake_accounts_json = [
            {"address": s["pubkey"], "effectiveStake": str(s["amount"])}
            for s in v.stake_accounts
        ]

        payout_stakers.append({
            "voteAccount": v.vote_account,
            "stakeAccounts": stake_accounts_json,
            "staker": INST_STAKER_AUTH,
            "withdrawer": v.withdraw_authority,
            "activeStake": str(v.total_stake),
            "activatingStake": "0",
            "deactivatingStake": "0",
            "effectiveStake": str(v.total_stake),
            "balanceLamports": str(v.total_stake + 4 * SOL),
            "shareInstitutional": 1,
            "shareDeactivation": 0,
            "effectivePayoutLamports": str(v.inst_payout_stakers),
            "deactivatingPayoutLamports": "0",
            "payoutLamports": str(v.inst_payout_stakers),
        })

        payout_distributors.append({
            "voteAccount": v.vote_account,
            "stakeAccounts": stake_accounts_json,
            "payoutLamports": str(v.inst_payout_distributor),
        })

        validators_section.append({
            "voteAccount": v.vote_account,
            "stakedAmounts": {
                "voteAccount": v.vote_account,
                "stakeAccounts": stake_accounts_json,
                "totalActive": str(v.total_stake),
                "totalActivating": "0",
                "totalDeactivating": "0",
                "totalEffective": str(v.total_stake),
                "institutionalActive": str(v.total_stake),
                "institutionalActivating": "0",
                "institutionalDeactivating": "0",
                "institutionalEffective": str(v.total_stake),
            },
            "validatorRewards": str(rng.randint(100_000, 1_000_000)),
            "stakersInflationRewards": str(rng.randint(1_000_000, 10_000_000)),
            "stakersMevRewards": str(rng.randint(500_000, 5_000_000)),
            "stakersRewards": str(rng.randint(2_000_000, 15_000_000)),
            "totalRewards": str(rng.randint(3_000_000, 16_000_000)),
            "isInstitutional": True,
            "name": f"Test Institutional {v.index}",
            "apy": "0.3351098545862417967",
            "institutionalStakedRatio": "1",
            "apyPercentileDiff": "0.00320321072484937439",
            "commission": 0,
            "mevCommission": None,
            "credits": str(EXPECTED_CREDITS),
            "uptime": "1.3987038626875478458",
            "uptimeDeviationBps": "-3987.0386268754784581",
        })

        validator_payout_info.append({
            "voteAccount": v.vote_account,
            "isInstitutional": True,
            "stakeAccounts": stake_accounts_json,
            "payoutType": "institutional",
            "distributorFeeLamports": str(v.inst_payout_distributor),
            "validatorFeeLamports": str(v.inst_payout_distributor),
            "distributeToStakersLamports": str(v.inst_payout_stakers),
            "psrFeeLamports": "0",
        })

        for s in v.stake_accounts:
            inst_stake_metas.append({
                "pubkey": s["pubkey"],
                "balance_lamports": s["amount"] + 2 * SOL,
                "active_delegation_lamports": s["amount"],
                "activating_delegation_lamports": 0,
                "deactivating_delegation_lamports": 0,
                "validator": v.vote_account,
                "stake_authority": INST_STAKER_AUTH,
                "withdraw_authority": v.withdraw_authority,
            })

    # Add a non-institutional validator for coverage (use first SAM validator if exists)
    sam_validators = [v for v in scenarios if v.has_sam]
    if sam_validators:
        sv = sam_validators[0]
        validators_section.append({
            "voteAccount": sv.vote_account,
            "stakedAmounts": {
                "voteAccount": sv.vote_account,
                "stakeAccounts": [],
                "totalActive": str(sv.total_stake),
                "totalActivating": "0",
                "totalDeactivating": "0",
                "totalEffective": str(sv.total_stake),
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
            "commission": 0,
            "mevCommission": None,
            "credits": str(EXPECTED_CREDITS),
            "uptime": "1.3987038626875478458",
            "uptimeDeviationBps": "-3987.0386268754784581",
        })
        # Add a stake account for snapshot coverage
        if sv.stake_accounts:
            inst_stake_metas.append({
                "pubkey": sv.stake_accounts[0]["pubkey"],
                "balance_lamports": sv.stake_accounts[0]["amount"] + 2 * SOL,
                "active_delegation_lamports": sv.stake_accounts[0]["amount"],
                "activating_delegation_lamports": 0,
                "deactivating_delegation_lamports": 0,
                "validator": sv.vote_account,
                "stake_authority": WHITELIST_STAKE_AUTHORITIES[0],
                "withdraw_authority": make_pubkey("marinade-withdraw", epoch, sv.index),
            })

    payouts = {
        "epoch": epoch,
        "slot": str(slot),
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
                {"name": f"Test Institutional {v.index}", "vote_pubkey": v.vote_account}
                for v in inst_validators
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
        "payoutStakers": payout_stakers,
        "payoutDistributors": payout_distributors,
        "validators": validators_section,
        "validatorPayoutInfo": validator_payout_info,
    }

    inst_stakes = {"epoch": epoch, "slot": slot, "stake_metas": inst_stake_metas}
    return payouts, inst_stakes


# ============================================================================
# Write one epoch
# ============================================================================

def write_json(data, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def generate_epoch(epoch, output_root, quiet=False):
    """Generate all input files for one epoch. Returns a scenario summary string."""
    rng = _random_module.Random(epoch)
    slot = 400_000_000 + epoch * 432_000  # deterministic slot

    scenarios = generate_epoch_scenarios(epoch, rng)
    out = os.path.join(output_root, str(epoch), "inputs")

    # Bid-distribution inputs
    write_json(build_stakes_json(epoch, slot, scenarios), os.path.join(out, "stakes.json"))
    write_json(build_sam_scores_json(epoch, scenarios), os.path.join(out, "sam-scores.json"))
    write_json(build_validators_json(epoch, slot, scenarios), os.path.join(out, "validators.json"))
    write_json(build_evaluation_json(epoch, slot, scenarios), os.path.join(out, "evaluation.json"))

    # Rewards
    rewards = build_rewards(epoch, scenarios, rng)
    rewards_dir = os.path.join(out, "rewards")
    for filename, data in rewards.items():
        write_json(data, os.path.join(rewards_dir, filename))

    # Institutional
    payouts, inst_stakes = build_institutional_payouts(epoch, slot, scenarios, rng)
    inst_dir = os.path.join(out, "institutional")
    if payouts is not None:
        write_json(payouts, os.path.join(inst_dir, "institutional-payouts.json"))
        write_json(inst_stakes, os.path.join(inst_dir, "stakes.json"))

    # Build summary
    role_counts = {}
    for v in scenarios:
        role_counts[v.role] = role_counts.get(v.role, 0) + 1
    parts = []
    role_labels = {
        "sam": "SAM-only",
        "sam_downtime": "SAM+downtime",
        "sam_commission": "SAM+commission",
        "passive": "passive",
        "institutional": "institutional",
    }
    for role, label in role_labels.items():
        if role in role_counts:
            parts.append(f"{role_counts[role]} {label}")

    summary = f"epoch {epoch}: {len(scenarios)} validators ({', '.join(parts)})"
    if not quiet:
        print(f"  {summary}")
    return summary


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate fabricated test input data for settlement regression testing"
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--epoch", type=int, help="Generate data for a single epoch")
    group.add_argument("--start-epoch", type=int, help="First epoch in range")
    parser.add_argument("--end-epoch", type=int, help="Last epoch in range (inclusive)")
    parser.add_argument(
        "--output-root",
        default="./regression-data-fabricated",
        help="Root output directory (default: ./regression-data-fabricated)",
    )
    # Legacy compatibility
    parser.add_argument("--output-dir", help=argparse.SUPPRESS)
    args = parser.parse_args()

    # Handle legacy --output-dir mode
    if args.output_dir:
        # Old mode: --output-dir points directly to inputs dir
        epoch = args.epoch or 99999
        out = args.output_dir
        # Derive output_root from output_dir (strip /<epoch>/inputs)
        args.output_root = os.path.dirname(os.path.dirname(out))
        args.epoch = epoch
        args.start_epoch = None

    # Determine epoch range
    if args.epoch is not None:
        start = args.epoch
        end = args.epoch
    elif args.start_epoch is not None:
        start = args.start_epoch
        end = args.end_epoch if args.end_epoch is not None else start
    else:
        # Default: single epoch 99999
        start = 99999
        end = 99999

    total = end - start + 1
    print(f"Generating fabricated test data for {total} epoch(s): {start}..{end}")
    print(f"Output root: {args.output_root}")
    print()

    summaries = []
    for epoch in range(start, end + 1):
        summary = generate_epoch(epoch, args.output_root)
        summaries.append(summary)

    print()
    print(f"Generated {total} epoch(s) of fabricated input data.")
    if total > 1:
        # Show distribution stats
        total_validators = 0
        for epoch in range(start, end + 1):
            rng = _random_module.Random(epoch)
            scenarios = generate_epoch_scenarios(epoch, rng)
            total_validators += len(scenarios)
        print(f"Total validators across all epochs: {total_validators} (avg {total_validators/total:.1f}/epoch)")


if __name__ == "__main__":
    main()
