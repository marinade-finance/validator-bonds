# sam-blacklist

Private repo (`marinade-finance/sam-blacklist`). Generates `blacklist.csv`
consumed by ds-sam to assign `BlacklistPenalty` settlements. Clone under `.refs/sam-blacklist` for local exploration.

## Detection criteria

**Sandwich attacks** — data from sandwiched.me. Threshold: >30% sandwich
rate across a validator's produced blocks (publicly announced policy).

**Slow slots** — slot timing from trillium.so. Validators exceeding the
median block-time threshold in consecutive epochs are blacklisted (single-epoch
noise is filtered out).

## Pipeline integration

`blacklist.csv` → ds-sam → `BlacklistPenalty` settlement per blacklisted
validator. Full bond stake compensates stakers; no Marinade/DAO fee split.
