# sam-blacklist

Private repo (`marinade-finance/sam-blacklist`). Generates `blacklist.csv`
consumed by ds-sam to assign `BlacklistPenalty` settlements. Clone under
`.refs/sam-blacklist` if access is needed (`gh auth login` first).

## What it does

Two independent detection scripts write to `blacklist.csv` (`vote_account,code`):

**`add-sandwichers.ts`** — scrapes sandwiched.me per epoch, filters by
`sandwichRateThreshold = 0.3` (30%) across three rate columns:
`sandwich_rate`, `30d_sandwich_rate`, `30d_wide_sandwich_rate_model_1`.

**`add-slow-slotters.ts`** — queries `https://api.trillium.so/validator_rewards/{epoch}`,
reads `slot_duration_median` per validator. Threshold: `SLOT_DURATION_THRESHOLD = 450` ms.
Only validators slow in **consecutive epochs** are written
(`findConsecutiveSlowValidators`).

**`make-unique.ts`** — deduplicates by `vote_account`; preserves multiple
`SLOW_SLOTS_` entries across epochs for the same validator.

## Blacklist codes

| Code                                     | Trigger                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `MALICIOUS_SANDWICHED_ME_SINGLE_<epoch>` | `sandwich_rate ≥ 30%`                                |
| `MALICIOUS_SANDWICHED_ME_WIDE_<epoch>`   | `30d_wide_sandwich_rate_model_1 ≥ 30%`               |
| `MALICIOUS_SANDWICHED_ME_TOTAL_<epoch>`  | sum of both rates ≥ 30%                              |
| `SLOW_SLOTS_<epoch>`                     | `slot_duration_median > 450ms` in consecutive epochs |

## Pipeline integration

`blacklist.csv` → ds-sam → `BlacklistPenalty` settlement per blacklisted
validator. Full bond stake compensates stakers; no Marinade/DAO fee split.
