# ds-scoring

Private repo (`marinade-finance/ds-scoring`). Marinade delegation-strategy
scoring service — computes per-validator scores consumed by ds-sam for stake
allocation. Clone under `.refs/ds-scoring` if access is needed
(`gh auth login` first).

## Role in pipeline

`computeScoring` (CLI) fetches validators, TVL, rewards, Jito MEV records,
bonds, blacklist, and vote snapshots; then computes cluster data, eligibility,
scores, stakes, and unstake hints. Outputs:

- `snapshot/scores.csv` — per-validator scores
- `snapshot/unstake-hints.json` — validators to reduce stake on
- `snapshot/params.json` — scoring run parameters
- `snapshot/summary.md`

Scores are uploaded to the API and consumed by ds-sam as an input to auction
eligibility and PMPE calculations.

## Scoring dimensions (index-sensitive, do not reorder)

1. vote credits
2. block production
3. inflation commission
4. MEV commission
5. country stake concentration
6. city stake concentration
7. ASO stake concentration
8. node stake concentration

## Public API

Base: `https://scoring.marinade.finance`

- `GET /api/v1/scores/sam` — SAM scores (all epochs)
- `GET /api/v1/scores/sam/last` — latest SAM scores
- `GET /api/v1/reports/summary` — combined stake/unstake summary

SAM scores include `epoch`, `scoringId`, and per-validator fields consumed
by the auction. Uploaded via `POST /api/v1/scores/sam/upload` (operator only).

## Scoring library

`packages/scoring` (`@marinade.finance/scoring`) is a pure TypeScript
computation package with no NestJS/DB dependency. Default config:
`packages/scoring/src/constants/marinade.json`. Runtime scoring weights
are recalculated from recent rewards by `computeScoring` before export
(`snapshot/params.json` shows the effective weights used).
