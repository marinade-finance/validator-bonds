# Validator Bonds

<!-- shields validator-bonds program version is loaded from resources/idl/.json -->

<a href="https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmarinade-finance%2Fvalidator-bonds%2Fmain%2Fresources%2Fidl%2Fvalidator_bonds.json&query=%24.metadata.version&label=program&logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iMzEzIiBoZWlnaHQ9IjI4MSIgdmlld0JveD0iMCAwIDMxMyAyODEiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMF80NzZfMjQzMCkiPgo8cGF0aCBkPSJNMzExLjMxOCAyMjEuMDU3TDI1OS42NiAyNzYuNTU4QzI1OC41MzcgMjc3Ljc2NCAyNTcuMTc4IDI3OC43MjUgMjU1LjY2OSAyNzkuMzgyQzI1NC4xNTkgMjgwLjAzOSAyNTIuNTMgMjgwLjM3OCAyNTAuODg0IDI4MC4zNzdINS45OTcxOUM0LjgyODcgMjgwLjM3NyAzLjY4NTY4IDI4MC4wMzUgMi43MDg1NSAyNzkuMzkzQzEuNzMxNDMgMjc4Ljc1MSAwLjk2Mjc3MSAyNzcuODM3IDAuNDk3MDIgMjc2Ljc2NEMwLjAzMTI2OTEgMjc1LjY5IC0wLjExMTI4NiAyNzQuNTA0IDAuMDg2ODcxMiAyNzMuMzVDMC4yODUwMjggMjcyLjE5NiAwLjgxNTI2NSAyNzEuMTI2IDEuNjEyNDMgMjcwLjI3TDUzLjMwOTkgMjE0Ljc2OUM1NC40Mjk5IDIxMy41NjYgNTUuNzg0MyAyMTIuNjA3IDU3LjI4OTMgMjExLjk1QzU4Ljc5NDMgMjExLjI5MyA2MC40MTc4IDIxMC45NTMgNjIuMDU5NSAyMTAuOTVIMzA2LjkzM0MzMDguMTAxIDIxMC45NSAzMDkuMjQ0IDIxMS4yOTIgMzEwLjIyMSAyMTEuOTM0QzMxMS4xOTkgMjEyLjU3NiAzMTEuOTY3IDIxMy40OSAzMTIuNDMzIDIxNC41NjRDMzEyLjg5OSAyMTUuNjM3IDMxMy4wNDEgMjE2LjgyNCAzMTIuODQzIDIxNy45NzdDMzEyLjY0NSAyMTkuMTMxIDMxMi4xMTUgMjIwLjIwMSAzMTEuMzE4IDIyMS4wNTdaTTI1OS42NiAxMDkuMjk0QzI1OC41MzcgMTA4LjA4OCAyNTcuMTc4IDEwNy4xMjcgMjU1LjY2OSAxMDYuNDdDMjU0LjE1OSAxMDUuODEzIDI1Mi41MyAxMDUuNDc0IDI1MC44ODQgMTA1LjQ3NUg1Ljk5NzE5QzQuODI4NyAxMDUuNDc1IDMuNjg1NjggMTA1LjgxNyAyLjcwODU1IDEwNi40NTlDMS43MzE0MyAxMDcuMTAxIDAuOTYyNzcxIDEwOC4wMTUgMC40OTcwMiAxMDkuMDg4QzAuMDMxMjY5MSAxMTAuMTYyIC0wLjExMTI4NiAxMTEuMzQ4IDAuMDg2ODcxMiAxMTIuNTAyQzAuMjg1MDI4IDExMy42NTYgMC44MTUyNjUgMTE0LjcyNiAxLjYxMjQzIDExNS41ODJMNTMuMzA5OSAxNzEuMDgzQzU0LjQyOTkgMTcyLjI4NiA1NS43ODQzIDE3My4yNDUgNTcuMjg5MyAxNzMuOTAyQzU4Ljc5NDMgMTc0LjU1OSA2MC40MTc4IDE3NC44OTkgNjIuMDU5NSAxNzQuOTAySDMwNi45MzNDMzA4LjEwMSAxNzQuOTAyIDMwOS4yNDQgMTc0LjU2IDMxMC4yMjEgMTczLjkxOEMzMTEuMTk5IDE3My4yNzYgMzExLjk2NyAxNzIuMzYyIDMxMi40MzMgMTcxLjI4OEMzMTIuODk5IDE3MC4yMTUgMzEzLjA0MSAxNjkuMDI4IDMxMi44NDMgMTY3Ljg3NUMzMTIuNjQ1IDE2Ni43MjEgMzEyLjExNSAxNjUuNjUxIDMxMS4zMTggMTY0Ljc5NUwyNTkuNjYgMTA5LjI5NFpNNS45OTcxOSA2OS40MjY3SDI1MC44ODRDMjUyLjUzIDY5LjQyNzUgMjU0LjE1OSA2OS4wODkgMjU1LjY2OSA2OC40MzJDMjU3LjE3OCA2Ny43NzUxIDI1OC41MzcgNjYuODEzOSAyNTkuNjYgNjUuNjA4MkwzMTEuMzE4IDEwLjEwNjlDMzEyLjExNSA5LjI1MTA3IDMxMi42NDUgOC4xODA1NiAzMTIuODQzIDcuMDI2OTVDMzEzLjA0MSA1Ljg3MzM0IDMxMi44OTkgNC42ODY4NiAzMTIuNDMzIDMuNjEzM0MzMTEuOTY3IDIuNTM5NzQgMzExLjE5OSAxLjYyNTg2IDMxMC4yMjEgMC45ODM5NDFDMzA5LjI0NCAwLjM0MjAyNiAzMDguMTAxIDMuOTUzMTRlLTA1IDMwNi45MzMgMEw2Mi4wNTk1IDBDNjAuNDE3OCAwLjAwMjc5ODY2IDU4Ljc5NDMgMC4zNDMxNCA1Ny4yODkzIDAuOTk5OTUzQzU1Ljc4NDMgMS42NTY3NyA1NC40Mjk5IDIuNjE2MDcgNTMuMzA5OSAzLjgxODQ3TDEuNjI1NzYgNTkuMzE5N0MwLjgyOTM2MSA2MC4xNzQ4IDAuMjk5MzU5IDYxLjI0NCAwLjEwMDc1MiA2Mi4zOTY0Qy0wLjA5Nzg1MzkgNjMuNTQ4OCAwLjA0MzU2OTggNjQuNzM0MiAwLjUwNzY3OSA2NS44MDczQzAuOTcxNzg5IDY2Ljg4MDMgMS43Mzg0MSA2Ny43OTQzIDIuNzEzNTIgNjguNDM3MkMzLjY4ODYzIDY5LjA4MDIgNC44Mjk4NCA2OS40MjQgNS45OTcxOSA2OS40MjY3WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzQ3Nl8yNDMwKSIvPgo8L2c+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfNDc2XzI0MzAiIHgxPSIyNi40MTUiIHkxPSIyODcuMDU5IiB4Mj0iMjgzLjczNSIgeTI9Ii0yLjQ5NTc0IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIG9mZnNldD0iMC4wOCIgc3RvcC1jb2xvcj0iIzk5NDVGRiIvPgo8c3RvcCBvZmZzZXQ9IjAuMyIgc3RvcC1jb2xvcj0iIzg3NTJGMyIvPgo8c3RvcCBvZmZzZXQ9IjAuNSIgc3RvcC1jb2xvcj0iIzU0OTdENSIvPgo8c3RvcCBvZmZzZXQ9IjAuNiIgc3RvcC1jb2xvcj0iIzQzQjRDQSIvPgo8c3RvcCBvZmZzZXQ9IjAuNzIiIHN0b3AtY29sb3I9IiMyOEUwQjkiLz4KPHN0b3Agb2Zmc2V0PSIwLjk3IiBzdG9wLWNvbG9yPSIjMTlGQjlCIi8+CjwvbGluZWFyR3JhZGllbnQ+CjxjbGlwUGF0aCBpZD0iY2xpcDBfNDc2XzI0MzAiPgo8cmVjdCB3aWR0aD0iMzEyLjkzIiBoZWlnaHQ9IjI4MC4zNzciIGZpbGw9IndoaXRlIi8+CjwvY2xpcFBhdGg+CjwvZGVmcz4KPC9zdmc+Cg==&color=9945FF" /></a>
<a href="https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli"><img src="https://img.shields.io/npm/v/%40marinade.finance%2Fvalidator-bonds-cli?logo=npm&color=377CC0" /></a>
<a href="https://github.com/marinade-finance/validator-bonds/actions/workflows/release.yml"><img src="https://img.shields.io/badge/Create-Release-blue?logo=github" alt="Create Github Release Notes" /></a>

Solana monorepo for Validator Bonds — an on-chain protocol where validators post bonds as collateral
for Marinade stake. Settlements distribute SOL to stakers affected by protected events (PSR) or
validator bidding.

Key data flow: snapshot → bid-distribution CLI → settlement JSON → merkle trees → on-chain
settlements → claims.

## Installation

Requires: Rust toolchain `1.88.0` (see `rust-toolchain.toml`), Node ≥ 20.18.0, `pnpm`.

```sh
pnpm install   # TypeScript deps
cargo build    # Rust workspace (debug)
```

## Usage

```sh
# Public-facing CLI
pnpm cli --help

# Institutional CLI
pnpm cli:institutional --help

# Settlement sanity check
pnpm cli:check --help

# Collect on-chain bond data to YAML
cargo build --release
./target/release/bonds-collector collect-bonds -u "$RPC_URL" > bonds.yaml

# Store bonds YAML to Postgres
./target/release/validator-bonds-api-cli \
  store-bonds --postgres-url "$POSTGRES_URL" --input-file bonds.yaml

# Run the bonds API server (port 8000)
./target/release/api \
  --postgres-url "$POSTGRES_URL" \
  --postgres-ssl-root-cert "$POSTGRES_SSL_ROOT_CERT"
```

## Build & Test

```sh
pnpm build                                         # anchor:build + all TS packages
pnpm check                                         # lint (cargo + TS)
pnpm fix                                           # auto-fix formatting + clippy

cargo test --features no-entrypoint -- --nocapture # Rust unit tests
pnpm test:unit                                     # TS unit tests
pnpm test:bankrun                                  # bankrun integration tests
FILE=path/to/test.spec.ts pnpm test:bankrun        # single bankrun file
pnpm test:validator                                # anchor test (full, slow)

# After on-chain program changes — sync IDL to SDK and resources
pnpm copy:idl
```

## Simulation & Regression

```sh
# Regression test against production GCS data
./scripts/regression-test-settlements.sh \
  --start-epoch 918 --end-epoch 918 --data-dir ./regression-data

# Fee simulation across tiers — writes YAML report
bun scripts/simulate-fee.ts [-r] [-v] [-c] [-d DIR] <epoch|start-end> [-m <min_fee>] [<max_fee>]...
```

Scripts in `scripts/` use `#!/usr/bin/env bun`.

## Epoch Pipeline

Automated via `.buildkite/` pipelines, staged in GCS
`marinade-validator-bonds-mainnet/<epoch>/`:

```
scheduler-bidding → prepare-bid-distribution → init-settlements
  → fund-settlements → claim-settlements → close-settlements
```

![Validator Bonds Workflow](./resources/diagram/validator-bonds-workflow.svg)

## Contract Audits

- [Neodyme](https://neodyme.io), tag [`contract-v1.4.0`](https://github.com/marinade-finance/validator-bonds/tree/contract-v1.4.0),
  commit `7e6d35e` — [audit document](./resources/audit/v1.4.0-neodyme-audit-validator-bonds.pdf)
- [Neodyme](https://neodyme.io), tag [`contract-v2.1.0`](https://github.com/marinade-finance/validator-bonds/tree/contract-v2.1.0),
  commit `4a5b009` — [audit document](./resources/audit/v2.1.0-neodyme-audit-validator-bonds.pdf)

## Further Reading

- [CLAUDE.md](./CLAUDE.md) — component index, bid-distribution engine internals, key constraints
- [DEV_GUIDE.md](./DEV_GUIDE.md) — ops procedures: CLI banners, telemetry, publishing
- [runbooks/README.md](./runbooks/README.md) — on-chain program deployment via Surfpool
- [packages/validator-bonds-cli/README.md](./packages/validator-bonds-cli/README.md) — CLI reference
- [programs/validator-bonds/README.md](./programs/validator-bonds/README.md) — on-chain program details
- [bonds-collector/README.md](./bonds-collector/README.md) — bonds-collector details
- [api/README.md](./api/README.md) — API server details
