---
path: sam-blacklist-mechanism
topic: blacklist penalty enforcement
verified_at: 2026-06-16
header: >
  SAM blacklist is generated from two data sources: sandwich attack rate
  (sandwiched.me) and slow slot performance (trillium.so). Two scripts
  in sam-blacklist repo produce blacklist.csv consumed by the pipeline.
findings_count: 5
---

## Blacklist generation

Two independent detection scripts write to `blacklist.csv`:

1. **`add-sandwichers.ts`** — scrapes sandwich attack data from sandwiched.me.
   Threshold: `sandwichRateThreshold = 0.3` (30%). Checks `sandwich_rate`,
   `30d_sandwich_rate`, and `30d_wide_sandwich_rate_model_1`. Any validator
   exceeding 30% is tagged `MALICIOUS_SANDWICHED_ME_*`.

2. **`add-slow-slotters.ts`** — queries `slot_duration_median` per validator
   from the trillium.so API (`validator_rewards/{epoch}`). Threshold:
   `SLOT_DURATION_THRESHOLD = 450` ms. Only validators slow in **consecutive
   epochs** are blacklisted (avoids single-epoch noise). Tagged `SLOW_SLOTS_`.

`make-unique.ts` deduplicates the output (preserving multiple `SLOW_SLOTS_`
entries for the same validator across epochs).

## Blacklist codes

| Code prefix                       | Trigger                                              |
| --------------------------------- | ---------------------------------------------------- |
| `MALICIOUS_SANDWICHED_ME_SINGLE_` | `sandwich_rate ≥ 30%`                                |
| `MALICIOUS_SANDWICHED_ME_WIDE_`   | `30d_wide_sandwich_rate_model_1 ≥ 30%`               |
| `MALICIOUS_SANDWICHED_ME_TOTAL_`  | sum of both rates ≥ 30%                              |
| `SLOW_SLOTS_`                     | `slot_duration_median > 450ms` in consecutive epochs |

## Pipeline integration

`blacklist.csv` is loaded by the SAM evaluation pipeline (`ds-sam`). A
blacklisted validator gets `BlacklistPenalty` settlement type — their bond
compensates stakers, no Marinade/DAO fee split.

## Key code identifiers (sam-blacklist repo)

- `sandwichRateThreshold` (0.3)
- `SLOT_DURATION_THRESHOLD` (450ms)
- `slot_duration_median` (field from trillium.so)
- `findConsecutiveSlowValidators()` (consecutive-epoch filter)
