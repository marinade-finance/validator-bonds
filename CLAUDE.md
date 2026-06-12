# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Solana monorepo for **Validator Bonds** — an on-chain protocol where validators post bonds as collateral for Marinade stake. Settlements distribute SOL to stakers affected by protected events (PSR) or validator bidding.

Key data flow: snapshot → bid-distribution CLI → settlement JSON → merkle trees → on-chain settlements → claims.

## Build & Test

```sh
# Rust (all workspace crates)
cargo build                          # debug build (default)
cargo build --release --bin bid-distribution-cli

# TypeScript (SDK, CLI, packages)
pnpm install
pnpm build                           # anchor:build + all packages

# Linting
cargo fmt -- --check && cargo clippy --release   # or: pnpm lint:cargo
eslint . && prettier --check .                   # or: pnpm lint:ts
pnpm check                           # both

# Auto-fix
pnpm fix                             # prettier + eslint + cargo fmt + clippy --fix

# Tests
cargo test --features no-entrypoint -- --nocapture    # unit (fast)
pnpm test:unit                       # TS unit tests (sanity-check, cli-core, bonds-eventing)
pnpm test:bankrun                    # bankrun JS tests (builds anchor first)
pnpm test:validator                  # anchor test (full, slow)

# Run a single bankrun test file
FILE=path/to/test.spec.ts pnpm test:bankrun

# After on-chain program changes — sync IDL to SDK and resources
pnpm copy:idl

# Refresh institutional distribution test fixtures from private repo
pnpm test:download-institutional

# Run CLI from source
pnpm cli --help
pnpm cli:institutional --help
pnpm cli:check --help

# Publishing (requires MIXPANEL_TOKEN env var for CLI packages)
MIXPANEL_TOKEN=<token> pnpm publish:cli
pnpm publish:sdk
```

Rust toolchain: `1.88.0` (see `rust-toolchain.toml`). Anchor: `0.31.1`, Solana: `2.3.1` (see `Anchor.toml`). Node ≥ 20.18.0 required.

## Simulation & Regression

```sh
# Regression test against production GCS data (caches inputs in ./regression-data)
./scripts/regression-test-settlements.sh --start-epoch 918 --end-epoch 918 --data-dir ./regression-data

# Fee simulation: runs bid-distribution-cli at multiple fee tiers; -t writes <tag>.yml AND renders <tag>.png
bun scripts/simulate-fee.ts -t <tag> <epoch|start-end> [max_fee_bps]...
# Render a chart standalone (simulate-fee -t already does this)
bun scripts/report-chart.ts <tag>.yml
```

Scripts in `scripts/` use `#!/usr/bin/env bun` (not `pnpm ts-node`).

## Architecture

### Rust workspace members

| Crate                                                 | Purpose                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `programs/validator-bonds`                            | Anchor on-chain program (the contract)                          |
| `common-rs`                                           | Shared Rust types: bond DTOs, settlement, config                |
| `merkle-tree`                                         | Generic Merkle tree library                                     |
| `bonds-collector`                                     | CLI: loads on-chain bond data → YAML                            |
| `api`                                                 | Warp HTTP server (OpenAPI) serving bonds data from Postgres     |
| `settlement-pipelines`                                | Pipeline CLIs: init/fund/claim/close settlements on-chain       |
| `settlement-distributions/bid-distribution`           | Core engine: SAM scores + rewards → bidding/PSR settlement JSON |
| `settlement-distributions/institutional-distribution` | Settlement engine for institutional staking payouts             |
| `settlement-distributions/merkle-generator`           | Generates Merkle tree JSON from settlement collections          |
| `settlement-distributions/settlement-common`          | Shared types: `SettlementCollection`, `StakeMetaIndex`          |

### TypeScript packages (`packages/`)

| Package                             | Purpose                                      |
| ----------------------------------- | -------------------------------------------- |
| `validator-bonds-sdk`               | Anchor-generated SDK + instruction builders  |
| `validator-bonds-cli`               | Public-facing CLI (`pnpm cli`)               |
| `validator-bonds-cli-institutional` | Institutional CLI                            |
| `validator-bonds-cli-core`          | Shared CLI utilities, notifications, banners |
| `validator-bonds-sanity-check`      | Settlement sanity verification CLI           |
| `bonds-eventing`                    | Event parsing utilities                      |
| `validator-bonds-codama`            | Codama-generated client                      |

### bid-distribution engine (`settlement-distributions/bid-distribution/src/`)

The core off-chain computation. Inputs: SAM scores JSON, stakes snapshot JSON, rewards JSON files. Output: settlement collection + Merkle tree collection JSONs.

- `generators/bidding.rs` — computes bidding settlement claims from SAM auction results
- `generators/psr_events.rs` — computes PSR (Protected Staker Rate) event claims
- `generators/sam_penalties.rs` — bid-too-low and blacklist penalty claims
- `settlement_config.rs` — **do not modify** (fee config and settlement type mapping loaded from `settlement-config.yaml`)
- `rewards.rs` — parses inflation/MEV/block rewards input files
- `sam_meta.rs` — parses SAM scoring JSON
- `apy_api.rs` — fetches SSI/SSR PMPE from `apy.marinade.finance`

### Pipeline automation (`.buildkite/`)

Each YAML pipeline corresponds to a stage in the epoch settlement cycle:
`scheduler-bidding.yml` → `prepare-bid-distribution.yml` → `init-settlements.yml` → `fund-settlements.yml` → `claim-settlements.yml` → `close-settlements.yml`

Data is staged in GCS bucket `marinade-validator-bonds-mainnet/<epoch>/`.

### Configuration

`settlement-config.yaml` at repo root configures the bid-distribution CLI (fee parameters, whitelist authorities, settlement types). This is the production config — simulation overrides use separate flags or env vars.

### Deployment runbooks (`runbooks/`)

Surfpool-based deployment scripts for on-chain program upgrades. See `runbooks/README.md` for setup; `txtx.yml` at repo root is the Surfpool config.

## Key Constraints

- `settlement-distributions/bid-distribution/src/settlement_config.rs` is **read-only** — never modify it.
- Never modify `.buildkite/` pipelines without understanding the full epoch flow.
- The `facts/` directory contains distilled knowledge about SAM auction mechanics, contract behavior, and historical decisions — read relevant files before touching settlement logic.
- `DEV_GUIDE.md` covers ops procedures: CLI broadcast banners (via marinade-notifications API) and CLI telemetry (Mixpanel via mix-proxy).
- Epochs ≥928 use unified pipeline output (`bid-distribution-settlements.json` + `unified-merkle-trees.json`); epochs ≤927 have separate SAM/PSR files. The regression script detects the format automatically.
- Open bug: division-by-zero panic in `generators/bidding.rs` when `active_stake + redelegation_stake == 0` — `staker_yield_pmpe` is computed before the `> 0` guard fires. Not yet fixed.
