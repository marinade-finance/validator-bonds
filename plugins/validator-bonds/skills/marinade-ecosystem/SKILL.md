---
name: marinade-ecosystem
description: Marinade Finance public ecosystem map — repos, program IDs, SDKs, APIs, issue filing. NOT for Validator Bonds protocol internals (use marinade-sam-bond).
when_to_use: marinade-finance GitHub org, liquid-staking-program, ds-sam, ds-scoring, delegation-strategy, institutional-staking, marinade.finance site, filing an issue, program IDs, mSOL mint, MNDE token, marinade-ts-sdk, configGetter, psr.marinade.finance, scoring.marinade.finance, cross-repo navigation, how repos relate
---

# Marinade Ecosystem

Non-custodial liquid staking protocol on Solana. Three products:
mSOL (liquid staking), native staking, SAM (stake auction marketplace).

## Public Sites & Links

| Resource         | URL                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------- |
| Main app         | https://marinade.finance/                                                              |
| Docs             | https://docs.marinade.finance/                                                         |
| Docs (beta)      | https://docs-beta.marinade.finance/                                                    |
| PSR Dashboard    | https://psr.marinade.finance/                                                          |
| Bonds API        | https://validator-bonds-api.marinade.finance/docs                                      |
| SAM scoring API  | https://scoring.marinade.finance/api/v1/scores/sam?epoch=X                             |
| GitHub org       | https://github.com/marinade-finance/                                                   |
| npm packages     | https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli                    |
| PSR explainer    | https://marinade.finance/how-it-works/psr                                              |
| PSR blog post    | https://marinade.finance/blog/introducing-protected-staking-rewards/                   |
| SAM docs         | https://docs.marinade.finance/marinade-protocol/protocol-overview/stake-auction-market |
| Discord PSR feed | https://discord.com/channels/823564092379627520/1223330302890348754                    |
| GCS epoch data   | https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet      |

ALWAYS verify addresses at https://docs-beta.marinade.finance/developers/contracts/

## Filing Issues

- **Bugs / feature requests:** Open an issue at https://github.com/marinade-finance/<repo>/issues
- **Validator bonds specifically:** https://github.com/marinade-finance/validator-bonds/issues
- **Community support:** Discord PSR feed channel (link above) for PSR/bond questions
- **Notifications:** Validators can subscribe via CLI (`bonds subscribe --type telegram --address <handle>`) for bond event alerts

## Domain Concepts

- **mSOL** — liquid staking token, stake SOL get mSOL for DeFi
- **SAM** — stake auction marketplace, epoch-based validator bidding
- **PSR** — protected staking rewards, bond collateral for underperformance

## Program IDs & Tokens

| Name                 | Address                                       |
| -------------------- | --------------------------------------------- |
| Liquid Staking       | `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD` |
| Native Staking Proxy | `mnspJQyF1KdDEs5c6YJPocYdY1esBgVQFufM2dY9oDk` |
| Directed Stake       | `dstK1PDHNoKN9MdmftRzsEbXP5T1FTBiQBm1Ee3meVd` |
| Validator Bonds      | `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4` |
| mSOL Mint            | `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` |
| MNDE Token           | `MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey` |

## Public Repos

All at https://github.com/marinade-finance/

### On-chain Programs

- **liquid-staking-program** — core mSOL staking + swap pool (Anchor/Rust)
- **validator-bonds** — bond accounts + settlement pipeline (Anchor/Rust, TS SDK/CLI, Rust API)
- **vote-aggregator** — aggregated delegation plugin for spl-governance
- **voter-stake-registry** — vote weight plugin, token lockups
- **tokadapt** — 1:1 token swap contract

### Delegation & Scoring

- **ds-sam** — SAM evaluation CLI + SDK (`ds-sam-sdk`), APIS/FILES modes
- **ds-sam-pipeline** — SAM pipeline orchestration
- **ds-scoring** — NestJS scoring service for validators
- **delegation-strategy-2** — validator scoring API, stake allocation
- **sam-blacklist** — blacklist generator (sandwich + slow slot data)
- **marcrank** — management CLI for liquid-staking-program delegation
- **malicious-validators** — validator abuse tracking

### SDKs & Libraries

- **marinade-ts-sdk** — liquid staking TS SDK (deposit, unstake, liquidity)
- **marinade-ts-cli** — TS CLI client for Marinade
- **typescript-common** — pnpm monorepo of `@marinade.finance/*` packages
- **go-common** — reusable Go packages (config, logger)
- **solana-transaction-builder** — Rust tx builder utility
- **solana-transaction-executor** — Rust tx execution
- **marinade-common-rs-cli** — Rust common CLI library

### Products & Services

- **native-staking** — native staking app, validator selection via SAM
- **institutional-staking** — institutional staking product (calc + API)
- **marinade-web** — marinade.finance frontend
- **staking-rewards** — rewards collector backend
- **staking-rewards-facade** — NestJS GraphQL API (filters, CSV/XLSX/PDF)
- **apy-api** — APY wrapper using @glitchful-dev/sol-apy-sdk
- **psr-dashboard** — PSR validator bond dashboard
- **marinade-sam-bot** — optimal SAM bid calculator

### Infrastructure & Data

- **stakes-etl** — ETL pipelines to Google BigQuery
- **solana-snapshot-manager** — Solana snapshot parser + API
- **solana-snapshot-parser** — low-level snapshot parsing
- **kedgeree** — reverse PDA/seeded address calculation
- **solana-sandwich-report** — validator sandwich rate API + epoch charts
- **spl-gov-notifier** — SPL governance event notification bot

## Public SDKs

| Package                                | Purpose                                     |
| -------------------------------------- | ------------------------------------------- |
| `@marinade.finance/marinade-ts-sdk`    | Liquid staking: deposit, unstake, liquidity |
| `@marinade.finance/native-staking-sdk` | Native staking integration                  |
| `ds-sam-sdk`                           | SAM delegation strategy evaluation          |

## @marinade.finance Packages

Published from `typescript-common` monorepo:

| Package         | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| `cli-common`    | CLI helpers: keypair loading, tx confirmation, logging |
| `ts-common`     | Shared TS utils: retry, sleep, error handling          |
| `config-common` | `configGetter` pattern for typed env/config access     |
| `nestjs-common` | NestJS modules: health, config, logging, APM           |
| `web3js-kit`    | web3.js 2.x helpers: connection, transaction building  |
| `web3js-1x`     | web3.js 1.x compat layer and helpers                   |
| `anchor-common` | Anchor framework helpers: IDL loading, program access  |

## Patterns

### configGetter

Typed config access from env vars:

```typescript
import { configGetter } from '@marinade.finance/config-common'

const config = configGetter({
  RPC_URL: { type: 'string', required: true },
  PORT: { type: 'number', default: 3000 },
})
```

### pnpm monorepo

All TS repos use pnpm workspaces. `pnpm -r` for recursive, `pnpm --filter <pkg>` for targeting.

### Database

PostgreSQL via Slonik (strict SQL tagged templates, no ORM). NEVER raw string interpolation in queries.

### Runtime

- Bun for new services and scripts
- Node.js for existing NestJS services
- ALWAYS check which runtime the repo uses

### Solana / Anchor

- Anchor framework for on-chain programs (Rust)
- `@marinade.finance/anchor-common` for TS client side
- web3.js 1.x in older code, 2.x in newer (`web3js-kit`)
