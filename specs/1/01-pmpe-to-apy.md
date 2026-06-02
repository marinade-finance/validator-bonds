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

Extend `calculateApy` in ts-common's `src/apy.ts` with an optional
`epochsPerYear` parameter that defaults to the existing `EPOCHS_PER_YEAR`
constant — backwards compatible, no new function name.

```ts
calculateApy({ rewards, stakedAmount, epochsPerYear?: number }): Decimal
```

`fee-annotation.ts` can then call it directly with `gross`/`stake` and the
measured `epochsPerYear`, dropping the inline `apyFor` closure entirely.

## Where

- ts-common is an external package; change goes in its `src/apy.ts`
- `scripts/fee-annotation.ts:23` — local `SECONDS_PER_YEAR` to replace with ts-common import
- `scripts/fee-annotation.ts:131` — `apyFor` closure to replace with `calculateApy` calls
