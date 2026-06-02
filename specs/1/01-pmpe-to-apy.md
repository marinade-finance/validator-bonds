---
status: draft
---

# APY math in @marinade.finance/ts-common

## Problem

Both `scripts/fee-annotation.ts` and `scripts/simulate-fee.ts` compute APY
from pmpe and epoch timing independently:

- `fee-annotation.ts` — `apyFor` closure using `Math.exp/Math.log`
- `simulate-fee.ts` — `apy` function using `Math.pow`
- Both hardcode `31557600` (seconds/year) and fall back to `182` epochs/year
- Both fetch the SSR feed and derive `epochsPerYear` from consecutive timestamps

`@marinade.finance/ts-common` already exports `SECONDS_PER_YEAR` and
`calculateApy({ rewards, stakedAmount })` in `src/apy.ts`, but `calculateApy`
uses the fixed `EPOCHS_PER_YEAR` constant — not usable with a measured
epoch duration from live SSR data.

## Approach

Extend `calculateApy` in `src/apy.ts` with an optional `epochsPerYear`
parameter defaulting to `EPOCHS_PER_YEAR` — backwards compatible.

```ts
calculateApy({ rewards, stakedAmount, epochsPerYear?: number }): Decimal
```

Both scripts then call `calculateApy` directly with `rewards`/`stakedAmount`
and the measured `epochsPerYear`, importing `SECONDS_PER_YEAR` from ts-common
instead of defining it locally.

## Where

- ts-common is an external package; change goes in its `src/apy.ts`
- `scripts/fee-annotation.ts` — drop `SECONDS_PER_YEAR`, `epochsPerYear`, `apyFor`; call `calculateApy`
- `scripts/simulate-fee.ts` — drop `31557600`, `182`, `epy`, `apy` fn; call `calculateApy`
