---
name: marinade-sam-bond
description: Validator Bonds protocol internals — settlement types, SAM auction, bond collateral, PSR, epoch lifecycle. NOT for ecosystem navigation or issue filing (use marinade-ecosystem).
when_to_use: CPMPE, PMPE, totalPmpe, PSR, SAM auction, ValidatorBond, SettlementReason, ProtectedEvent, BidTooLowPenalty, BlacklistPenalty, BondRiskFee, InstitutionalPayout, PriorityFee, fund_bond, withdraw_request, init_withdraw_request, claim_withdraw_request, merkle settlement, bid-distribution, settlement-config.yaml, programs/validator-bonds/, settlement-distributions/, settlement-pipelines/, packages/validator-bonds-*, mSOL stakers, native staking, Select stakers, institutional stakers, bond collateral, clearing price, winningTotalPmpe, validator bid, dynamic commission, dynamic bids, minimum bond balance, minBondBalanceSol, program ID, vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
---

# Validator Bonds Protocol Context

Validators post SOL bonds as collateral to compete for Marinade's delegated stake via SAM (Stake Auction Marketplace). Bonds guarantee mSOL holders earn at minimum network-average rewards (PSR), and provide a 50bps APY guarantee for institutional/Select stakers -- underperformance triggers automatic compensation from the bond.

**Two staker populations:** mSOL holders (liquid staking, bidding settlements) and institutional/Select stakers (native staking, 50bps APY guarantee).

## Settlement Types

Top-level `SettlementReason` variants (`settlement-common/src/settlement_collection.rs`): `Bidding`, `PriorityFee`, `BidTooLowPenalty`, `BlacklistPenalty`, `BondRiskFee`, `InstitutionalPayout`, and `ProtectedEvent(...)` which wraps a protected-event sub-kind.

| Type                  | SettlementReason          | Trigger                                   | Funder                                     | Recipient                     |
| --------------------- | ------------------------- | ----------------------------------------- | ------------------------------------------ | ----------------------------- |
| Bidding               | `Bidding`                 | Validator wins auction, owes bid amount   | ValidatorBond                              | mSOL stakers                  |
| PriorityFee           | `PriorityFee`             | Activating stake pool share (ds-sam)      | ValidatorBond                              | Activating mSOL stakers       |
| BidTooLowPenalty      | `BidTooLowPenalty`        | Validator lowers bid vs previous epoch    | ValidatorBond                              | Stakers + Marinade/DAO fee    |
| BlacklistPenalty      | `BlacklistPenalty`        | Blacklisted (sandwich, slow slots)        | ValidatorBond                              | Stakers                       |
| BondRiskFee           | `BondRiskFee`             | Bond risk premium (ds-scoring-calculated) | ValidatorBond                              | Stakers                       |
| DowntimeRevenueImpact | `ProtectedEvent` sub-kind | Fewer credits than expected               | ValidatorBond (0-50%) / Marinade (50-100%) | Stakers                       |
| CommissionSamIncrease | `ProtectedEvent` sub-kind | Commission raised above declared bid      | ValidatorBond                              | Stakers (with markup penalty) |
| InstitutionalPayout   | `InstitutionalPayout`     | Select program APY settlement             | ValidatorBond                              | Institutional stakers         |

`ProtectedEvent` (`settlement-common/src/protected_events.rs`) also contains legacy `CommissionIncrease` and `LowCredits` (v1, no longer emitted).

## Epoch Lifecycle

1. **Epoch X**: Validators bid (static CPMPE or dynamic commission, since Jan 2026), SAM allocates stake
2. **Epoch X+1**: Off-chain pipelines calculate charges from epoch X performance
3. Merkle trees generated, Settlement accounts created on-chain
4. Bond stake accounts fund settlements (deactivated)
5. **Claiming window** (~4 epochs): stakers prove merkle membership, claim rewards
6. Expired settlements closed, unclaimed funds return to bond

## Key Concepts

- **CPMPE** -- lamports per 1000 SOL per epoch, the validator's fixed bid price
- **Clearing price** -- `winningTotalPmpe`: PMPE of the last validator group to receive stake in the auction
- **Program ID** -- `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`
- **Min bond balance** -- `minBondBalanceSol` in ds-sam runtime config (not a validator-bonds constant); tiered: <80% of min → stake cap 0 (revoked), 80–100% → cap clipped to existing stake, ≥100% → unrestricted
- **Bond authority** -- `bond.authority` field or validator identity can sign
- **fund_bond** transfers stake ownership to bonds PDA; recovery via withdraw request (lockup = `config.withdraw_lockup_epochs`, configurable by admin)
- **PSR** -- Protected Staking Rewards, ensures network-average inflation regardless of validator performance
- **Merkle settlements** -- off-chain generated, on-chain verified, efficient for large claim sets

## Direct Data Dependencies

Repos that feed data directly into the validator-bonds pipeline. All at `https://github.com/marinade-finance/`. Clone under `./.refs/` when deeper context needed.

**Direct data dependencies:**

- **ds-sam** -- SAM evaluation CLI + SDK, produces auction scores for bid-distribution-cli
- **ds-sam-pipeline** -- SAM pipeline data (auction inputs/outputs by epoch)
- **ds-scoring** -- NestJS scoring service feeding SAM scores API
- **institutional-staking** -- institutional staking calc + API, produces payout data
- **stakes-etl** -- ETL pipelines producing reward files in GCS
- **solana-snapshot-parser** -- produces stakes.json / validators.json snapshots

**On-chain programs sharing state:**

- **liquid-staking-program** -- core mSOL staking

**SDKs/libraries:**

- **solana-transaction-builder** / **solana-transaction-executor** -- Rust tx builder/executor (workspace deps)
- **typescript-common** -- `@marinade.finance/*` packages (cli-common, web3js, anchor-common)

**Downstream consumers:**

- **psr-dashboard** -- PSR validator bond dashboard (reads bonds API)
