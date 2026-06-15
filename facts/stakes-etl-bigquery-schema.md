---
topic: stakes-etl BigQuery tables and schema
category: etl
verified_at: 2026-06-15T00:00:00Z
sources:
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:264
  - .refs/stakes-etl/.buildkite/etl-bonds.yml:118
  - .refs/stakes-etl/.buildkite/etl-claims.yml:88
  - .refs/stakes-etl/migrations/000-init-institutional.sql:1
  - .refs/stakes-etl/migrations/001-init-jito-priority-fee.sql:1
  - .refs/stakes-etl/migrations/002-validators_block_rewards-update.sql:1
  - .refs/stakes-etl/migrations/003-settlement_claims-update.sql:1
---

All tables live in BigQuery project `data-store-406413`, dataset
`mainnet_beta_stakes`. Loads use `bq load --source_format=NEWLINE_DELIMITED_JSON`
(NDJSON produced via `jq '.[]' -rc`). The JSON field names emitted by each ETL
must match the BQ column names (loads are by name).

Tables written by the `etl-stakes` pipeline (`etl-stakes.yml:264-291`),
file -> table mapping in the upload matrix:

- `rewards_inflation.json` -> `rewards_inflation`
- `rewards_validators_inflation.json` -> `rewards_validators_inflation`
- `rewards_mev.json` -> `rewards_mev`
- `rewards_validators_mev.json` -> `rewards_validators_mev`
- `rewards_validators_blocks.json` -> `rewards_validators_blocks`
- `stakes.json` -> `stakes`
- `epoch_info.json` -> `epochs`
- `rewards_priority_fee.json` -> `rewards_jito_priority_fee`

Tables written by the `etl-bonds` pipeline (`etl-bonds.yml:118-130`):

- `bid-distribution-settlements.json` -> `psr_settlements`
- `institutional-distribution-settlements.json` -> `institutional_settlements`
- `institutional-validators.json` -> `institutional_validators`

Tables written by the `etl-claims` pipeline (`etl-claims.yml:88-108`):

- `settlement_claims.json` -> `settlement_claims` (DATE-partitioned, loaded
  per-day with `--replace` into partition `$YYYYMMDD`).

Explicit schemas captured in migrations:

`rewards_jito_priority_fee` (`001`):

```sql
epoch INT64 NOT NULL,
stake_account STRING(44) NOT NULL,
amount NUMERIC NOT NULL
PARTITION BY RANGE_BUCKET(epoch, GENERATE_ARRAY(0, 1000, 1))
```

`rewards_validators_blocks` (`002`, original + ALTER):

```sql
epoch INT64 NOT NULL,
identity_account STRING(44) NOT NULL,  -- deprecated per INC-32, use node_pubkey/authorized_voter
vote_account STRING(44) NOT NULL,
amount NUMERIC NOT NULL,
node_pubkey STRING(44),       -- added in 002
authorized_voter STRING(44)   -- added in 002
PARTITION BY RANGE_BUCKET(epoch, GENERATE_ARRAY(0, 1000, 1))
```

`settlement_claims` (`003`, original + ALTER):

```sql
block_timestamp TIMESTAMP NOT NULL,
block_id NUMERIC NOT NULL,
tx_id STRING NOT NULL,
claim NUMERIC NOT NULL,
staker STRING(44) NOT NULL,
withdrawer STRING(44) NOT NULL,
stake_from STRING(44) NOT NULL,
stake_to STRING(44) NOT NULL,
epoch NUMERIC,        -- added 003, set to FLOOR(block_id/432000)
succeeded BOOL,       -- added 003
config STRING(44),    -- added 003
bond STRING(44),      -- added 003
settlement STRING(44),-- added 003
tx_cost NUMERIC       -- added 003
PARTITION BY DATE(block_timestamp)
```

`institutional_validators` (`000`):

```sql
epoch INT64, vote_account STRING,
total_active_lamports INT64, total_activating_lamports INT64,
total_deactivating_lamports INT64,
institutional_active_lamports INT64, institutional_activating_lamports INT64,
institutional_deactivating_lamports INT64,
validator_rewards_lamports INT64, stakers_rewards_lamports INT64,
total_rewards_lamports INT64,
apy FLOAT64, institutional_staked_ratio FLOAT64, apy_percentile_diff FLOAT64
```

NOTE: `institutional_validators` JSON is sourced from the institutional-staking
API (`etl-bonds.yml:80-95`), not from the institutional table migration columns;
the migration table is computed elsewhere. Treat the column list above as the
declared BQ schema, not as the ETL output shape.

Schemas NOT defined in migrations (created out-of-band / inferred from ETL JSON
keys): `stakes`, `rewards_inflation` ({epoch, stake_account, amount}),
`rewards_validators_inflation` ({epoch, vote_account, amount}), `rewards_mev`,
`rewards_validators_mev`, `epochs` ({epoch, epoch_end_time}), `psr_settlements`,
`institutional_settlements`. Do not assume column names beyond the JSON keys the
ETL emits.

`epochs` is an idempotency anchor: the inflation step only emits `epoch_info`
when the epoch row is absent (`etl-stakes.yml:109-115`).
