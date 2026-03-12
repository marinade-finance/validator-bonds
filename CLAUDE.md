# CLAUDE.md

Marinade Validator Bonds -- Solana protocol protecting stakers via bonds posted by validators.
Monorepo: on-chain Anchor program, TS SDK/CLI, Rust off-chain settlement CLIs, Buildkite pipelines, REST API.

Program ID: `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`

## Build & Test

```bash
pnpm install && pnpm build               # TS deps + Anchor program + all TS packages
cargo build --release                     # all Rust crates
cargo build --release --bin bid-distribution-cli  # single binary

pnpm check                               # cargo fmt --check + clippy + eslint + prettier
pnpm fix                                  # auto-fix all

pnpm test:cargo                           # Rust unit tests (fast)
pnpm test:unit                            # TS sanity-check tests
pnpm test:bankrun                         # Anchor bankrun (requires anchor build)
pnpm test:validator                       # Anchor local-validator tests
cargo test --package bid-distribution     # single crate
cargo test --package settlement-common ts_cross_check_hash_generate  # single test
```

### Local Testing (bid-distribution-cli)

Download epoch data from GCS (`gs://marinade-validator-bonds-mainnet/{epoch}/`) into `./tmp/epoch-data/`, then:

```bash
cargo run --release --bin bid-distribution-cli -- \
  --settlement-config settlement-config.yaml \
  --stakes-json ./tmp/epoch-data/stakes.json \
  --sam-scores-json ./tmp/epoch-data/sam-scores.json \
  --rewards-dir ./tmp/epoch-data/rewards \
  --validators-json ./tmp/epoch-data/validators.json \
  --evaluation-json ./tmp/epoch-data/evaluation.json \
  --output-dir ./tmp/output
```

## Architecture

### On-chain Program (`programs/validator-bonds/`)

Anchor program: 6 state accounts, ~20 instructions.

**States:** Config, Bond (PDA: config+vote_account), BondProduct (PDA: bond+product_type), Settlement (PDA: bond+merkle_root+epoch), SettlementClaims (bitmap dedup), WithdrawRequest (PDA: bond, one per bond).

**Instructions:** config/ (init, configure, emergency pause/resume), bond/ (init, configure, configure_with_mint, mint, fund), bond_product/ (init, configure), settlement/ (init, fund, close_v2, cancel, claim_v2, upsize_claims), withdraw/ (init, cancel, claim), stake/ (merge, reset, withdraw).

**Access control:** admin_authority (config), operator_authority (settlements/funding), pause_authority (emergency), bond authority or validator identity (bond mgmt), permissionless (claims via merkle proof, closing expired settlements).

**PDA seeds:** Bond: `b"bond_account"` + config + vote_account | Settlement: `b"settlement_account"` + bond + merkle_root + epoch_le_bytes | Bonds Withdrawer Authority: `b"bonds_authority"` + config | WithdrawRequest: `b"withdraw_account"` + bond

### TypeScript Packages (`packages/`)

- **`validator-bonds-sdk`** -- Anchor SDK wrapper: queries (`getBond`, `findBonds`, `getSettlement`, `getBondsFunding`), instruction builders, PDA derivation.
- **`validator-bonds-cli`** -- User CLI (Commander.js): bond lifecycle, show/query, fund/withdraw. Supports Ledger, `--simulate`, `--print-only` (base64 for governance).
- **`validator-bonds-cli-core`** -- Shared CLI logic: `launchCliProgram()`, `ValidatorBondsCliContext`, `executeTx()`, compute unit limits.
- **`validator-bonds-cli-institutional`** -- Institutional subset (no admin commands, fixed program ID).
- **`validator-bonds-sanity-check`** -- `check-merkle-tree`: consistency checks, cross-validation, z-score anomaly detection.
- **`validator-bonds-codama`** -- Generated Codama SDK (kit 6.x).

### Settlement Distributions (`settlement-distributions/`)

Rust CLIs generating settlement JSON + merkle trees from off-chain data.

- **`bid-distribution`** (`bid-distribution-cli`) -- Produces all settlement types from single run. Inputs: `settlement-config.yaml`, `stakes.json`, `sam-scores.json`, rewards dir (6 files), `validators.json`, `evaluation.json`. Outputs: `settlements.json` (SettlementCollection), `protected-events.json`.
- **`settlement-common`** -- Shared types: `SettlementCollection`, `Settlement`, `SettlementClaim`, `SettlementReason`, `ProtectedEvent`, `StakeMetaIndex`, `MerkleTreeCollection`. PSR config schema.
- **`institutional-distribution`** (`institutional-distribution-cli`) -- `InstitutionalPayout` settlements from institutional staking data.
- **`merkle-generator`** (`merkle-generator-cli`) -- Merges settlement sources into unified merkle trees, builds proofs, derives on-chain addresses.

**Data flow:** bid-distribution-cli + institutional-distribution-cli -> settlement JSONs -> merkle-generator-cli -> merkle-trees.json -> on-chain pipeline

### Settlement Pipelines (`settlement-pipelines/`)

Rust CLIs for on-chain settlement lifecycle (each a separate binary):

| Binary                 | Purpose                                      | Access         |
| ---------------------- | -------------------------------------------- | -------------- |
| `init-settlement`      | Create Settlement accounts from merkle trees | operator       |
| `fund-settlement`      | Fund from bond stake accounts                | operator       |
| `claim-settlement`     | Claim via merkle proofs                      | permissionless |
| `close-settlement`     | Close expired, reset/withdraw stakes         | permissionless |
| `verify-settlement`    | Sanity check on-chain vs JSON                | read-only      |
| `merge-stakes`         | Consolidate stake accounts per validator     | permissionless |
| `list-settlement`      | Merkle tree JSON -> settlement listing       | offline        |
| `list-claimable-epoch` | Query claimable epochs                       | read-only      |

Exit code 100 = retriable failure (Buildkite retries up to 5x).

### API (`api/`)

Rust warp REST API on PostgreSQL. Endpoints: `/bonds/bidding`, `/bonds/institutional`, `/protected-events`, `/v1/announcements`. OpenAPI at `/docs`. Protected events cached from GCP BigQuery.

### Supporting Crates

- **`bonds-collector/`** -- `collect-bonds --bond-type bidding|institutional` -> YAML, stores to PostgreSQL.
- **`common-rs/`** -- Shared types: account fetching, stake discovery, `ValidatorBondRecord` DTO, RPC retry, PDA constants.

### Buildkite Pipelines (`.buildkite/`)

Epoch-driven, 15 pipeline files. Schedulers detect new epochs, trigger processing.

**Main flow:** `scheduler-bidding` -> `prepare-bid-distribution` -> `generate-merkle-trees` -> `init-settlements` -> `fund-settlements` -> `claim-settlements` -> `close-settlements`

**Parallel:** `scheduler-institutional` -> `prepare-institutional-distribution` -> merges into merkle tree flow

**Supporting:** `collect-bonds`, `merge-stakes`, `verify-settlements`, `sanity-unified`, `sanity-institutional-distribution`

## Config & Data

**settlement-config.yaml** -- settlement types, fee splits (marinade_fee_bps: 950, dao_fee_split_share_bps: 10000), whitelist stake authorities, per-type parameters. See SKILL.md for settlement type details.

| Source          | Location                                                     |
| --------------- | ------------------------------------------------------------ |
| GCS bonds       | `gs://marinade-validator-bonds-mainnet/{epoch}/`             |
| GCS ETL         | `gs://marinade-stakes-etl-mainnet/{epoch}/`                  |
| Scoring API     | `https://scoring.marinade.finance/api/v1/scores/sam?epoch=N` |
| ds-sam-pipeline | GitHub `marinade-finance/ds-sam-pipeline`                    |
| Bonds API       | `https://validator-bonds-api.marinade.finance`               |
