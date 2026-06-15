---
name: marinade-docs
description: >
  Index of all Marinade documentation sites, APIs, and public GitHub repos.
  USE when you need to find where to look for Marinade-related information,
  explore live API schemas, or find a public repo to clone. NOT for
  protocol internals (use marinade-sam-bond) or deep research (use /find).
user-invocable: true
---

# Marinade Docs & Resources

## Documentation

| Site                          | URL                                                 |
| ----------------------------- | --------------------------------------------------- |
| Marinade main docs            | `https://docs.marinade.finance`                     |
| Validator Bonds API (OpenAPI) | `https://validator-bonds-api.marinade.finance/docs` |
| PSR / bond dashboard          | `https://validator-bonds.marinade.finance`          |

## Live APIs

| API            | Base URL                                       | Notes                                                                              |
| -------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Bonds API      | `https://validator-bonds-api.marinade.finance` | `/bonds/bidding`, `/bonds/institutional`, `/protected-events`, `/v1/announcements` |
| Scoring API    | `https://scoring.marinade.finance/api/v1`      | `/scores/sam?epoch=N`                                                              |
| Validators API | `https://validators-api.marinade.finance`      | validator meta                                                                     |
| Finance API    | `https://api.marinade.finance`                 | mSOL/MNDE rates                                                                    |

## Public GitHub Repos (`marinade-finance/`)

Clone under `.refs/<name>` for local exploration.

| Repo                     | What's there                                                         | Clone                                                                                               |
| ------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `validator-bonds`        | This repo — on-chain program, SDK, settlement CLIs                   | —                                                                                                   |
| `ds-sam`                 | SAM auction, bid-too-low trigger, clearing price, `clipBondStakeCap` | `git clone https://github.com/marinade-finance/ds-sam .refs/ds-sam`                                 |
| `ds-sam-pipeline`        | Epoch-by-epoch auction inputs/outputs                                | `git clone https://github.com/marinade-finance/ds-sam-pipeline .refs/ds-sam-pipeline`               |
| `solana-snapshot-parser` | Produces `stakes.json` / `validators.json`                           | `git clone https://github.com/marinade-finance/solana-snapshot-parser .refs/solana-snapshot-parser` |
| `liquid-staking-program` | Core mSOL staking program                                            | `git clone https://github.com/marinade-finance/liquid-staking-program .refs/liquid-staking-program` |

## Private Repos (`gh auth login` required)

| Repo                    | What's there                                     |
| ----------------------- | ------------------------------------------------ |
| `ds-scoring`            | NestJS scoring service; BondRiskFee calculation  |
| `sam-blacklist`         | Blacklist policy (sandwich, slow slots criteria) |
| `institutional-staking` | Institutional payout calc + APY config           |
| `stakes-etl`            | BigQuery ETL for stake accounts                  |

## GCS Data

| Bucket                                           | Contents                            |
| ------------------------------------------------ | ----------------------------------- |
| `gs://marinade-validator-bonds-mainnet/{epoch}/` | Settlement inputs/outputs per epoch |
| `gs://marinade-stakes-etl-mainnet/{epoch}/`      | Stake snapshots, reward files       |
