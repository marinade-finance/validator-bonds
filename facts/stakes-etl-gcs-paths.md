---
topic: stakes-etl GCS bucket and path patterns
category: etl
verified_at: 2026-06-15T00:00:00Z
sources:
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:11
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:130
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:182
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:256
  - .refs/stakes-etl/.buildkite/etl-bonds.yml:9
  - .refs/stakes-etl/.buildkite/scheduler.yml:4
---

Buckets (defined as pipeline env vars):

- `gs://marinade-stakes-etl-mainnet` — ETL OUTPUT bucket (this repo writes
  here). `GS_STAKES_ETL_BUCKET` (`etl-stakes.yml:11`).
- `gs://marinade-solana-snapshot-mainnet` — INPUT snapshot bucket.
  `GS_SNAPSHOT_BUCKET` (`etl-stakes.yml:12`).
- `gs://jito-mainnet` — INPUT Jito bucket.
  `GS_JITO_BUCKET` (`etl-stakes.yml:13`).
- `gs://marinade-validator-bonds-mainnet` — INPUT bonds/settlement bucket.
  `GS_BONDS_BUCKET` (`etl-bonds.yml:9`).

INPUT download paths (epoch-keyed):

- Snapshot stakes: `gs://marinade-solana-snapshot-mainnet/{epoch}/stakes.json`
  (`etl-stakes.yml:182`).
- Jito stake meta:
  `gs://jito-mainnet/{epoch}/**/*-stake-meta-collection.json` — pipeline globs
  and takes `head -1` (`etl-stakes.yml:130-144`).
- Bonds settlements:
  `gs://marinade-validator-bonds-mainnet/{epoch}/bid-distribution-settlements.json`
  and `.../institutional-distribution-settlements.json` (`etl-bonds.yml:54-60`).

OUTPUT upload paths — all to
`gs://marinade-stakes-etl-mainnet/{epoch}/<file>` (single upload step, file
name preserved; `etl-stakes.yml:256`, `etl-bonds.yml:110`). Files:

- `stakes.json`
- `rewards_inflation.json`
- `rewards_validators_inflation.json`
- `rewards_mev.json`
- `rewards_validators_mev.json`
- `rewards_priority_fee.json`
- `rewards_validators_blocks.json`
- `epoch_info.json`
- `bid-distribution-settlements.json` (re-derived, from etl-bonds)
- `institutional-distribution-settlements.json` (from etl-bonds)
- `institutional-validators.json` (from etl-bonds)

To download an epoch's processed ETL data:
`gcloud storage ls gs://marinade-stakes-etl-mainnet/{epoch}/`

`settlement_claims.json` (from `claims-etl`) is NOT written to GCS — it goes
straight to the BigQuery `settlement_claims` table (`etl-claims.yml` has no GCS
copy step).

The scheduler discovers the latest epoch by listing
`gs://.../**/stakes.json` (and equivalents) and parsing the 4th `/`-delimited
path segment as the epoch number (`scheduler.yml:23-26`), i.e. the epoch is the
first path component after the bucket name.

Snowflake (not GCS) is the source for `claims-etl` and `blocks-etl`:
`SNOWFLAKE_URL: https://IYPMABV-SAC19105.snowflakecomputing.com`
(`etl-stakes.yml:10`, `etl-claims.yml:66`); API key is the secret env
`SNOWFLAKE_API_KEY`.
