# institutional-staking

Marinade's **Select program** — native (non-liquid) staking with a guaranteed
minimum APY. 24 institutional validators are enrolled; their bonds back the
guarantee. If a validator's epoch yield falls short of the PSR floor (50th
percentile of network APY by default), the shortfall is paid from their bond
via an `InstitutionalPayout` settlement.

## The institutional validator set

Currently 24 validators. Get the live list from the dashboard at
`https://select.marinade.finance` or via the API:
`GET https://institutional-staking.marinade.finance/v1/validators`
→ `{ validators: [ { name, vote_pubkey }, ... ] }`

## What the guarantee means

- **Floor APY**: stakers receive at least the network PSR percentile APY each
  epoch (configured as `psr_percentile`, default 50th percentile).
- **Uptime ranking**: validators ranked by voting credits each epoch; downtime
  outliers (`psr_grace_downtime_bps` threshold) lose their validator fee and
  stakers are subsidized instead.
- **Bond-backed**: shortfall is paid from the validator's bond, not from
  Marinade treasury.
- **Fees**: `validator_fee_bps` + `distributor_fee_bps` deducted from total
  payout; remainder goes to stakers. Both are config-set (current defaults
  10bps / 30bps — they can change); read the live values from
  `GET /v1/configs/latest`.

## Pipeline

1. Each epoch: the private `institutional-staking` repo computes payout amounts
   and stores per-validator JSON to `gs://marinade-institutional-staking-mainnet/{epoch}/`
2. `institutional-distribution-cli` reads those pre-computed amounts and produces
   settlement collection files (off-chain). Key fields it reads:
   - `payout_stakers` — lamport amount to distribute to stakers
   - `payout_distributors` — lamport amount for distributor fee
   - `psr_percentile_apy` — the percentile APY floor used as guarantee
   - `apy_percentile_diff` — shortfall vs floor (basis of the payout)
3. validator-bonds settlement pipeline (`init-settlement`, `fund-settlement`,
   `claim-settlement`) creates and funds the on-chain accounts

Public code for working with the output format:
[`packages/validator-bonds-cli-institutional`](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli-institutional)

The `institutional-staking` repo itself is private; only the API and GCS data
are publicly accessible.

## Public API

Base: `https://institutional-staking.marinade.finance`

OpenAPI spec: `GET /docs-json`
Swagger UI: `GET /docs`

| Route                               | Returns                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| `GET /v1/validators`                | Current enrolled validators (name + vote_pubkey)             |
| `GET /v1/validators/latest`         | Per-epoch performance data for latest epoch (all validators) |
| `GET /v1/validators/epoch`          | Same, for `?from_epoch=N&to_epoch=N` range                   |
| `GET /v1/payouts/latest`            | All payout records for latest epoch (staker + distributor)   |
| `GET /v1/payouts/epoch`             | Same, for epoch range                                        |
| `GET /v1/validator-payouts/latest`  | Per-validator fee breakdown for latest epoch                 |
| `GET /v1/percentiles/latest`        | PSR percentile APY used as the guarantee floor               |
| `GET /v1/configs/latest`            | Active config: psr_percentile, fees, staker_authorities      |
| `GET /v1/staker-authorities/latest` | Staker authority addresses eligible for payouts              |
| `GET /v1/epoch/latest`              | Composite: all of the above in one response                  |
| `GET /health`                       | `{ status, timestamp }`                                      |

## Dashboard

`https://select.marinade.finance` — Select program dashboard (live validator
list, payout history, APY performance).
