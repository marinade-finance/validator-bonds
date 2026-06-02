---
status: draft
---

# pmpe-to-APY in @marinade.finance/ts-common

## Problem

`scripts/fee-annotation.ts` computes APY from pmpe (per-mille per epoch) using
a dynamic `epochsPerYear` derived from real SSR-feed timestamps. The formula is
reusable but lives inline in a script with no tests.

`@marinade.finance/ts-common` already has `calculateApy` (`src/apy.ts`) but it
uses the fixed `EPOCHS_PER_YEAR` constant — not suitable for callers that have
an actual measured epoch duration from live data.

`SECONDS_PER_YEAR` is also defined locally in the script but already exported
from ts-common (`src/constants.ts`).

## Approach

Add `pmpeToApy(pmpe: number, epochsPerYear: number): number` to ts-common's
`src/apy.ts`. Returns APY as a fraction (consistent with `calculateApy`).
`Math.pow(1 + pmpe/1000, epochsPerYear) - 1` — no new dependencies.

The distinction between the fixed `EPOCHS_PER_YEAR` constant (nominal) and a
caller-supplied `epochsPerYear` (measured) is intentional and must remain.

## Where

- ts-common is an external package; the function goes in its `src/apy.ts`
- `scripts/fee-annotation.ts:23` — local `SECONDS_PER_YEAR` to replace with ts-common import
- `scripts/fee-annotation.ts:133` — `apyFor` closure to replace with `pmpeToApy` calls
