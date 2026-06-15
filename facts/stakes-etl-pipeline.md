---
topic: stakes-etl Buildkite pipelines, scheduling and retry
category: etl
verified_at: 2026-06-15T00:00:00Z
sources:
  - .refs/stakes-etl/.buildkite/scheduler.yml:18
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:16
  - .refs/stakes-etl/.buildkite/etl-bonds.yml:48
  - .refs/stakes-etl/.buildkite/etl-claims.yml:60
  - .refs/stakes-etl/README.md:5
---

Four Buildkite pipelines, all on agent queue `snapshots` with
`BUILDKITE_CLEAN_CHECKOUT: true`. Slack channel `feed-pipeline-etl`.

`scheduler` (`scheduler.yml`) — epoch detector, single-concurrency gate
`etl/scheduler-stakes-bonds`:

- Stakes ETL trigger: compares max processed epoch
  (`gs://marinade-stakes-etl-mainnet/**/stakes.json`) against max available
  Jito epoch (`gs://jito-mainnet/**/*-stake-meta-collection.json`) and max
  snapshot epoch (`gs://marinade-solana-snapshot-mainnet/**/stakes.json`).
  Triggers `etl-stakes` with `EPOCH=max_stakes_epoch` only if processed <
  both (`scheduler.yml:18-43`).
- Bonds ETL trigger: compares processed
  (`gs://marinade-stakes-etl-mainnet/**/bid-distribution-settlements.json`)
  against bonds bucket bid + institutional epochs; triggers `etl-bonds`
  (`scheduler.yml:45-70`).
  Epoch is extracted with `awk -F / '{print $4}'` (4th path segment) and the
  greatest is chosen. Each branch ends with `true` so the gate always unlocks.

`etl-stakes` (`etl-stakes.yml`) — epoch-driven. Sequence:

1. Build `stakes-etl inflation-etl jito-etl blocks-etl` (`--release`).
2. Input/meta-data setup for EPOCH, COVERAGE_THRESHOLD (default 0.92),
   RPC_URL, RPC_URLS.
3. Parallel processing steps (each `concurrency: 1`, own concurrency_group):
   inflation (RPC), JITO (gs jito bucket), blocks (Snowflake), stakes (gs
   snapshot bucket).
4. `wait` -> inflation coverage verification (rewarded/active >= threshold;
   Slack-alerts + fails build if below).
5. `wait` -> upload matrix to GCS + BQ.
6. Slack success notification.
   The README notes processing is intentionally split: institutional/Select
   (Prime) staking depends on `etl-stakes` data already in BQ
   (`README.md:12-14`).

`etl-bonds` (`etl-bonds.yml`) — epoch-driven, depends on stakes-etl outputs.
Downloads settlement JSONs from `gs://marinade-validator-bonds-mainnet/{epoch}/`
(`bid-distribution-settlements.json`,
`institutional-distribution-settlements.json`), flattens claims with jq, also
fetches institutional validator list from
`https://institutional-staking.marinade.finance`, then uploads to GCS + BQ.
Historical note in the matrix comment (`etl-bonds.yml:52-53`): before epoch 733
there were separate `protected-events-settlements.json` and
`bidding-settlements.json`; before epoch 923 separate
`bid-distribution-settlements.json` and `bid-psr-distribution-settlements.json`.

`etl-claims` (`etl-claims.yml`) — DAY-driven, not epoch. If
`SCHEDULED_BUILD` is set it auto-uses yesterday's date; otherwise prompts for a
`YYYY-MM-DD` date. Runs `claims-etl` against Snowflake and loads a
DATE-partitioned BQ table with `--replace`.

Retry behavior:

- `etl-claims` claims step retries automatically on ANY exit status, limit 3
  (`etl-claims.yml:67-70`).
- Snowflake fetch layer retries each partition up to 15 attempts with linearly
  increasing backoff `sleep(10 * attempt)` seconds (`etl/src/snowflake.rs:114`).
- `inflation-etl` retries each `getBlock` RPC call 3x with 5s backoff in-process
  (`etl/src/inflation.rs:58-80`); failing RPCs simply don't vote, run aborts
  only if all RPCs fail or results diverge.
- No global Buildkite retry config on the stakes/bonds pipelines beyond per-step
  defaults.
