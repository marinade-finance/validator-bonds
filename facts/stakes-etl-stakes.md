---
topic: stakes-etl stakes output schema
category: etl
verified_at: 2026-06-15T00:00:00Z
sources:
  - .refs/stakes-etl/etl/src/stakes.rs:6
  - .refs/stakes-etl/etl/src/bin/stakes.rs:12
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:171
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:284
---

The `stakes-etl` binary transforms a snapshot-parser `StakeMetaCollection`
into a flat per-stake-account list. It does NOT query any RPC or Snowflake —
it reads a JSON file (`--stakes-collection` / env `STAKES_COLLECTION`) and
writes a JSON array (`--output-stakes` / env `OUTPUT_STAKES`).

Output record (`stakes.rs:6-17`), one per stake account:

```rust
pub struct Record {
    pub epoch: Epoch,            // from StakeMetaCollection.epoch
    pub stake_account: String,   // stake_meta.pubkey
    pub stake_authority: String, // stake_meta.stake_authority
    pub withdraw_authority: String,
    pub vote_account: Option<String>, // None if undelegated
    pub balance: Decimal,        // balance_lamports
    pub active: Decimal,         // active_delegation_lamports
    pub activating: Decimal,     // activating_delegation_lamports
    pub deactivating: Decimal,   // deactivating_delegation_lamports
}
```

All lamport fields are `Decimal` (serialized as JSON numbers/strings, not
INT64). Values are taken verbatim from the snapshot; no arithmetic.

Source snapshot is downloaded in the pipeline from the snapshot bucket, not
produced here (`etl-stakes.yml:182`):
`gs://marinade-solana-snapshot-mainnet/{epoch}/stakes.json` -> renamed to
`marinade-stakes.json` -> fed as `--stakes-collection`.

Output `stakes.json` is uploaded to
`gs://marinade-stakes-etl-mainnet/{epoch}/stakes.json` and loaded to BQ table
`data-store-406413.mainnet_beta_stakes.stakes`
(`etl-stakes.yml:256`, `:284`).

Downstream use: the bid-distribution / settlement pipeline consumes the stake
snapshot; the pipeline's own coverage check (`etl-stakes.yml:204-241`) cross-
references `stakes.json` active-stake accounts against `rewards_inflation.json`
to assert inflation reward coverage >= threshold (default 0.92).

The binary only logs totals (active/activating/deactivating in SOL via
`lamports_to_sol`, `bin/stakes.rs:29-44`); these are informational, not part of
the output file.
