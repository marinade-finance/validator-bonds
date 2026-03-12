---
name: marinade-sam-bond
description: Marinade Validator Bonds protocol and CLI. Stake auction, bond collateral, PSR protection, settlement lifecycle, SAM bidding. Triggers on bond, validator, CLI, show-bond, fund-bond, withdraw, cpmpe, settlement, SAM, PSR, auction, delegation.
---

# Validator Bonds Protocol Context

Validators post SOL bonds as collateral to compete for Marinade's delegated stake via SAM (Stake Auction Marketplace). Bonds guarantee stakers earn at minimum network-average rewards -- underperformance triggers automatic compensation from the bond.

**Two staker populations:** mSOL holders (liquid staking, bidding settlements) and institutional/Select stakers (native staking, 50bps APY guarantee).

## Settlement Types

| Type                  | Trigger                                 | Funder                                     | Recipient                     |
| --------------------- | --------------------------------------- | ------------------------------------------ | ----------------------------- |
| Bidding               | Validator wins auction, owes bid amount | ValidatorBond                              | mSOL stakers                  |
| BidTooLowPenalty      | Bid below minimum threshold             | ValidatorBond                              | Stakers + Marinade/DAO fee    |
| BlacklistPenalty      | Blacklisted (sandwich, slow slots)      | ValidatorBond                              | Stakers                       |
| BondRiskFee           | Bond risk premium (scoring-calculated)  | ValidatorBond                              | Stakers                       |
| DowntimeRevenueImpact | Fewer credits than expected             | ValidatorBond (0-50%) / Marinade (50-100%) | Stakers                       |
| CommissionSamIncrease | Commission raised above declared bid    | ValidatorBond                              | Stakers (with markup penalty) |
| InstitutionalPayout   | Select program APY settlement           | ValidatorBond                              | Institutional stakers         |

## Epoch Lifecycle

1. **Epoch X**: Validators bid (CPMPE + commission), SAM allocates stake
2. **Epoch X+1**: Off-chain pipelines calculate charges from epoch X performance
3. Merkle trees generated, Settlement accounts created on-chain
4. Bond stake accounts fund settlements (deactivated)
5. **Claiming window** (~4 epochs): stakers prove merkle membership, claim rewards
6. Expired settlements closed, unclaimed funds return to bond

## Key Concepts

- **CPMPE** -- lamports per 1000 SOL per epoch, the validator's fixed bid price
- **Bond authority** -- `bond.authority` field or validator identity can sign
- **fund_bond** transfers stake ownership to bonds PDA; recovery via withdraw request (3-epoch lockup)
- **PSR** -- Protected Staking Rewards, ensures network-average inflation regardless of validator performance
- **Merkle settlements** -- off-chain generated, on-chain verified, efficient for large claim sets

## Related Marinade Repos

All at `https://github.com/marinade-finance/`. Clone under `./refs/` when deeper context needed.

**Direct data dependencies:**

- **ds-sam** -- SAM evaluation CLI + SDK, produces auction scores for bid-distribution-cli
- **ds-sam-pipeline** -- SAM pipeline data (auction inputs/outputs by epoch)
- **ds-scoring** -- NestJS scoring service feeding SAM scores API
- **institutional-staking** -- institutional staking calc + API, produces payout data
- **stakes-etl** -- ETL pipelines producing reward files in GCS
- **solana-snapshot-parser** -- produces stakes.json / validators.json snapshots
- **sam-blacklist** -- blacklist data (sandwich + slow slot detection)

**On-chain programs sharing state:**

- **liquid-staking-program** -- core mSOL staking
- **vote-aggregator** -- SPL governance delegation plugin
- **voter-stake-registry** -- vote weight plugin, token lockups

**SDKs/libraries:**

- **solana-transaction-builder** / **solana-transaction-executor** -- Rust tx builder/executor (workspace deps)
- **typescript-common** -- `@marinade.finance/*` packages (cli-common, web3js, anchor-common)

**Downstream consumers:**

- **psr-dashboard** -- PSR validator bond dashboard (reads bonds API)
- **marinade-sam-bot** -- optimal SAM bid calculator
- **delegation-strategy-2** -- validator scoring API, stake allocation
