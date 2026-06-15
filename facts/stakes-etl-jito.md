---
topic: stakes-etl jito MEV and priority-fee rewards output
category: etl
verified_at: 2026-06-15T00:00:00Z
sources:
  - .refs/stakes-etl/etl/src/jito.rs:80
  - .refs/stakes-etl/etl/src/jito.rs:131
  - .refs/stakes-etl/etl/src/bin/jito.rs:11
  - .refs/stakes-etl/.buildkite/etl-stakes.yml:117
  - .refs/stakes-etl/migrations/001-init-jito-priority-fee.sql:1
---

The `jito-etl` binary reads a Jito `StakeMetaCollection` JSON (downloaded from
`gs://jito-mainnet/{epoch}/**/*-stake-meta-collection.json`,
`etl-stakes.yml:130`) and computes three reward distributions. No RPC, no
Snowflake. Args (`bin/jito.rs:11-25`): `--jito-stake-meta`,
`--output-mev-rewards`, `--output-validators-mev-rewards`,
`--output-priority-fee-rewards`.

Input meta (`jito.rs:16-58`): each `StakeMeta` has `validator_vote_account`,
`total_delegated`, `delegations[] { stake_account_pubkey, lamports_delegated }`,
and optionally `maybe_tip_distribution_meta` (MEV) and
`maybe_priority_fee_distribution_meta`, each carrying
`total_tips: u64` and `validator_fee_bps: u16`.

1. MEV (`generate_mev_collection`, `jito.rs:80-124`) — only stake_metas with a
   `TipDistributionMeta`:
   - validator share = `total_tips * validator_fee_bps / 10_000` (integer math,
     u128), emitted as a `ValidatorRecord { epoch, vote_account, amount }`.
   - remaining = `total_tips - validator_amount`, split across delegations pro
     rata: `lamports_delegated * remaining / total_delegated`, emitted per
     stake account as `StakerRecord { epoch, stake_account, amount }`.
     -> `output-mev-rewards` (stakers) and `output-validators-mev-rewards`
     (validators).

2. Priority fee (`generate_priority_fee_collection`, `jito.rs:131-161`) — only
   stake_metas with a `PriorityFeeDistributionMeta`:
   - `total_tips` here is the portion already destined for stakers+Jito
     (comment `jito.rs:139`); NO validator cut is taken out.
   - per delegation: `lamports_delegated * total_tips / total_delegated`,
     emitted as `StakerRecord { epoch, stake_account, amount }`.
   - Only a stakers vector is produced (no validator priority-fee output).
     -> `output-priority-fee-rewards`.

All amounts are `Decimal` lamports. `epoch` on every record comes from
`StakeMetaCollection.epoch`.

Connection to on-chain PriorityFee settlements: these per-stake-account
priority-fee amounts are the staker-owed priority fee that the bid-distribution
pipeline reconciles against what validators actually paid, feeding PriorityFee
settlement generation.

GCS + BQ (`etl-stakes.yml:264-291`): outputs uploaded to
`gs://marinade-stakes-etl-mainnet/{epoch}/` as `rewards_mev.json`,
`rewards_validators_mev.json`, `rewards_priority_fee.json`; loaded to BQ tables
`mainnet_beta_stakes.rewards_mev`, `rewards_validators_mev`, and
`rewards_jito_priority_fee` respectively. The priority-fee table is
`epoch INT64, stake_account STRING(44), amount NUMERIC`, partitioned by epoch
range bucket 0..1000 (`migrations/001-init-jito-priority-fee.sql`).
