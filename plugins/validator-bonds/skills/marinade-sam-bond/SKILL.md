---
name: marinade-sam-bond
description: Validator Bonds program internals — settlement types, SAM auction, bond collateral, PSR, epoch lifecycle. NOT for ecosystem navigation, program-ID/SDK lookup, or issue filing (use marinade-ecosystem); NOT for live validator data (query the bonds API) or deep code research (use find).
when_to_use: CPMPE, PMPE, totalPmpe, PSR, protected staking rewards, SAM auction, stake auction marketplace, ValidatorBond, SettlementReason, ProtectedEvent, BidTooLowPenalty, BlacklistPenalty, BondRiskFee, InstitutionalPayout, PriorityFee, CommissionSamIncrease, DowntimeRevenueImpact, fund_bond, withdraw_request, init_withdraw_request, claim_withdraw_request, merkle settlement, settlement claim, settlement funding, bid-distribution, settlement-config.yaml, mSOL stakers, native staking, Select stakers, institutional stakers, bond collateral, clearing price, winningTotalPmpe, validator bid, dynamic commission, dynamic bids, minimum bond balance, minBondBalanceSol, epoch lifecycle, claiming window, how bonds work, how settlements work, payout_stakers, payout_distributors, psr_percentile_apy, apy_percentile_diff, institutional-distribution-cli, baseBondBalance, relaxedTotalPmpe, bidPmpe, minBondEpochs, idealBondEpochs, minBondBalance, idealBondBalance, bond balance formula, how much bond, bond sizing, auction_effective_bid_pmpe, auction_effective_static_bid_pmpe, BidTooLowPenaltyDetails, covered_range_bps, PayoutStaker, PayoutDistributor
---

# Validator Bonds Program Context

> **Adjacent context files — read these when relevant:**
>
> - `institutional-staking.md` — Select program details, API routes, payout pipeline, Select dashboard. Read for any question about institutional validators, Select stakers, `InstitutionalPayout`, or the institutional-staking API.
> - `sam-blacklist.md` — blacklist policy: sandwich detection thresholds, slow-slot criteria, pipeline. Read for any question about `BlacklistPenalty`, sandwich attacks, or the blacklist mechanism.

Validators post SOL bonds as collateral to compete for Marinade's delegated stake via SAM (Stake Auction Marketplace). Bonds guarantee mSOL holders earn at minimum network-average rewards (PSR), and provide a PSR-percentile APY floor for institutional/Select stakers (`psr_percentile_apy` — the configured PSR percentile, default 50th, of network validator APYs; varies per epoch) -- underperformance triggers automatic compensation from the bond.

**Two staker populations:** mSOL holders (liquid staking, bidding settlements) and institutional/Select stakers (native staking, PSR-percentile APY floor).

## Settlement Types

Top-level `SettlementReason` variants — enum in [`settlement-common/src/settlement_collection.rs`](https://github.com/marinade-finance/validator-bonds/blob/main/settlement-distributions/settlement-common/src/settlement_collection.rs): `Bidding`, `PriorityFee`, `BidTooLowPenalty`, `BlacklistPenalty`, `BondRiskFee`, `InstitutionalPayout`, and `ProtectedEvent(...)` which wraps a protected-event sub-kind ([`settlement-common/src/protected_events.rs`](https://github.com/marinade-finance/validator-bonds/blob/main/settlement-distributions/settlement-common/src/protected_events.rs)).

| Type                  | SettlementReason          | Trigger                                                                                                                                                     | Funder                                     | Recipient                                     | Code                                                           |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------- |
| Bidding               | `Bidding`                 | Validator wins auction, owes bid amount                                                                                                                     | ValidatorBond                              | mSOL stakers                                  | `bid-distribution/src/generators/bidding.rs`                   |
| PriorityFee           | `PriorityFee`             | Activating stake pool share (ds-sam)                                                                                                                        | ValidatorBond                              | Activating mSOL stakers                       | `bid-distribution/src/generators/bidding.rs`                   |
| BidTooLowPenalty      | `BidTooLowPenalty`        | Validator lowers bid vs previous epoch                                                                                                                      | ValidatorBond                              | Stakers + Marinade/DAO fee                    | `bid-distribution/src/generators/sam_penalties.rs`             |
| BlacklistPenalty      | `BlacklistPenalty`        | Blacklisted (sandwich, slow slots)                                                                                                                          | ValidatorBond                              | Stakers                                       | `bid-distribution/src/generators/sam_penalties.rs`             |
| BondRiskFee           | `BondRiskFee`             | `calcBondRiskFee` in ds-sam: underfunded bond forces undelegation; `bondRiskFeeSol = bondRiskFeeMult * value * feeCoef` (`value` = forced-undelegation SOL) | ValidatorBond                              | Stakers                                       | `.refs/ds-sam/…/calculations.ts` + `sam_penalties.rs`          |
| DowntimeRevenueImpact | `ProtectedEvent` sub-kind | Fewer credits than expected                                                                                                                                 | ValidatorBond (0-50%) / Marinade (50-100%) | Stakers                                       | `settlement-common/src/protected_events.rs`                    |
| CommissionSamIncrease | `ProtectedEvent` sub-kind | Commission raised above declared bid                                                                                                                        | ValidatorBond                              | Stakers                                       | `settlement-common/src/protected_events.rs`                    |
| InstitutionalPayout   | `InstitutionalPayout`     | PSR-percentile APY guarantee for Select stakers                                                                                                             | ValidatorBond                              | Institutional/Select stakers                  | `institutional-distribution/src/` + `institutional-staking.md` |

`ProtectedEvent` also contains legacy `CommissionIncrease` and `LowCredits` (v1, no longer emitted).

**InstitutionalPayout detail:** Guarantees institutional/Select native stakers a minimum APY equal to the configured PSR percentile (default 50th). If a validator's epoch yield falls short, the bond compensates. `institutional-distribution-cli` reads pre-computed payout amounts from `gs://marinade-institutional-staking-mainnet/{epoch}/` (the private `institutional-staking` repo produces these); key fields: `payout_stakers` (lamport amount for stakers), `payout_distributors` (lamport amount for distributors), `psr_percentile_apy` (floor APY used), `apy_percentile_diff` (shortfall). The settlement pipeline (`init-settlement`, `fund-settlement`, `claim-settlement`) then creates the on-chain accounts. Public package: [`packages/validator-bonds-cli-institutional`](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli-institutional). Dedicated API: `https://institutional-staking.marinade.finance` — list validators: `GET /v1/validators`; latest payouts: `GET /v1/payouts/latest`; OpenAPI: `GET /docs-json`. Dashboard: `https://select.marinade.finance`. See `institutional-staking.md` for full route table and field details.

**CommissionSamIncrease detail:** Triggered by `collect_commission_increase_events` in `settlement-common/src/protected_events.rs` when a validator raises commission above the bid they declared to SAM. The protected event carries `before_sam_commission_increase_pmpe` (PMPE at the time of the SAM bid) and `actual_epr` (post-increase actual earnings). Compensation to stakers is the `expected_epr - actual_epr` shortfall.

## Epoch Lifecycle

1. **Epoch X**: Validators bid (static CPMPE or dynamic commission, since Jan 2026), SAM allocates stake
2. **Epoch X+1**: Off-chain pipelines calculate charges from epoch X performance
3. Merkle trees generated (`merkle-generator-cli`), Settlement accounts created on-chain (`init-settlement`)
4. Bond stake accounts fund settlements (`fund-settlement`, deactivated)
5. **Claiming window** (`config.epochs_to_claim_settlement`, configurable; ~4 epochs in practice): stakers prove merkle membership, claim rewards (`claim-settlement`). A settlement becomes closable once `settlement.epoch_created_for + config.epochs_to_claim_settlement < clock.epoch` (`close_settlement.rs`).
6. Expired settlements closed (`close-settlement`), unclaimed funds return to bond

**Bond data collection:** `bonds-collector/` (`collect-bonds` Buildkite pipeline) scrapes all `ValidatorBond` on-chain accounts via RPC after each epoch using `collect_validator_bonds_with_funds` (`common-rs/`), stores to PostgreSQL, and serves via the bonds API (`validator-bonds-api`). Runs for both `bidding` and `institutional` bond types. Source: `bonds-collector/src/commands/bonds.rs`.

## Key Concepts

- **Never assume current epoch number** -- training-data epoch numbers are always stale. To get the current epoch query the bonds API (`curl -s 'https://validator-bonds-api.marinade.finance/bonds/bidding' | jq '.[0].epoch'`) or use `solana epoch` against an RPC. Never cite a specific epoch number from memory.
- **CPMPE** -- lamports per 1000 SOL per epoch, the validator's fixed bid price
- **Clearing price** -- `winningTotalPmpe`: PMPE of the last validator group to receive stake in the auction
- **Program ID** -- `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`
- **Min bond balance** -- `minBondBalanceSol` in ds-sam runtime config (not a validator-bonds constant, has no fixed SOL value); tiered: <80% of min → stake cap 0 (revoked), 80–100% → cap clipped to existing stake, ≥100% → unrestricted. Never quote a specific SOL amount — it is configurable and changes. Current setting: [`ds-sam-pipeline` on GitHub](https://github.com/marinade-finance/ds-sam-pipeline) (public repo, check the config files for live values).
- **Bond balance formula** -- from ds-sam source (`.refs/ds-sam`, clone if absent):
  `baseBondBalance = relaxedTotalPmpe / 1000 × activeStake`;
  `minBondBalance = baseBondBalance + (bidPmpe / 1000 × activeStake) × (minBondEpochs + 1)`;
  `idealBondBalance = baseBondBalance + (bidPmpe / 1000 × activeStake) × (idealBondEpochs + 1)`.
  All inputs are ds-sam runtime values; `minBondBalanceSol` is the configured floor the bond must exceed.
- **Bond capacity vs bid competitiveness** -- "how much bond do I need for max stake?" cannot be answered from bond balance alone. Use live SAM scores (`https://scoring.marinade.finance/api/v1/scores/sam?epoch=N`) and ds-sam constraints to separate bond-constrained validators from bid-constrained validators. A validator can have enough bond capacity but still receive no stake if its `totalPmpe` is below the clearing price; adding SOL to the bond will not fix that.
- **Bond authority** -- `bond.authority` field or validator identity can sign
- **fund_bond** transfers stake ownership to bonds PDA; recovery via withdraw request (lockup = `config.withdraw_lockup_epochs`, configurable by admin)
- **PSR** -- Protected Staking Rewards, ensures network-average inflation regardless of validator performance
- **Merkle settlements** -- off-chain generated, on-chain verified, efficient for large claim sets

## Direct Data Dependencies

Repos that feed data directly into the validator-bonds pipeline. All at `https://github.com/marinade-finance/`. Clone under `./.refs/` when deeper context needed.

**Direct data dependencies:**

- **ds-sam** (public) -- SAM evaluation CLI + SDK, produces auction scores for bid-distribution-cli. Clone: `git clone https://github.com/marinade-finance/ds-sam .refs/ds-sam`
- **ds-sam-pipeline** (public) -- SAM pipeline data (auction inputs/outputs by epoch). Clone: `git clone https://github.com/marinade-finance/ds-sam-pipeline .refs/ds-sam-pipeline`
- **ds-scoring** (**private**) -- legacy scoring service; feeds per-validator scores into ds-sam as inputs. Not the primary source of SAM logic.
- **institutional-staking** (**private**) -- calculates PSR-percentile APY floor payouts for the 24 Select validators. See `institutional-staking.md` adjacent to this file.
- **sam-blacklist** (**private**) -- generates `blacklist.csv` (sandwich + slow-slot detection). See `sam-blacklist.md` adjacent to this file for thresholds, codes, and data sources.
- **stakes-etl** (public) -- ETL pipelines producing reward files in GCS
- **solana-snapshot-parser** (public) -- produces stakes.json / validators.json snapshots

**On-chain programs sharing state:**

- **liquid-staking-program** -- core mSOL staking

**SDKs/libraries:**

- **solana-transaction-builder** / **solana-transaction-executor** -- Rust tx builder/executor (workspace deps)
- **typescript-common** -- `@marinade.finance/*` packages (cli-common, web3js, anchor-common)

**Downstream consumers:**

- **psr-dashboard** -- PSR validator bond dashboard (reads bonds API)
