# institutional-staking

Private repo (`marinade-finance/institutional-staking`). Calculates and
serves institutional staking payouts — the source of `InstitutionalPayout`
settlements. Clone under `.refs/institutional-staking` if access is needed
(`gh auth login` first).

## Role in pipeline

Per epoch:

1. Download ETL/snapshot data from GCS (`gs://marinade-stakes-etl-mainnet/{epoch}/`,
   `gs://marinade-solana-snapshot-mainnet/{epoch}/`)
2. Load the institutional validator set
3. `pnpm cli payouts` → `institutional-payouts.json` (`InstitutionalPayoutDto`)
4. Upload to `gs://marinade-institutional-staking-mainnet/{epoch}/`
5. `pnpm cli store` → persists to PostgreSQL
6. `institutional-distribution-cli` reads the JSON to produce on-chain settlements

## Payout logic

Key file: `packages/institutional-staking-cli/src/commands/institutional-payouts.ts`

- Validators ranked by uptime: actual voting credits vs expected credits
- `psrPercentile` selects the PSR APY baseline used as the guarantee floor
- `psrGraceDowntimeBps` controls when a validator becomes a downtime outlier
- Validators take `validatorFeeBps` and `distributorFeeBps` from the payout
- Outliers (downtime) receive no validator fee; stakers are subsidized
- Non-institutional validators with institutional stake never receive validator fees
- Staker payouts split by effective stake within
  `(voteAccount, stakeAuthority, withdrawAuthority)`

## Output shape (`InstitutionalPayoutDto`)

Produced by `pnpm cli payouts`. Fields consumed downstream by
`institutional-distribution-cli`:

- `payout_stakers` — per-staker claim amounts
- `payout_distributors` — Marinade/DAO fee recipients
- `payout_type` — `marinade` or `prime` (two known institutional staking programs)

Config contract (`config.yaml`): `bondsConfig`, `stakerAuthorityFilter`,
`psrPercentile`, `psrGraceDowntimeBps`, `validatorFeeBps`, `distributorFeeBps`.

## Public API

Base: institutional staking API (internal — ask ops for URL)

- `GET /v1/validators` — institutional validators
- `GET /v1/payouts` — payout records
- `GET /v1/validator-payouts` — per-validator payout breakdown
- `GET /v1/percentiles` — PSR percentile data
- `GET /v1/configs` — scoring config used per epoch
- `GET /v1/epoch` — available epochs
