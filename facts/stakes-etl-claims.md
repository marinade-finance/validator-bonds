---
topic: stakes-etl settlement claims output schema
category: etl
verified_at: 2026-06-15T00:00:00Z
sources:
  - .refs/stakes-etl/etl/src/claims.rs:16
  - .refs/stakes-etl/etl/src/claims.rs:38
  - .refs/stakes-etl/etl/src/bin/claims.rs:11
  - .refs/stakes-etl/migrations/003-settlement_claims-update.sql:1
  - .refs/stakes-etl/.buildkite/etl-claims.yml:60
---

The `claims-etl` binary extracts on-chain `ClaimSettlement` instruction
invocations of the validator-bonds program from Snowflake (SonarX Solana data
share) for a single DAY (not epoch). Args (`bin/claims.rs:11-23`):
`--date YYYY-MM-DD`, `--snowflake-url`, `--snowflake-api-key`,
`--output-settlement-claims` (all also env-backed).

Output record (`claims.rs:16-34`), property order matches the SQL SELECT
because Snowflake returns row arrays, not objects:

```rust
pub struct Claim {
    pub block_timestamp: DateTime<Utc>, // parsed from epoch-seconds string
    pub block_id: Decimal,
    pub epoch: Decimal,        // FLOOR(block_id / 432000)
    pub tx_id: String,
    pub succeeded: bool,       // parsed from "true"/"1"/"yes" string
    pub tx_cost: Decimal,      // COALESCE(fee, 0)
    pub claim: Decimal,        // claimed lamports, parsed from ix data
    pub withdrawer: String,
    pub staker: String,
    pub config: String,        // accounts[0]
    pub bond: String,          // accounts[1]
    pub settlement: String,    // accounts[2]
    pub stake_from: String,    // accounts[4]
    pub stake_to: String,      // accounts[5]
}
```

How fields map to the on-chain settlement (`claims.rs:43-81`):

- Rows filtered to `program_id = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'`
  AND `LOG_MESSAGES LIKE '%ClaimSettlement%'`.
- `claim` is decoded from the last 8 bytes of the instruction data (the SQL
  reverses the little-endian u64 and converts hex->int). `staker` and
  `withdrawer` are 32-byte pubkeys parsed at fixed offsets from the end of the
  ix data (`udf_hex_to_base58`).
- `config`/`bond`/`settlement`/`stake_from`/`stake_to` are pulled from the
  instruction account list positions 0,1,2,4,5.
- epoch is hardcoded as `FLOOR(block_id / 432000)` (432000 slots/epoch).

Output goes to BigQuery only (NOT GCS). The pipeline loads it into a
DATE-partitioned table with `--replace` per day
(`etl-claims.yml:88-108`):
table `data-store-406413.mainnet_beta_stakes.settlement_claims`, partition
`$YYYYMMDD` derived from the date arg.

BQ schema (`migrations/003-settlement_claims-update.sql`): original columns
block_timestamp TIMESTAMP, block_id NUMERIC, tx_id STRING, claim NUMERIC,
staker/withdrawer/stake_from/stake_to STRING(44), PARTITION BY
DATE(block_timestamp); migration 003 added epoch NUMERIC, succeeded BOOL,
config/bond/settlement STRING(44), tx_cost NUMERIC.

The Snowflake query step retries automatically up to 3 times on any exit
status (`etl-claims.yml:67-70`).
