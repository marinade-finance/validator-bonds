---
name: marinade-docs
description: Index of Marinade documentation site URLs, live API base URLs/endpoints/OpenAPI schemas, GCS bucket paths, and per-repo clone commands. NOT for protocol internals (use marinade-sam-bond), the repo/program-ID/SDK map (use marinade-ecosystem), or deep code research (use find).
when_to_use: where do I find, which API, API endpoint, OpenAPI schema, docs URL, docs.marinade.finance, bonds API URL, scoring API, validators API, finance API, institutional staking API, select API, psr dashboard URL, clone a repo, repo URL, .refs clone command, GCS bucket path, where to look, what URL, live API base url
user-invocable: true
---

# Marinade Docs & Resources

## Documentation

| Site                          | URL                                                 |
| ----------------------------- | --------------------------------------------------- |
| Marinade main docs            | `https://docs.marinade.finance`                     |
| Validator Bonds API (OpenAPI) | `https://validator-bonds-api.marinade.finance/docs` |
| PSR / bond dashboard          | `https://psr.marinade.finance`                      |

## Live APIs

| API            | Base URL                                         | Notes                                                                                                        |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Bonds API      | `https://validator-bonds-api.marinade.finance`   | `/bonds/bidding`, `/bonds/institutional`, `/protected-events`, `/v1/announcements`                           |
| Scoring API    | `https://scoring.marinade.finance/api/v1`        | `/scores/sam?epoch=N`                                                                                        |
| Validators API | `https://validators-api.marinade.finance`        | validator meta                                                                                               |
| Finance API    | `https://api.marinade.finance`                   | mSOL/MNDE rates                                                                                              |
| Institutional  | `https://institutional-staking.marinade.finance` | `/v1/validators`, `/v1/payouts/latest`, `/docs-json`; routes in `marinade-sam-bond/institutional-staking.md` |

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

| Repo                    | What's there                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `ds-scoring`            | Legacy scoring service; feeds per-validator scores to ds-sam |
| `sam-blacklist`         | Blacklist policy (sandwich, slow slots criteria)             |
| `institutional-staking` | Institutional payout calc + APY config                       |
| `stakes-etl`            | BigQuery ETL for stake accounts                              |

## GCS Data

| Bucket                                           | Contents                            |
| ------------------------------------------------ | ----------------------------------- |
| `gs://marinade-validator-bonds-mainnet/{epoch}/` | Settlement inputs/outputs per epoch |
| `gs://marinade-stakes-etl-mainnet/{epoch}/`      | Stake snapshots, reward files       |
