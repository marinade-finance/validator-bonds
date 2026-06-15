---
topic: stakes-etl inflation rewards output (RPC blocks)
category: etl
verified_at: 2026-06-15T00:00:00Z
sources:
  - .refs/stakes-etl/etl/src/inflation.rs:22
  - .refs/stakes-etl/etl/src/inflation.rs:30
  - .refs/stakes-etl/etl/src/bin/inflation.rs:19
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:84
---

The `inflation-etl` binary collects per-account inflation (staking/voting)
rewards for an epoch directly from Solana RPC `getBlock` reward lists. It does
NOT use Snowflake. The module is `etl/src/inflation.rs`.

In-memory result (`inflation.rs:22-28`):

```rust
pub struct ResultCollection {
    pub epoch: Epoch,
    pub epoch_end_time: DateTime<Utc>,   // block_time of first block scanned
    pub stakers_rewards: Vec<StakerRecord>,    // { stake_account, amount }
    pub validators_rewards: Vec<ValidatorRecord>, // { vote_account, amount }
}
```

`amount` is `Decimal` lamports, clamped to `>= 0` via `reward.lamports.max(0)`
(`inflation.rs:101`,`:104`). Only `RewardType::Staking` and
`RewardType::Voting` rewards are kept; others are ignored
(`inflation.rs:97-107`).

Collection mechanics (`inflation.rs:30-140`):

- start_slot = `(epoch + 1) * slots_in_epoch`; scans up to `max_slots` slots
  forward (default `max_slots = 1000`, `bin/inflation.rs:35`) in batches of
  `BLOCKS_PER_REQUEST = 100` (`inflation.rs:35`). Inflation rewards land in the
  first block(s) of the NEXT epoch.
- Stops as soon as a block has no rewards, or a block with empty
  staking+voting rewards is seen after some were already collected
  (`inflation.rs:109-133`); bails if no inflation rewards found at all.
- Sleeps 250ms between blocks, retries each `getBlock` 3x with 5s backoff.

Multi-RPC cross-check (`bin/inflation.rs`, `inflation.rs:160-174`):

- Accepts `--rpc-url`/`RPC_URL` (single) and `--rpc-urls`/`RPC_URLS`
  (comma-separated), merged + deduped. Each RPC is queried in its own thread.
- `all_match` requires every responding RPC to produce identical
  (epoch, sorted staker pairs, sorted validator pairs); `epoch_end_time` is
  ignored in the comparison (`inflation.rs:230-234`). A single divergent RPC
  aborts the run. At least one responder required.

Pipeline split (`etl-stakes.yml:84-115`): the binary writes `result.json`,
then `jq` splits it into:

- `rewards_inflation.json` = `[{epoch, stake_account, amount}]`
- `rewards_validators_inflation.json` = `[{epoch, vote_account, amount}]`
- `epoch_info.json` = `[{epoch, epoch_end_time}]` (emitted only if epoch not
  already present in BQ `mainnet_beta_stakes.epochs`).

GCS + BQ: `rewards_inflation.json`/`rewards_validators_inflation.json` go to
`gs://marinade-stakes-etl-mainnet/{epoch}/` and BQ tables
`mainnet_beta_stakes.rewards_inflation` /
`mainnet_beta_stakes.rewards_validators_inflation`; `epoch_info.json` -> table
`mainnet_beta_stakes.epochs` (`etl-stakes.yml:264-289`).

Feeds PSR/settlement: inflation staker rewards are a component of total staker
rewards used to evaluate Protected Stake Reimbursement / settlement amounts
downstream. The pipeline also gates on inflation coverage: rewarded stake
accounts / active stake accounts must be >= COVERAGE_THRESHOLD (default 0.92,
`etl-stakes.yml:14`,`:204-241`) or the build fails and Slack-alerts.
