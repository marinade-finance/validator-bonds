---
status: draft
---

# APY math in @marinade.finance/ts-common

## Problem

Both `scripts/fee-annotation.ts` and `scripts/simulate-fee.ts` compute APY
from pmpe and epoch timing independently:

- `fee-annotation.ts` — `apyFor` closure, inline pmpe expressions, `/1e9` conversions
- `simulate-fee.ts` — `apy` function, same pmpe expressions, same `/1e9` conversions
- Both hardcode `31557600` (seconds/year) and a fallback epochs/year
- Both fetch the SSR feed and derive `epochsPerYear` from consecutive timestamps

`@marinade.finance/ts-common` already exports `SECONDS_PER_YEAR` and
`calculateApy({ rewards, stakedAmount })` in `src/apy.ts`, but `calculateApy`
uses the fixed `EPOCHS_PER_YEAR` constant — not usable with a measured
epoch duration from live SSR data.

## Approach

Three additions to ts-common, all without new dependencies:

**`src/apy.ts`** — extend `calculateApy` with optional `epochsPerYear`:

```ts
calculateApy({ rewards, stakedAmount, epochsPerYear?: number }): Decimal
```

Defaults to `EPOCHS_PER_YEAR`. Replaces the inline `apyFor`/`apy` closures in
both scripts.

**`src/apy.ts`** — add `pmpe(rewards, stakedAmount): number`:
`(rewards / stakedAmount) * 1000`. Replaces the three `pmpeGross/pmpeAdj/pmpeMax`
inline expressions.

**`src/solana.ts`** — add `lamportsToSol(lamports): number`:
`lamports / 1e9`. Replaces `feesSol` and `feesFull` conversions.

## Where

- ts-common is an external package; changes go in its `src/apy.ts` and `src/solana.ts`
- `scripts/fee-annotation.ts` — drop `SECONDS_PER_YEAR`, `epochsPerYear`, `apyFor`, inline pmpe expressions, `/1e9` conversions
- `scripts/simulate-fee.ts` — drop `31557600`, `182`, `epy`, `apy` fn, inline pmpe expressions
