# institutional-staking

Marinade's **Select program** — native (non-liquid) staking with a guaranteed
minimum APY. 24 institutional validators are enrolled; their bonds back the
guarantee. If a validator's epoch yield falls short of 50bps annualized, the
shortfall is paid from their bond via an `InstitutionalPayout` settlement.

## The institutional validator set

Currently 24 validators. Get the live list from the dashboard at
`https://select.marinade.finance` or via the API:
`GET https://institutional-staking.marinade.finance/v1/validators`
→ `{ validators: [ { name, vote_pubkey }, ... ] }`

## What the guarantee means

- **Floor APY**: stakers receive at least 50bps/year regardless of validator performance.
- **Uptime ranking**: validators are ranked by voting credits each epoch; downtime
  outliers lose their validator fee (stakers are subsidized instead).
- **Bond-backed**: underperformance is compensated from the validator's bond,
  not from Marinade treasury.
- **Epoch output**: ~3900 staker claims + 24 distributor records per epoch
  (distributor = Marinade/DAO fee).

## Public API

Base: `https://institutional-staking.marinade.finance`

- `GET /v1/validators` — the 24 enrolled validators (name + vote_pubkey)
- `GET /v1/payouts/latest` — all payout records for the most recent epoch;
  `payout_type`: `staker` (individual claim) or `distributor` (Marinade/DAO fee)

## Dashboard

`https://select.marinade.finance` — Select program dashboard.
