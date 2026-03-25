# Implementation Plan — Eventing, CLI Subscribe & Event Processing Pipeline

## Implementation Status

| Component                               | Status         | Notes                                                                               |
| --------------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| **Part A: Eventing Module**             | ✅ Implemented | `packages/bonds-eventing/` — all source + tests + migration                         |
| **Part B: CLI Subscribe Commands**      | ✅ Implemented | `subscribe`, `unsubscribe`, `subscriptions` commands                                |
| **Buildkite pipeline update**           | ✅ Implemented | Step in `collect-bonds.yml` after Store Bonds                                       |
| **Part C: bonds-event-v1 schema**       | ✅ Implemented | JSON Schema codegen — single source of truth via generated `bonds-event-v1` package |
| **Part C: bonds-notification lib**      | ✅ Implemented | Brain library — `packages/bonds-notification/` in this repo                         |
| **Part C: marinade-notifications side** | ✅ Implemented | Consumer pipeline, ingress, delivery, routing, dedup, outbox                        |
| **Part D: Subscription API (server)**   | ✅ Implemented | Controller, service, bonds verifier, solana-auth, telegram, migration               |
| **Part D: Subscription SDK**            | ✅ Implemented | `ts-subscription-client` in marinade-notifications                                  |
| **Part D: CLI → SDK refactor**          | ✅ Implemented | CLI commands use `createSubscriptionClient` from SDK                                |
| **Part E: Active + Log table design**   | ✅ Implemented | `subscriptions` (mutable) + `subscriptions_log` (audit) tables                      |
| **Part F: typescript-common migration** | ✅ Implemented | `loadFileSync`, `parseAndValidateYaml`, class-validator DTOs                        |
| **Part F: Routing config type safety**  | ✅ Implemented | `BONDS_EVENT_INNER_TYPES` const array + typed routing config keys                   |
| **Telegram delivery via telegram-bot**  | ✅ Implemented | marinade-notifications → `POST /send` → telegram-bot → Telegram Bot API             |
| **telegram-bot bonds support**          | ✅ Implemented | `feature_sam_auction` deep-link, `/send` endpoint, one-owner-per-tracking_id        |
| **Notifications Read API**              | ✅ Implemented | `GET /notifications` public endpoint (no auth) in marinade-notifications            |
| **CLI `show-notifications`**            | ✅ Implemented | `show-notifications` command with --priority, --inner-type, --limit filters         |
| **Part G: DsSamSDK production config**  | ✅ Implemented | `loadSamConfig()` + CLI API URL overrides in `run-auction.ts`                       |
| **Part H: Telegram delivery telemetry** | ✅ Implemented | `telegram_api_calls_total` counter + `telegram_api_duration_seconds` histogram      |
| **Part I: PSR dashboard integration**   | ✅ Implemented | Notification column in SAM table — per-validator icons with tooltip details         |
| **Part J: NotificationFormatter**       | ⏭️ Deferred    | Rich Telegram formatting (emojis, HTML) — not v1, see Part J                        |
| **Part K: marinade-notifications docs** | ✅ Implemented | ARCHITECTURE.md, SPEC.md, README.md updated                                         |
| **bonds-notification npm publish**      | ❌ Not yet     | Currently consumed via local `link:` dependency                                     |

### BondsEventV1 Type — Single Source of Truth (codegen)

The `BondsEventV1` type is defined once in `marinade-notifications/message-types/schemas/bonds-event-v1.json` and auto-generated into a `bonds-event-v1` npm package (types + Ajv validator). All three consumers import from the generated package:

1. **`packages/bonds-eventing/src/types.ts`** — re-exports `BondsEventV1` and `BondsEventInnerType` from `bonds-event-v1`
2. **`packages/bonds-notification/src/types.ts`** — re-exports `BondsEventV1` and `BondsEventInnerType` from `bonds-event-v1`
3. **`marinade-notifications/notification-service/`** — imports `BondsEventV1` and `BondsEventV1Validator` from `bonds-event-v1` (workspace package)

Both validator-bonds packages use `link:` dependencies pointing to the generated package. The marinade-notifications notification-service uses `workspace:*`.

The `marinade-notifications` consumer imports the brain library via local link:

```json
"@marinade.finance/bonds-notification": "link:../../validator-bonds/packages/bonds-notification"
```

This document covers:

- **Part A: Eventing Module** (`packages/bonds-eventing/`) — ✅ implemented
- **Part B: CLI Subscribe Commands** (`packages/validator-bonds-cli-core/`) — ✅ implemented
- **Part C: Event Processing Pipeline** — ✅ implemented
  - C.2: Brain library in this repo (`packages/bonds-notification/`) — ✅ implemented
  - C.3: JSON Schema + codegen in marinade-notifications repo — ✅ implemented
  - C.4: Consumer + ingress + delivery in marinade-notifications repo — ✅ implemented
- **Part D: Subscription Infrastructure** (marinade-notifications repo) — ✅ implemented
  - D.1: Subscription API server-side — ✅ implemented
  - D.2: Subscription SDK (`ts-subscription-client`) — ✅ implemented
  - D.3: CLI refactor to use SDK — ✅ implemented
- **Part E: Subscription Table Redesign** (marinade-notifications repo) — ✅ implemented
  - `subscriptions` (mutable active state) + `subscriptions_log` (immutable audit trail)

Parts A and B live in this repo. Parts C–E span both repos.

### Reusable Libraries from Marinade Ecosystem

Before building anything new, we lean on existing `@marinade.finance/*` packages from `/home/chalda/marinade/typescript-common`:

| Need                        | Package                                | Key symbols                                                     |
| --------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| HTTP fetch with retry       | `@marinade.finance/ts-common`          | `@Retry` decorator, `loadContent`                               |
| Mock HTTP server (tests)    | `@marinade.finance/ts-common`          | `TestHttpServer`, `wrapWithServer`                              |
| slonik DB pool & migrations | `@marinade.finance/nestjs-common`      | `createPoolFactory`, `DatabaseService.runMigrations`            |
| CLI output formatting       | `@marinade.finance/cli-common`         | `printData` (text/yaml/json)                                    |
| Pino logger setup           | `@marinade.finance/ts-common`          | `pinoConfiguration`, `logInfo/Warn/Error`                       |
| Solana wallet/signing       | `@marinade.finance/web3js-1x`          | `Wallet`, `KeypairWallet`, `parseWallet`, `parseWalletOrPubkey` |
| Solana config resolution    | `@marinade.finance/web3js-1x`          | `resolveSolanaConfig`, `parseClusterUrl`                        |
| Off-chain message signing   | `@marinade.finance/ledger-utils`       | `signOffchainMessage`, `formatOffchainMessage`, `LedgerWallet`  |
| Jest shell matchers         | `@marinade.finance/jest-shell-matcher` | `extendJestWithShellMatchers`, `toHaveMatchingSpawnOutput`      |
| Env var helpers             | `@marinade.finance/config-common`      | `getEnvVar`, `getBoolEnvVar`, `getOptionalEnvVar`               |

---

## Part A: Eventing Module ✅

### A.1 Purpose

A new TypeScript package `packages/bonds-eventing/` that runs as a Buildkite step after `store-bonds` in `collect-bonds.yml`. It:

1. Runs `DsSamSDK.run()` which internally fetches bond, validator, and scoring data from APIs
2. Reads the fully computed `AuctionValidator[]` from the result — with `bondGoodForNEpochs`, `lastCapConstraint`, auction status, and all constraint types already evaluated
3. Loads the previous state snapshot from `bond_event_state` table
4. For each validator, compares current state against previous state and emits **delta events** — only when something changed
5. POSTs each event to `marinade-notifications /bonds-event-v1` endpoint (with retry)
6. Writes each emitted event to `emitted_bond_events` table in validator-bonds-api PostgreSQL
7. Upserts current state to `bond_event_state` table for next run's comparison

### A.2 Delta-Based Design

The eventing module is **delta-based, not condition-based**. It reports **changes**, not persistent conditions.

**Why:** With ~1000 validators and ~100 in auction, a condition-based approach emits ~900 `out_of_auction` events every hourly run. These data points have no meaning — the consumer would be overwhelmed with redundant information. Instead, we detect transitions (validator left auction, bond balance dropped, cap constraint changed) and emit events only when state changes.

**How it works:**

- A `bond_event_state` table stores one row per `(vote_account, bond_type)` with the last known state
- Each run: load previous state → compute current state via DsSamSDK → compare → emit deltas → upsert new state
- Each delta event carries **both** the previous and current value, so the consumer knows the direction and magnitude of the change
- The eventing module emits on **any** change — the consumer (notification brain in marinade-notifications) decides what's significant enough to notify

**First run:** When `bond_event_state` is empty, every validator produces a `first_seen` event. This is a one-time burst.

**Granularity:** All monetary values are tracked in **lamports** (integer comparison). Sub-lamport rounding differences are not emitted as changes.

### A.3 Using `DsSamSDK` for Data & Auction Simulation

The `@marinade.finance/ds-sam-sdk` already handles all data fetching and auction simulation. We do **not** need separate `fetch-data.ts` or `simulate-auction.ts` modules. The SDK:

- Fetches from validators-api, bonds-api, scoring-api, TVL-api, blacklist, rewards-api (via `DataProvider.fetchSourceData()`)
- Aggregates and normalizes the data
- Runs the full auction simulation
- Returns `AuctionResult.auctionData.validators: AuctionValidator[]` with all computed fields

The SDK's API URLs are configurable via `DsSamConfig`:

| SDK config field       | Default                                        | Our CLI flag           |
| ---------------------- | ---------------------------------------------- | ---------------------- |
| `validatorsApiBaseUrl` | `https://validators-api.marinade.finance`      | `--validators-api-url` |
| `bondsApiBaseUrl`      | `https://validator-bonds-api.marinade.finance` | `--bonds-api-url`      |
| `scoringApiBaseUrl`    | `https://scoring.marinade.finance`             | `--scoring-api-url`    |
| `tvlInfoApiBaseUrl`    | `https://api.marinade.finance`                 | `--tvl-api-url`        |

We pass our CLI option values through to `DsSamConfig`. The SDK also supports `cacheInputs: true` + `inputsCacheDirPath` for caching fetched data to disk (useful for debugging).

### A.4 Constraint Types — All Capping Reasons

The `AuctionConstraintType` enum in ds-sam-sdk defines **all** reasons a validator's stake can be capped:

| Constraint  | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `COUNTRY`   | Geographic concentration — too much stake in one country                 |
| `ASO`       | Autonomous System concentration — too much stake on one hosting provider |
| `VALIDATOR` | Single-validator concentration — exceeds max % of Marinade TVL           |
| `BOND`      | Bond-backed stake cap — bond too small to cover the stake                |
| `WANT`      | Validator's own `maxStakeWanted` limit                                   |
| `RISK`      | Unprotected/backstop stake cap                                           |

Each `AuctionValidator` has `lastCapConstraint: AuctionConstraint | null` which tells us which constraint hit first (the binding one). We track changes to the constraint type as delta events.

### A.5 Package Structure ✅

> **Implemented.** All source modules created. Test coverage for `evaluate-deltas` (12 tests) and `emit-events` (6 tests). DB modules (`state.ts`, `persist-events.ts`) are implemented but tested only through types (require real DB for integration tests). `run-auction.spec.ts` and `integration.spec.ts` deferred — they require mocking `DsSamSDK` which has complex internal state.

```
packages/bonds-eventing/
  package.json
  tsconfig.json
  jest.config.js                ← .js not .ts (matches repo pattern)
  src/
    index.ts                    — Commander CLI entry point
    config.ts                   — Commander options + env var mapping
    run-auction.ts              — DsSamSDK instantiation and run()
    evaluate-deltas.ts          — Compare current vs previous state, generate delta events
    state.ts                    — Read/write bond_event_state table
    emit-events.ts              — POST events to marinade-notifications with retry
    persist-events.ts           — Write emitted events to DB via slonik
    types.ts                    — Local type definitions (BondsEventV1, ValidatorState etc.)
  __tests__/
    evaluate-deltas.spec.ts     ✅ 12 tests
    emit-events.spec.ts         ✅ 6 tests
```

**Migration file:** `migrations/0006-add-eventing-tables.sql` ✅ — creates `bond_event_state` and `emitted_bond_events` tables.

**Implementation decisions that differ from plan:**

- Used `slonik` directly (not via `@marinade.finance/nestjs-common`) since this is a CLI, not a NestJS app
- Used native `fetch()` with manual retry loop instead of `@Retry` decorator (decorator requires class context; the retry logic here is simpler as a loop with exponential backoff)
- `jest.config.js` instead of `.ts` to match the `validator-bonds-sanity-check` pattern
- `inner_type` enum expanded from the original schema to include delta types: `first_seen`, `bond_removed`, `auction_entered`, `auction_exited`, `cap_changed`, `bond_underfunded_change`, `bond_balance_change` (plus original `announcement`, `version_bump`)

### A.6 Configuration (`config.ts`) — Commander CLI with Env Var Fallbacks

The eventing module is a Commander CLI (same pattern as the rest of the repo). Every option is available as both a CLI argument and an env var.

```typescript
import { Command, Option } from 'commander'

const program = new Command()
  .name('bonds-eventing')
  .description('Emit bond notification events after bonds collection')

  // ds-sam-sdk API URLs (passed through to DsSamConfig)
  .addOption(
    new Option('--bonds-api-url <url>', 'Validator bonds API base URL')
      .env('BONDS_API_URL')
      .default('https://validator-bonds-api.marinade.finance'),
  )
  .addOption(
    new Option('--validators-api-url <url>', 'Validators API base URL')
      .env('VALIDATORS_API_URL')
      .default('https://validators-api.marinade.finance'),
  )
  .addOption(
    new Option('--scoring-api-url <url>', 'Scoring API base URL')
      .env('SCORING_API_URL')
      .default('https://scoring.marinade.finance'),
  )
  .addOption(
    new Option('--tvl-api-url <url>', 'TVL info API base URL')
      .env('TVL_API_URL')
      .default('https://api.marinade.finance'),
  )

  // Notification service
  .addOption(
    new Option(
      '--notifications-api-url <url>',
      'marinade-notifications base URL',
    ).env('NOTIFICATIONS_API_URL'),
  )
  .addOption(
    new Option(
      '--notifications-jwt <token>',
      'JWT for notifications API auth',
    ).env('NOTIFICATIONS_JWT'),
  )

  // Database (slonik)
  .addOption(
    new Option('--postgres-url <url>', 'PostgreSQL connection string').env(
      'POSTGRES_URL',
    ),
  )
  .addOption(
    new Option('--postgres-ssl-root-cert <path>', 'Path to SSL root cert').env(
      'POSTGRES_SSL_ROOT_CERT',
    ),
  )

  // Bond type
  .addOption(
    new Option('--bond-type <type>', 'Bond config type')
      .choices(['bidding', 'institutional'])
      .env('BOND_TYPE'),
  )

  // Retry
  .addOption(
    new Option('--retry-max-attempts <n>', 'Max retries for notification POST')
      .env('RETRY_MAX_ATTEMPTS')
      .default(4)
      .argParser(Number),
  )
  .addOption(
    new Option(
      '--retry-base-delay-ms <ms>',
      'Base delay for exponential backoff',
    )
      .env('RETRY_BASE_DELAY_MS')
      .default(30000)
      .argParser(Number),
  )

  // Debug
  .addOption(
    new Option('--dry-run', 'Skip POST and DB write, just log events')
      .env('DRY_RUN')
      .default(false),
  )
  .addOption(
    new Option(
      '--cache-inputs <dir>',
      'Cache ds-sam-sdk API responses to dir (for debugging)',
    ).env('CACHE_INPUTS_DIR'),
  )
  .addOption(new Option('-d, --debug', 'Debug log output'))
```

### A.7 Data Flow

```
1. run-auction.ts
   ├── Instantiate DsSamSDK with config (API URLs from CLI opts)
   ├── sdk.run() → AuctionResult
   └── Return result.auctionData.validators: AuctionValidator[]
       Each validator has:
       ├── voteAccount, bondBalanceSol, marinadeActivatedStakeSol
       ├── bondGoodForNEpochs (computed by SDK)
       ├── lastCapConstraint: { constraintType, constraintName, ... } | null
       ├── samEligible, backstopEligible
       ├── auctionStake.marinadeSamTargetSol (how much stake the validator won)
       └── revShare.totalPmpe, .expectedMaxEffBidPmpe, etc.

2. state.ts — loadPreviousState()
   ├── SELECT * FROM bond_event_state WHERE bond_type = $1
   └── Return Map<vote_account, ValidatorState>

3. evaluate-deltas.ts
   For each AuctionValidator, compare current vs previous state:
   ├── first_seen: validator not in previous state (new bond)
   ├── bond_removed: validator in previous state but absent from current
   ├── auction_entered: was out of auction, now in
   ├── auction_exited: was in auction, now out
   ├── cap_changed: lastCapConstraint type changed (null↔X or X↔Y)
   ├── bond_underfunded_change: bondGoodForNEpochs changed
   └── bond_balance_change: funded_amount or effective_amount changed (lamports, integer comparison)

   Each delta → BondsEventV1 with:
   ├── message_id: crypto.randomUUID()
   ├── type: "bonds"
   ├── inner_type: one of the delta types above
   ├── vote_account, bond_pubkey, epoch
   ├── data.message: human-readable text describing the change
   ├── data.details: { previous_*, current_*, delta_* } — before/after values
   └── created_at: ISO 8601

   Multiple events per validator per run are possible (e.g., balance dropped AND cap changed).
   Each inner_type is evaluated independently by the consumer's per-type threshold rules.

4. emit-events.ts
   For each event:
   ├── POST {notifications-api-url}/bonds-event-v1  (with JWT auth header)
   ├── Retry with exponential backoff (using @Retry from @marinade.finance/ts-common)
   ├── On success: return { status: 'sent' }
   └── On retry exhaustion: log warning, return { status: 'failed', error }

5. persist-events.ts
   For each event + delivery result:
   └── INSERT INTO emitted_bond_events via slonik pool

6. state.ts — saveCurrentState()
   └── UPSERT bond_event_state with current snapshot for each validator
```

### A.8 Event Schema (Local Types)

The event schema is the **contract** with marinade-notifications. It will be defined as a JSON Schema in the marinade-notifications repo (`message-types/schemas/bonds-event-v1.json`). Here we keep local TypeScript types that must match.

**NOTE:** The schema is provisional. It will be refined as we implement both sides. The contract is enforced by the generated `bonds-event-v1` package from the marinade-notifications codegen pipeline — both sides import the same generated types and validators, and emitter tests validate produced events against the schema (see C.3.1).

```typescript
// types.ts — local copy, must match the JSON Schema
interface BondsEventV1 {
  type: 'bonds'
  inner_type:
    | 'first_seen'
    | 'bond_removed'
    | 'auction_entered'
    | 'auction_exited'
    | 'cap_changed'
    | 'bond_underfunded_change'
    | 'bond_balance_change'
    | 'announcement'
    | 'version_bump'
  vote_account: string
  bond_pubkey: string
  epoch: number
  data: {
    message: string
    details: Record<string, unknown>
  }
  created_at: string // ISO 8601
}

// State tracked per validator for delta comparison
interface ValidatorState {
  vote_account: string
  bond_pubkey: string
  bond_type: string
  epoch: number
  in_auction: boolean
  bond_good_for_n_epochs: number | null
  cap_constraint: string | null // 'BOND' | 'COUNTRY' | 'ASO' | 'VALIDATOR' | 'WANT' | 'RISK' | null
  funded_amount_lamports: bigint
  effective_amount_lamports: bigint
  auction_stake_lamports: bigint
  sam_eligible: boolean
  updated_at: string // ISO 8601
}
```

The event carries **raw facts only**. No `notification_id`, no `priority`, no `relevance_hours` — those are generated by the consumer brain (`bonds-notification` lib) in marinade-notifications.

### A.9 `/bonds-event-v1` Endpoint ✅ Implemented

The marinade-notifications `POST /bonds-event-v1` endpoint is now implemented (commit `98d7fb2` in marinade-notifications). Events from the emitter flow through the full pipeline: ingress → queue → consumer → brain evaluation → dedup → routing → delivery (telegram + outbox).

The eventing module's retry logic and graceful degradation (`soft_fail` in Buildkite) remain useful for transient failures or when the notification service is temporarily unavailable.

### A.10 Database — slonik

New migration `migrations/0006-add-eventing-tables.sql`:

```sql
-- State snapshot for delta comparison (one row per validator per bond_type)
CREATE TABLE bond_event_state (
    vote_account TEXT NOT NULL,
    bond_pubkey TEXT NOT NULL,
    bond_type TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    in_auction BOOLEAN NOT NULL,
    bond_good_for_n_epochs INTEGER,
    cap_constraint TEXT,
    funded_amount_lamports BIGINT NOT NULL DEFAULT 0,
    effective_amount_lamports BIGINT NOT NULL DEFAULT 0,
    auction_stake_lamports BIGINT NOT NULL DEFAULT 0,
    sam_eligible BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vote_account, bond_type)
);

-- Append-only log of emitted events
CREATE TABLE emitted_bond_events (
    id BIGSERIAL PRIMARY KEY,
    message_id UUID NOT NULL,
    inner_type TEXT NOT NULL,
    vote_account TEXT NOT NULL,
    bond_pubkey TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL,           -- 'sent' or 'failed'
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emitted_events_vote ON emitted_bond_events(vote_account);
CREATE INDEX idx_emitted_events_type ON emitted_bond_events(inner_type);
CREATE INDEX idx_emitted_events_created ON emitted_bond_events(created_at);
```

`bond_event_state` is upserted each run. `emitted_bond_events` is append-only.

**DB library: `slonik`** (via `@marinade.finance/nestjs-common` pool factory or direct slonik pool). The existing Rust API uses `tokio-postgres` — but this is a TS module, so we use slonik which is the standard for Marinade TS services. Connection config (`--postgres-url`, `--postgres-ssl-root-cert`) matches the existing store-bonds pattern.

### A.11 Buildkite Pipeline Update ✅

Added to `.buildkite/collect-bonds.yml` after "Store Bonds" (with `wait:` barrier) and before "Concurrency gate unlock":

```yaml
- wait: ~

- label: ':bell: Emit Bond Events'
  key: 'emit-bond-events'
  commands:
    - |
      claim_type=${CLAIM_TYPE:-$(buildkite-agent meta-data get claim_type)}
      if [ "$$claim_type" = "bid" ]; then bond_type="bidding"; else bond_type="institutional"; fi
      echo "--- Emitting bond events for $$bond_type"
    - curl https://truststore.pki.rds.amazonaws.com/eu-west-1/eu-west-1-bundle.pem -o ./eu-west-1-bundle.pem
    - pnpm install
    - pnpm --filter @marinade.finance/bonds-eventing build
    - |
      pnpm ts-node packages/bonds-eventing/src/index.ts \
        --bond-type "$$bond_type" \
        --postgres-ssl-root-cert ./eu-west-1-bundle.pem
  env:
    NOTIFICATIONS_API_URL: '$$NOTIFICATIONS_API_URL'
    NOTIFICATIONS_JWT: '$$NOTIFICATIONS_JWT'
    POSTGRES_URL: '$$POSTGRES_URL'
  soft_fail:
    - exit_status: '*'

- wait: ~
```

**Implementation decisions that differ from plan:**

- Downloads the SSL cert directly via `curl` instead of using `artifacts#v1.9.4` plugin (each step runs in a fresh checkout, no artifact from Store Bonds available)
- Runs `pnpm install` + `pnpm --filter build` in-step (matches the `sanity-unified.yml` pattern for TS execution on snapshots agents)
- `POSTGRES_SSL_ROOT_CERT` passed as CLI arg instead of env var (cert is downloaded in the same step, not an artifact)
- Added `wait:` barriers so the step runs sequentially after Store Bonds and the concurrency gate unlock waits for it to finish

Key decisions (unchanged from plan):

- `soft_fail` — the pipeline must not fail due to eventing issues (the collector + store are the critical path)
- Runs after store-bonds so the bonds API has fresh data
- Uses the same `POSTGRES_URL` as store-bonds
- API URLs use SDK defaults in prod; overridable via env vars or CLI args for testing

### A.12 Testing (partially implemented)

**Framework:** Jest (matches the rest of the TS packages in this repo). ✅ `jest.config.js` added.

**Current coverage:** 18 tests passing (12 evaluate-deltas + 6 emit-events). DB-dependent tests (`state.spec.ts`, `persist-events.spec.ts`) and integration test deferred — require PostgreSQL or mock pool.

#### Unit Tests

**`run-auction.spec.ts`**

- Mock `DsSamSDK` class — verify it's instantiated with correct config (API URLs passed through)
- Verify the returned `AuctionValidator[]` is passed along correctly
- Test error handling: SDK throws → module logs error, does not crash
- Test `--cache-inputs` option: verify `cacheInputs: true` and `inputsCacheDirPath` are set on config

**`evaluate-deltas.spec.ts`**

- Given current `AuctionValidator[]` and previous `Map<string, ValidatorState>`, verify correct delta events:
  - New validator (not in previous state) → `first_seen` event with all current values
  - Validator in previous state but absent from current → `bond_removed` event with last known values
  - Validator was out of auction, now in (`auction_stake > 0`) → `auction_entered` event
  - Validator was in auction, now out → `auction_exited` event
  - `lastCapConstraint` changed (null→BOND, BOND→COUNTRY, COUNTRY→null, etc.) → `cap_changed` event with `previous_cap` and `current_cap`
  - `bondGoodForNEpochs` changed → `bond_underfunded_change` event with `previous_epochs`, `current_epochs`
  - `funded_amount_lamports` or `effective_amount_lamports` changed → `bond_balance_change` event with `previous_funded_lamports`, `current_funded_lamports`, `delta_lamports`
  - No change in any tracked field → no events emitted
  - Multiple changes on same validator → multiple separate events (e.g., balance dropped AND cap changed)
- Verify each event has: valid `message_id` (UUID format), `created_at` (ISO 8601), non-empty `data.message`, expected fields in `data.details`
- Verify lamport-level precision: change of 1 lamport triggers event, identical lamport values do not

**`state.spec.ts`**

- Mock slonik pool
- `loadPreviousState`: verify SELECT query and result parsing into `Map<string, ValidatorState>`
- `saveCurrentState`: verify UPSERT query and parameters for each validator
- Test empty state (first run): returns empty map

**`emit-events.spec.ts`**

- Use `TestHttpServer` from `@marinade.finance/ts-common` to mock notification endpoint
- Test successful delivery: POST returns 200 → result is `{ status: 'sent' }`
- Test retry: first 2 POSTs fail (503), third succeeds → result is `{ status: 'sent' }`, verify retry timing
- Test retry exhaustion: all POSTs fail → result is `{ status: 'failed', error: '...' }`
- Test dry-run mode: no HTTP calls made, events logged to stdout

**`persist-events.spec.ts`**

- Mock slonik pool (or use slonik's `createMockPool` if available)
- Verify INSERT query and parameters
- Verify all event fields are persisted correctly
- Verify `status` and `error` are written correctly for sent/failed events

#### Integration Test

**`integration.spec.ts`**

- Mock `DsSamSDK` to return a fixed `AuctionResult` with known validators
- Use `TestHttpServer` for the notification endpoint
- Mock slonik pool for DB writes
- Pre-populate previous state to simulate delta detection
- Run the full flow: load state → run auction → evaluate deltas → emit → persist → save state
- Verify end-to-end: given previous state + current validators, correct delta events are emitted and persisted
- Verify first-run behavior: empty previous state → all validators produce `first_seen` events
- Verify partial failures: some events POST successfully, some fail — all are persisted with correct status

#### CI

Add to existing TS test workflow. These are pure unit tests — no Solana validator or real DB needed.

```yaml
# In .buildkite/ts-lint-and-test.yml (or equivalent)
- label: ':test_tube: Bonds Eventing Tests'
  commands:
    - pnpm --filter @marinade.finance/bonds-eventing test
```

---

## Part B: CLI Subscribe Commands

### B.1 Purpose

Add commands to `packages/validator-bonds-cli-core/` so validators can subscribe/unsubscribe to notifications and view their notifications. The commands interact with the marinade-notifications subscription API and notifications read API.

### B.2 Authority Model for Subscription Signing

**Who can subscribe on behalf of a bond?** The same authorities who can configure the bond:

1. **Bond authority** — the `authority` pubkey stored in the Bond account
2. **Validator identity** — the `node_pubkey` from the vote account (validator's identity keypair)

This matches `check_bond_authority` in `programs/validator-bonds/src/checks.rs:107-118`. The subscription signing replicates this logic off-chain.

The CLI `--authority` option uses the same `parseWalletOrPubkeyOption` parser as `configure-bond` — the user provides either the bond authority keypair or the validator identity keypair. The on-chain verification (server-side) checks both paths, same as the on-chain program.

### B.3 Message Signing — Solana Off-Chain Message Standard

Both Ledger and file-keypair signing use the **Solana off-chain message signing standard** via `@marinade.finance/ledger-utils@^3.2.0`. This library uses `@solana/offchain-messages` internally to format messages with the standard header before signing.

**Application domain:** The validator-bonds program ID `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4` is used as the application domain for all off-chain message signing. This follows the Solana best practice of using the program ID to namespace messages.

**Signing paths:**

```typescript
import {
  LedgerWallet,
  signOffchainMessage,
} from '@marinade.finance/ledger-utils'

const APP_DOMAIN = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'

// Ledger:
const signature = await ledgerWallet.signOffchainMessage(
  messageText,
  APP_DOMAIN,
)

// File keypair:
const signature = signOffchainMessage(messageText, keypair, APP_DOMAIN)
```

Both paths produce the same format: a standard ed25519 signature over the Solana off-chain formatted bytes (`[0xff "solana offchain" | version | applicationDomain | signatories | format | length | text]`).

**Server-side verification (marinade-notifications):** The server uses `@solana/offchain-messages` (Kit sub-package) to reconstruct the formatted bytes from `(messageText, applicationDomain, signerPubkey)`, then verifies the ed25519 signature using `@solana/keys`. No dependency on `@marinade.finance/ledger-utils` — just standard Kit libraries. See "Cross-Repo: marinade-notifications Changes" section below.

### B.4 New Commands

Three new commands. Following the existing two-layer pattern:

- **Core layer** (`cli-core`): `configure*()` defines the command + options, `manage*()`/`show*()` implements the logic
- **CLI layer** (`cli`, `cli-institutional`): `install*()` wires it with `.action()` and package-specific defaults

#### `subscribe` command (✅ implemented)

```
validator-bonds subscribe <bond-or-vote> --type <telegram|email> --address <destination>
```

| Option                            | Description                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<bond-or-vote>`                  | Bond account address or vote account address (resolved via existing `getBondFromAddress`)                                                                     |
| `--type <type>`                   | Notification delivery type: `telegram`, `email` (not "api" — that's internal)                                                                                 |
| `--address <address>`             | Destination address for the notification type (Telegram handle, email address). **Required.**                                                                 |
| `--authority <keypair-or-ledger>` | Keypair to sign the subscription message (bond authority or validator identity). Falls back to `--keypair` wallet. Uses existing `parseWalletOrPubkeyOption`. |
| `--notifications-api-url <url>`   | Override notification service URL. Env: `NOTIFICATIONS_API_URL`. Hidden option (for testing).                                                                 |

**Naming rationale:** We use `--type` and `--address` instead of `--channel` and `--channel-address` because validators think in terms of "where do I get notified" (type = telegram, address = my handle), not abstract "channels". The CLI help reads naturally: `subscribe ... --type telegram --address @myhandle`.

**Important: `--address` is always required.** The CLI does not subscribe to the internal "api" pull channel — that would be a separate `show-notifications` concern. The subscribe command is specifically for push notification delivery types (telegram, email).

**Flow:**

1. Resolve bond: `getBondFromAddress(bondOrVote)` → get bond pubkey, vote account, config address, authority
2. Determine signing wallet: `--authority` flag or default wallet. Must be a `Wallet` (with signing capability — keypair or Ledger), not bare pubkey.
3. Build structured message text:
   ```
   "Subscribe bonds <type> <timestamp>"
   ```
4. Sign with Solana off-chain message standard:
   - Ledger: `wallet.signOffchainMessage(messageText, APP_DOMAIN)`
   - Keypair: `signOffchainMessage(messageText, keypair, APP_DOMAIN)`
5. POST to `{notifications-api-url}/subscriptions`:
   ```json
   {
     "pubkey": "<authority_or_identity_pubkey_base58>",
     "notification_type": "bonds",
     "channel": "telegram",
     "channel_address": "@myhandle",
     "signature": "<base58_signature>",
     "message": "Subscribe bonds telegram 1709123456",
     "additional_data": {
       "config_address": "<bond_config_pubkey>",
       "vote_account": "<vote_account>",
       "bond_pubkey": "<bond_pubkey>"
     }
   }
   ```
6. Handle response:
   - For `telegram`: the API may return a deep link URL (`https://t.me/...?start=<token>`). Display it prominently with instructions.
   - For `email`: subscription is immediately active. Confirm.
   - Error: display error message from API.

#### `unsubscribe` command (✅ implemented)

```
validator-bonds unsubscribe <bond-or-vote> --type <telegram|email> [--address <destination>]
```

Same signing flow as subscribe, but with `"Unsubscribe bonds <type> <timestamp>"` message text. Calls `DELETE /subscriptions`. `--address` is optional — when omitted, unsubscribes from all subscriptions of the given type; when provided, unsubscribes only the specific address.

#### `subscriptions` command (✅ implemented)

```
validator-bonds subscriptions <bond-or-vote> [--format <text|yaml|json>]
```

| Option                            | Description                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `<bond-or-vote>`                  | Bond or vote account address                                                                           |
| `--format`                        | Output format: `text` (default), `yaml`, `json` — uses `printData` from `@marinade.finance/cli-common` |
| `--notifications-api-url`         | Override URL. Env: `NOTIFICATIONS_API_URL`. Hidden.                                                    |
| `--authority <keypair-or-ledger>` | Keypair for authenticated request                                                                      |

**Flow:**

1. Resolve bond from bond-or-vote via `getBondFromAddress`
2. Build and sign an auth message: `"ListSubscriptions <pubkey> <timestamp>"`
3. GET `{notifications-api-url}/subscriptions?pubkey={pubkey}&notification_type=bonds` with `x-solana-signature` and `x-solana-message` headers
4. Display subscriptions using `printData` for the selected format

**Authentication:** The endpoint requires Solana signature auth to prevent enumeration of validator Telegram handles and subscription details. The auth pattern is the same as subscribe — sign a message, send signature + pubkey in the request.

#### `show-notifications` command (🔶 NOT YET IMPLEMENTED)

A future `show-notifications` command to fetch delivered notifications from `GET /notifications` may be added when the notifications read API exists. This would support `--priority`, `--limit`, `--inner-type` filters.

### B.5 File Structure

```
packages/validator-bonds-cli-core/src/
  commands/manage/
    subscribe.ts                           — ✅ configureSubscribe() + manageSubscribe() + signForSubscription()
    unsubscribe.ts                         — ✅ configureUnsubscribe() + manageUnsubscribe()
    subscriptions.ts                       — ✅ configureSubscriptions() + showSubscriptions()
    index.ts                               — ✅ re-exports all three

packages/validator-bonds-cli/src/
  commands/manage/
    subscribe.ts                           — ✅ installSubscribe() wiring
    unsubscribe.ts                         — ✅ installUnsubscribe() wiring
    subscriptions.ts                       — ✅ installSubscriptions() wiring
    index.ts                               — ✅ updated to register all three

packages/validator-bonds-cli/__tests__/
  test-validator/
    subscriptions.spec.ts                  — ✅ integration tests (subscribe, unsubscribe, subscriptions)
```

No `signMessage.ts` is needed in cli-core — signing is handled by `@marinade.finance/ledger-utils` which provides both `LedgerWallet.signOffchainMessage()` and standalone `signOffchainMessage()` for keypairs. The `signForSubscription()` helper in `subscribe.ts` wraps both paths.

The commands are defined in cli-core as `configure*()` + `manage*()`/`show*()` functions (matching the existing pattern). Each downstream CLI wires them in via `install*()` functions.

### B.6 Integration with Downstream CLIs

Only `validator-bonds-cli` registers the subscription commands. `validator-bonds-cli-institutional` does NOT get subscription commands — this functionality is not planned for the institutional CLI.

```typescript
// In validator-bonds-cli/src/commands/manage/index.ts (or equivalent):
import { configureSubscribe, configureUnsubscribe } from '@marinade.finance/validator-bonds-cli-core'

// In the install function:
configureSubscribe(program).action(async (address, opts) => {
  await manageSubscribe({ address: await address, ... })
})
configureUnsubscribe(program).action(async (address, opts) => {
  await manageUnsubscribe({ address: await address, ... })
})

// In validator-bonds-cli/src/commands/index.ts (or show commands section):
import { configureShowNotifications } from '@marinade.finance/validator-bonds-cli-core'

configureShowNotifications(program).action(async (address, opts) => {
  await showNotifications({ address: await address, ... })
})
```

### B.7 Subscription Verification (Server Side — Reference Only)

The marinade-notifications subscription API uses a **SubscriptionVerifier** plugin to validate that the signing pubkey is authorized for the claimed bond. The bonds verifier plugin will:

1. Receive: `signing_pubkey`, `additional_data: { config_address, vote_account, bond_pubkey }`
2. Read the bond account on-chain (derive PDA from `config_address + vote_account`, or fetch by `bond_pubkey`)
3. Check if `signing_pubkey == bond.authority` OR `signing_pubkey == vote_account.node_pubkey` (same logic as on-chain `check_bond_authority`)
4. If valid: return `{ verifyAgainstPubkey: signing_pubkey, userId: vote_account }`
5. Subscription is stored keyed by `vote_account` — events are also keyed by `vote_account`, so delivery routing works

**This is implemented in marinade-notifications, not here.** But the CLI must send the right data (`additional_data` with config, vote account, bond pubkey) for the server-side verification to work.

### B.8 Testing

#### Unit Tests

**`subscribe.spec.ts`**

- Mock `getBondFromAddress` to return a known bond
- Use `TestHttpServer` from `@marinade.finance/ts-common` to mock subscription API
- Verify the command constructs correct POST body with all required fields
- Verify signature is base58 encoded
- Verify `additional_data` contains config_address, vote_account, bond_pubkey
- Test with bond authority keypair → `pubkey` matches authority
- Test with validator identity keypair → `pubkey` matches identity pubkey
- Test error: no keypair provided and wallet is pubkey-only → clear error message
- Test `--type telegram --address @handle` → correct `channel` and `channel_address` in body
- Test `--type email --address foo@bar.com` → correct fields
- Verify the signature is valid: reconstruct formatted message with `formatOffchainMessage`, verify with ed25519

**`unsubscribe.spec.ts`**

- Similar to subscribe tests but with `"Unsubscribe ..."` message text and DELETE HTTP method

**`showNotifications.spec.ts`**

- Use `TestHttpServer` to mock notifications API
- Verify correct query parameters (pubkey, notification_type)
- Verify `x-solana-signature` and `x-solana-message` headers
- Verify output formatting for various notification payloads (text, yaml, json via `printData`)
- Test empty response → "No notifications" message
- Test API error → graceful error message

#### Integration Tests (with test-validator)

**`subscribe.spec.ts` (integration)**

- Follows the pattern from `announcements.spec.ts`: spawn the CLI as a child process, mock the subscription API with `TestHttpServer`
- Create a real bond on-chain (via `initConfigInstruction` + `initBondInstruction`)
- Run `subscribe` command with the bond authority keypair → verify POST received by mock server has correct body and valid signature
- Run `subscribe` command with validator identity keypair → verify POST received with identity pubkey
- Run `show-notifications` command → verify GET request with auth header and output formatting

#### CI

Add to existing TS lint-and-test workflow:

```yaml
- label: ':test_tube: CLI Core Subscription Tests'
  commands:
    - pnpm --filter @marinade.finance/validator-bonds-cli test
```

The integration tests require a running test-validator (same as existing CLI tests like `configureBond.spec.ts`).

---

## Cross-Repo: marinade-notifications Changes

The subscription endpoint in marinade-notifications (`notification-service/subscriptions/solana-auth.ts`) currently verifies signatures against raw text bytes:

```typescript
// CURRENT (incorrect for Solana off-chain messages):
const messageBytes = new TextEncoder().encode(message)
```

This is incompatible with signatures produced by the Solana off-chain message standard (which signs over formatted bytes with a header). The following changes are needed:

### Required Changes to `solana-auth.ts`

1. Add `@solana/offchain-messages` dependency (Kit sub-package, already compatible with existing `@solana/keys` and `@solana/addresses` usage)
2. Update `verifySolanaSignature` to format the message before verifying:

```typescript
import {
  getOffchainMessageV0Encoder,
  offchainMessageApplicationDomain,
  offchainMessageContentRestrictedAsciiOf1232BytesMax,
} from '@solana/offchain-messages'

const BONDS_APP_DOMAIN = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'

export async function verifySolanaSignature(
  message: string,
  signatureBase58: string,
  publicKeyBase58: string,
): Promise<boolean> {
  const base58 = getBase58Encoder()

  // Format message using Solana off-chain message standard
  const encoder = getOffchainMessageV0Encoder()
  const domain = offchainMessageApplicationDomain(BONDS_APP_DOMAIN)
  const signatories = [{ address: publicKeyBase58 as never }] as const
  const content = offchainMessageContentRestrictedAsciiOf1232BytesMax(message)
  const messageBytes = encoder.encode({
    version: 0,
    applicationDomain: domain,
    content,
    requiredSignatories: signatories,
  })

  // Standard ed25519 verify via @solana/keys (unchanged)
  const pubkeyBytes = base58.encode(publicKeyBase58)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    pubkeyBytes,
    { name: 'Ed25519' },
    true,
    ['verify'],
  )
  const sigBytes = signatureBytes(base58.encode(signatureBase58))

  return verifySignature(cryptoKey, sigBytes, messageBytes)
}
```

The change is minimal: replace `new TextEncoder().encode(message)` with the off-chain message encoder. The ed25519 verification logic is unchanged. No dependency on `@marinade.finance/ledger-utils` is introduced.

### Why This Works

Both sides use `@solana/offchain-messages` to produce the same formatted bytes:

| Side          | Formatting library                             | Signing library | Verification library |
| ------------- | ---------------------------------------------- | --------------- | -------------------- |
| CLI (Ledger)  | `@solana/offchain-messages` (via ledger-utils) | Ledger hardware | —                    |
| CLI (Keypair) | `@solana/offchain-messages` (via ledger-utils) | Node.js crypto  | —                    |
| Server        | `@solana/offchain-messages` (direct)           | —               | `@solana/keys`       |

The signature is a standard ed25519 artifact over well-defined bytes. Both sides agree on the byte format via the shared Solana standard.

---

## Schema Coordination with marinade-notifications

The event schema (`bonds-event-v1`) is defined as a JSON Schema in `marinade-notifications/message-types/schemas/bonds-event-v1.json` and auto-generated via the codegen pipeline. All three consumers (emitter, brain, notification-service) import from the generated `bonds-event-v1` package.

**Current state:**

1. **Local types** — `BondsEventV1` is defined independently in `bonds-eventing/src/types.ts`, `bonds-notification/src/types.ts`, and `marinade-notifications/.../bonds-event-v1-validator.ts`
2. **Manual sync** — the types are identical across all three definitions, kept in sync by hand
3. **Local validator** — marinade-notifications uses a hand-written validator function (not Ajv-generated)
4. **Brain dependency** — consumer imports `@marinade.finance/bonds-notification` via local file link, which provides the canonical types for evaluation

**Future improvement (not blocking):**

The codegen pipeline is set up: `bonds-event-v1.json` lives in `message-types/schemas/`, `pnpm generate` produces the TypeScript + Rust packages, and all three local definitions have been replaced with imports from the generated `bonds-event-v1` package.

---

## Dependencies & Packages to Add

### bonds-eventing (`packages/bonds-eventing/package.json`)

```json
{
  "name": "@marinade.finance/bonds-eventing",
  "version": "0.0.1",
  "private": true,
  "dependencies": {
    "@marinade.finance/ds-sam-sdk": "^0.0.44",
    "@marinade.finance/ts-common": "^4.2.0",
    "@marinade.finance/config-common": "^4.2.0",
    "commander": "^14.0.0",
    "slonik": "^38.0.0",
    "pino": "^9.7.0",
    "pino-pretty": "^11.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### validator-bonds-cli-core additions

```json
{
  "dependencies": {
    "@marinade.finance/ledger-utils": "^3.2.0"
  }
}
```

`@marinade.finance/ledger-utils@^3.2.0` provides both `LedgerWallet.signOffchainMessage()` and standalone `signOffchainMessage()` for file keypairs, plus `formatOffchainMessage()` for test verification. It uses `@solana/offchain-messages` internally.

---

## Implementation Order

```
Step 1: Scaffold bonds-eventing package
  ├── package.json, tsconfig.json, jest.config.ts
  ├── types.ts (local BondsEventV1 + ValidatorState definitions)
  └── config.ts (Commander CLI with all options)
  → verify: pnpm build succeeds, --help shows all options

Step 2: Implement run-auction.ts + tests
  ├── Instantiate DsSamSDK with config from CLI opts
  ├── Call sdk.run(), return AuctionValidator[]
  └── Unit tests with mocked DsSamSDK
  → verify: config passed through correctly, result shape validated

Step 3: Implement state.ts + migration + tests
  ├── migrations/0006-add-eventing-tables.sql (bond_event_state + emitted_bond_events)
  ├── loadPreviousState(): SELECT from bond_event_state → Map<string, ValidatorState>
  ├── saveCurrentState(): UPSERT bond_event_state from current AuctionValidator[]
  └── Unit tests with mocked slonik pool
  → verify: correct SQL queries, state serialization/deserialization

Step 4: Implement evaluate-deltas.ts + tests
  ├── Compare current AuctionValidator[] vs previous ValidatorState map
  ├── Generate delta events for each change type
  └── Unit tests with crafted current/previous states
  → verify: correct events for each delta type, lamport precision, no events when unchanged

Step 5: Implement emit-events.ts + tests
  ├── HTTP POST with @Retry from @marinade.finance/ts-common
  └── Tests with TestHttpServer (success, retry, exhaustion, dry-run)
  → verify: retry behavior, status tracking

Step 6: Implement persist-events.ts + tests
  ├── slonik INSERT into emitted_bond_events
  └── Unit tests with mocked pool
  → verify: correct SQL, all fields persisted

Step 7: Wire up index.ts (Commander entry point) + integration test
  ├── Orchestrate: load state → run auction → evaluate deltas → emit → persist → save state
  └── Integration test with mocked SDK + TestHttpServer + mocked pool
  → verify: end-to-end flow works, first-run behavior, partial failures

Step 8: Update Buildkite pipeline
  ├── Add emit-bond-events step to collect-bonds.yml
  └── soft_fail configuration
  → verify: pipeline YAML is valid

Step 9: Implement subscribe command + tests                    ✅ DONE (cf3d4fe)
  ├── configureSubscribe (cli-core), manageSubscribe
  ├── signForSubscription() helper using @marinade.finance/ledger-utils (both Ledger and keypair paths)
  ├── Integration test with real bond on-chain + TestHttpServer mock (subscriptions.spec.ts)
  └── Wired into validator-bonds-cli (installSubscribe)
  → verified: correct POST body, off-chain message signing, bond resolution, deep_link handling

Step 10: Implement unsubscribe command + tests                 ✅ DONE (cf3d4fe)
  ├── configureUnsubscribe, manageUnsubscribe
  ├── Supports optional --address (unsubscribe specific or all of type)
  └── Integration tests: unsubscribe all + unsubscribe specific address
  → verified: correct DELETE request, unsubscribe message text

Step 11: Implement subscriptions (show) command + tests        ✅ DONE (cf3d4fe)
  ├── Implemented as `subscriptions` command (shows subscription list, not notifications)
  ├── configureSubscriptions, showSubscriptions (in cli-core/commands/manage/subscriptions.ts)
  ├── Auth via x-solana-signature + x-solana-message headers on GET /subscriptions
  ├── Output via printData (text/yaml/json format support)
  └── Integration test verifying output
  → verified: correct GET params, auth headers, printData output
  NOTE: The originally planned `show-notifications` (fetching delivered notifications)
  is NOT yet implemented. What was built is `subscriptions` which lists active subscriptions.
  A separate `show-notifications` command may be added later when the notifications read API exists.

Step 12: Wire commands into downstream CLIs                    ✅ DONE (cf3d4fe)
  ├── validator-bonds-cli: installSubscribe, installUnsubscribe, installSubscriptions ✅
  └── validator-bonds-cli-institutional: NOT APPLICABLE (subscriptions not planned for institutional CLI)
  → verified: commands appear in --help
```

---

## Part F: typescript-common Migration & Cross-Repo Type Safety ✅

### F.1 Purpose

Two improvements to `packages/bonds-notification/`:

1. **Adopt `@marinade.finance/typescript-common` utilities** — replace raw `fs`/`js-yaml` with standard Marinade patterns (`loadFileSync`, `parseAndValidateYaml`, class-validator DTOs)
2. **Ensure routing config stays in sync with inner_type enum** — provide a single source of truth (`BONDS_EVENT_INNER_TYPES` const array) and enforce completeness at compile time and in tests

### F.2 typescript-common Migration (validator-bonds) ✅

**Files changed in `packages/bonds-notification/`:**

- **`src/threshold-config-dto.ts`** (new) — class-validator decorated DTO classes: `ThresholdConfigDto`, `EvaluatedEventsDto`, `UnderfundedConfigDto`, `SimpleEventConfigDto`, `CapChangedConfigDto`, `AnnouncementConfigDto`, `PassthroughEventConfigDto`, `PriorityRuleDto`
- **`src/threshold-config.ts`** — `loadThresholdConfig()` is now **async**. Uses `loadFileSync` from `@marinade.finance/ts-common` for file I/O, `parseAndValidateYaml` from `@marinade.finance/cli-common` for YAML parsing + validation against DTOs
- **`src/brain.ts`** — `createBondsNotificationBrain()` is now **async** (returns `Promise<BondsNotificationBrain>`). Config is loaded once at brain construction, injected into the impl class
- **`src/types.ts`** — `BondsEventInnerType` union is now derived from a `BONDS_EVENT_INNER_TYPES` const array (single source of truth for both compile-time type and runtime validation)
- **`src/index.ts`** — exports `BONDS_EVENT_INNER_TYPES` and all DTO classes
- **`package.json`** — removed `js-yaml`; added `@marinade.finance/ts-common`, `@marinade.finance/cli-common`, `class-transformer`, peer dep on `class-validator`, dev dep on `reflect-metadata`
- **`jest.config.js`** — added `setupFiles: ['reflect-metadata']` (required by class-transformer decorators)
- **Tests** — updated `brain.spec.ts` and `evaluate.spec.ts` for async `loadThresholdConfig` / `createBondsNotificationBrain`

**Breaking change:** `createBondsNotificationBrain()` now returns `Promise<BondsNotificationBrain>` instead of `BondsNotificationBrain`. Consumers must `await` it. The `BondsNotificationBrain` interface itself is unchanged (evaluate/buildContent stay sync).

### F.3 Routing Config Type Safety

**Problem:** The notification routing config in marinade-notifications uses `Record<string, InnerTypeRouting>` — untyped keys. When a new `inner_type` is added to the brain or event schema, the routing config silently falls back to `default_channels` with no compile-time or test-time error.

**Solution — two layers:**

#### F.3.1 validator-bonds: Export const array (✅ done)

`bonds-notification` exports `BONDS_EVENT_INNER_TYPES` as a const array. The `BondsEventInnerType` union is derived from it:

```typescript
// types.ts
export const BONDS_EVENT_INNER_TYPES = [
  'first_seen',
  'bond_removed',
  'auction_entered',
  'auction_exited',
  'cap_changed',
  'bond_underfunded_change',
  'bond_balance_change',
  'announcement',
  'version_bump',
] as const
export type BondsEventInnerType = (typeof BONDS_EVENT_INNER_TYPES)[number]
```

#### F.3.2 marinade-notifications: Type the routing config keys (✅ done)

Change `routing-config.ts` to use the canonical type as key:

```typescript
import type { BondsEventInnerType } from '@marinade.finance/bonds-notification'

export interface NotificationRoutingConfig {
  default_channels: string[]
  inner_types: Record<BondsEventInnerType, InnerTypeRouting>
}
```

This makes the TypeScript build fail if a new inner_type is added to `BondsEventInnerType` but not to the routing config.

#### F.3.3 marinade-notifications: Completeness test (✅ done)

Runtime safety net — catches drift in CI even if types are bypassed:

```typescript
import { BONDS_EVENT_INNER_TYPES } from '@marinade.finance/bonds-notification'

it('routing config covers all inner types', () => {
  const config = getBondsRoutingConfig()
  for (const innerType of BONDS_EVENT_INNER_TYPES) {
    expect(config.inner_types).toHaveProperty(innerType)
  }
})
```

#### F.3.4 marinade-notifications: Async brain creation (✅ done)

Update consumer's `getBrain()` to await the now-async factory:

```typescript
// Before:
this.brain = createBondsNotificationBrain()
// After:
this.brain = await createBondsNotificationBrain()
```

### F.4 Enforcement Flow

When someone adds a new `inner_type`:

1. Add to `BONDS_EVENT_INNER_TYPES` array in `bonds-notification/src/types.ts` → `BondsEventInnerType` union updates automatically
2. Add threshold config in `thresholds.yaml` + evaluator in `evaluate.ts` + content builder in `content.ts`
3. When `marinade-notifications` upgrades the `bonds-notification` dependency:
   - **Build fails** — `routing-config.ts` is missing the new key (TS error on `Record<BondsEventInnerType, ...>`)
   - **Test fails** — completeness test catches the missing key
4. Developer adds routing entry → build + tests pass → PR is safe

---

## Open Items

> Updated 2026-03-26.

1. ~~**Notifications API URL in production**~~ — Managed via ops-infra ArgoCD deployment. The URL will be set as Buildkite env var (`NOTIFICATIONS_API_URL`) and CLI default upon deployment. No code changes needed.

2. ~~**JWT for notifications POST**~~ — Will be a static service token, set in Buildkite secrets (`NOTIFICATIONS_JWT`). No dynamic provisioning needed for v1.

3. ~~**Telegram deep link flow details**~~ — ✅ RESOLVED. Implemented via telegram-bot service.

4. ~~**`DsSamSDK` production config**~~ — ✅ RESOLVED. Use `loadSamConfig()` from `@marinade.finance/ds-sam-sdk` which fetches from `https://thru.marinade.finance/marinade-finance/ds-sam-pipeline/main/auction-config.json`. The `run-auction.ts` should call `loadSamConfig()` and merge with CLI overrides (API URLs). See Part G below.

5. ~~**bonds-event-v1 codegen**~~ — ✅ RESOLVED.

6. ~~**Notifications Read API**~~ — ✅ RESOLVED. `GET /notifications` endpoint + CLI `show-notifications` implemented.

7. **`@marinade.finance/bonds-notification` publishing** — Currently consumed via local file link. Will be published to npm before production deployment. Not blocking development.

8. ~~**marinade-notifications SPEC.md & ARCHITECTURE.md**~~ — ✅ RESOLVED. Brief summaries added (see Part I below).

9. ~~**Telegram delivery telemetry & monitoring**~~ — ✅ RESOLVED. Prometheus metrics implemented in Part H (`telegram_api_calls_total` counter + `telegram_api_duration_seconds` histogram).

## Resolved Items

- **~~Ledger off-chain signing~~** — Resolved. `@marinade.finance/ledger-utils@^3.2.0` provides `LedgerWallet.signOffchainMessage()` and standalone `signOffchainMessage()` for keypairs, both using Solana off-chain message standard via `@solana/offchain-messages`.

- **~~Unsubscribe HTTP method~~** — Resolved. `DELETE /subscriptions` (confirmed from marinade-notifications subscription controller implementation).

- **~~Stateless vs delta-based design~~** — Resolved. Delta-based with `bond_event_state` snapshot table. Events report changes, not persistent conditions.

## Code Review Findings & Resolution

### Review #1: Subscriptions reads missing bond context — ✅ FIXED

**Problem:** CLI resolved the requested bond locally but sent only `pubkey` and `notification_type` to the server for reads. Server-side reverse lookup could return subscriptions for the wrong bond if authority controls multiple bonds.

**Fix:** CLI now sends `additional_data: { config_address, vote_account, bond_pubkey }` for read operations (`packages/validator-bonds-cli-core/src/commands/manage/subscriptions.ts`). Server-side `GET /subscriptions` in marinade-notifications parses `additional_data` from query parameter and passes it to the verifier.

### Review #2: Underfunding events suppressed before brain evaluation — ✅ FIXED

**Problem:** The eventing layer only emitted `bond_underfunded_change` when `bondGoodForNEpochs` changed after rounding to 2 decimals. A material deficit change (e.g., +4 SOL) could occur without changing rounded epochs, and the notification brain would never see the event.

**Fix:** Added `deficit_lamports` to `ValidatorState` (types, DB schema via migration `0007-add-deficit-lamports.sql`, state load/save). The `evaluate-deltas.ts` now emits `bond_underfunded_change` when EITHER rounded epochs change OR `deficit_lamports` changes. The brain's `min_deficit_sol` and `significant_change_pct` thresholds still filter noise downstream.

### Review #3: Producer audit records used different message_id — ✅ FIXED

**Problem:** `emit-events.ts` generated one `message_id` for the HTTP envelope, but `persist-events.ts` inserted a different `crypto.randomUUID()` into `emitted_bond_events`.

**Fix:** `messageId` is generated once in `postEvent()` and returned in `EmitResult`. `persistEvents()` uses `result.messageId` for the audit row. Full traceability from audit log to ingress/queue/consumer logs.

---

## Part C: Event Processing Pipeline ✅ (except codegen)

### C.1 Overview & Scope

Part C covers the **receiver side** — everything needed to turn raw delta events from the emitter (Part A) into delivered notifications to validators. This work spans two repos.

**Implementation status:**

| Sub-part                      | Status         | Notes                                                                           |
| ----------------------------- | -------------- | ------------------------------------------------------------------------------- |
| C.2: bonds-notification brain | ✅ Implemented | `packages/bonds-notification/` — evaluate, content, dedup ID, tests             |
| C.3: JSON Schema codegen      | ✅ Implemented | Generated `bonds-event-v1` package from JSON Schema — imported by all consumers |
| C.4: Consumer pipeline        | ✅ Implemented | Ingress, queue, consumer, dedup, outbox, telegram delivery, routing config      |

**In validator-bonds repo (this repo):**

1. `packages/bonds-notification/` — ✅ The "brain" library. Business logic deciding IF to notify, at what priority, and generating dedup keys.

**In marinade-notifications repo (commit 98d7fb2):**

2. `message-types/schemas/bonds-event-v1.json` — ✅ Implemented. Codegen pipeline generates `bonds-event-v1` package with types + Ajv validator.
3. Ingress endpoint `POST /bonds-event-v1` — ✅ receives events from the emitter
4. Queue tables (inbox/archive/dlq) for `bonds_event_v1` — ✅ migration `04-bonds-event-v1.sql`
5. Consumer worker — ✅ dequeues events, delegates to bonds-notification brain, routes to delivery channels
6. `notification_dedup` table — ✅ existence-check dedup across all notification types
7. `notifications_outbox` table — ✅ stores notifications for API pull channel
8. Telegram message delivery — ✅ sends notification messages to subscribed chat_ids
9. Notification routing config — ✅ hardcoded in `routing-config.ts` + YAML mirror

**Pipeline approach — hard-coded consumer (follow existing pattern):**

The bonds consumer follows the same pattern as the staking-rewards consumer: a dedicated `BondsEventV1Consumer` class with hard-coded processing logic. No generic `NotificationPlugin<T>` interface — that abstraction can be extracted later when a second notification type (staking-rewards migration) needs to share pipeline code. The bonds-notification brain library provides the business logic; the consumer wires it to delivery channels directly.

**What is NOT built yet:**

- ~~JSON Schema codegen pipeline for `bonds-event-v1`~~ ✅ Implemented
- Generic `NotificationPlugin<T>` interface or pipeline framework
- Migration of existing staking-rewards consumer (it works — migrate when it needs changes)
- `show-notifications` CLI command (needs read API — deferred)
- Notifications Read API `GET /notifications` (deferred)
- `NotificationFormatter` service for rich Telegram formatting (v1 uses plain text `content.body`)
- Email delivery for bonds (only telegram + API in v1)

### C.2 `bonds-notification` Library (validator-bonds repo) ✅

> **Implemented** in commit `cabe5fe` — all source files, tests (brain, evaluate, content, notification-id), and YAML threshold config.

#### C.2.1 Purpose

A pure-logic npm library that encapsulates all bond notification business rules. It answers three questions:

1. **Should we notify?** — threshold evaluation against event details
2. **At what priority?** — critical / warning / info based on severity rules
3. **Has this already been sent?** — deterministic `notification_id` for dedup

The library has **no I/O** — no database, no HTTP, no side effects. It receives an event, returns an evaluation result. The consumer in marinade-notifications calls this library and handles all I/O.

#### C.2.2 Interfaces

```typescript
// types.ts — exported from @marinade.finance/bonds-notification

export type NotificationPriority = 'critical' | 'warning' | 'info'

export interface EvaluationResult {
  shouldNotify: boolean
  priority: NotificationPriority
  relevanceHours: number
  notificationId: string | null // null = skip dedup (every delivery is unique)
  /** The logical notification category — used by routing config to determine channels.
   *  For most events this equals inner_type. For events that don't warrant
   *  notification, shouldNotify is false and this field is irrelevant. */
  routingKey: string
}

/**
 * Structured notification content returned by the brain.
 * The brain knows WHAT to say (domain logic).
 * The notifications service knows HOW to present it (emojis, markdown, HTML).
 *
 * This separation enables the same presentation layer to be reused
 * across notification types (bonds, staking-rewards, etc.).
 */
export interface NotificationContent {
  title: string // e.g., "Bond Underfunded"
  body: string // human-readable summary
  dataPoints?: Array<{
    // optional structured key-value data
    label: string
    value: string
  }>
}

/**
 * Brain interface — the consumer calls these methods in sequence.
 * This interface is the contract between the brain library and the consumer.
 * The consumer hard-codes the call sequence (no generic plugin abstraction in v1).
 */
export interface BondsNotificationBrain {
  /** Evaluate whether this event should produce a notification. */
  evaluate(event: BondsEventV1): EvaluationResult | null

  /** Extract the user identifier from the event (for subscription lookup). */
  extractUserId(event: BondsEventV1): string

  /** Build structured notification content from the event.
   *  The notifications service applies channel-specific formatting
   *  (e.g., Telegram: add priority emoji + HTML; API: return as JSON). */
  buildContent(
    event: BondsEventV1,
    evaluation: EvaluationResult,
  ): NotificationContent
}
```

**Formatting responsibility:**

- **Brain (bonds-notification):** Returns `NotificationContent` — domain-specific content (title, body, structured data points). No emojis, no markdown, no HTML.
- **Consumer (marinade-notifications):** For v1, Telegram delivery uses the brain's `body` as plain text. The `NotificationContent.dataPoints` are available for future rich formatting. The consumer can be extended with a `NotificationFormatter` service later when multiple notification types need channel-specific presentation (emojis, HTML, templates).

#### C.2.3 Threshold Configuration

The threshold config is a YAML file **embedded in the package** (not loaded at runtime from an external path). It defines evaluation rules per inner_type.

```yaml
# config/thresholds.yaml — packed inside the library

# Events the brain actively evaluates (with threshold logic)
evaluated_events:
  bond_underfunded_change:
    # Only notify if the underfunding is materially significant
    min_deficit_sol: 0.5
    priority_rules:
      - condition: 'currentEpochs < 2'
        priority: critical
      - condition: 'currentEpochs < 10'
        priority: warning
      - condition: 'currentEpochs >= 10'
        priority: info
        shouldNotify: false # well-funded bonds don't need notification
    significant_change_pct: 20 # amount bucket granularity for dedup (20% to avoid oscillation noise)
    renotify_interval_hours: 24
    relevance_hours: 120

  auction_exited:
    priority: critical
    renotify_interval_hours: 24
    relevance_hours: 48

  cap_changed:
    # Only notify when cap is BOND (validator can act on this)
    # Other caps (COUNTRY, ASO, VALIDATOR, WANT, RISK) are informational
    notify_cap_types: ['BOND']
    notify_cap_types_priority: warning
    other_caps_priority: info
    other_caps_shouldNotify: false
    renotify_interval_hours: 24
    relevance_hours: 120

  bond_removed:
    priority: critical
    renotify_interval_hours: 24
    relevance_hours: 48

  announcement:
    priority: critical
    # No dedup — every announcement goes through
    skip_dedup: true
    relevance_hours: 48

# Events that are passthrough (always notify at info, no threshold logic)
passthrough_events:
  first_seen:
    priority: info
    relevance_hours: 24
    # No renotify — one-time event (dedup by epoch)

  auction_entered:
    priority: info
    relevance_hours: 24

  bond_balance_change:
    priority: info
    relevance_hours: 24
    # Only goes to API channel (per routing config), not telegram

  version_bump:
    priority: info
    relevance_hours: 24
    skip_dedup: true
```

**Design decisions:**

- **`bond_underfunded_change` with `currentEpochs >= 10` → `shouldNotify: false`:** A bond that covers 10+ epochs is healthy. The emitter still reports the change (it's a delta), but the brain filters it out. This prevents noise from healthy bonds that fluctuate slightly.

- **`cap_changed` with `notify_cap_types: ['BOND']`:** Only the BOND cap is actionable by the validator (they can top up their bond). COUNTRY/ASO/VALIDATOR/WANT/RISK caps are outside the validator's control. We don't notify on those. If the validator wants to see all cap changes, the API channel has them.

- **`announcement` with `skip_dedup: true`:** Admin announcements are always delivered. No notification_id generated.

- **`bond_balance_change` as passthrough info:** Balance changes at lamport level are too noisy for telegram. The `bond_underfunded_change` event handles the critical case (coverage dropped). Balance changes go to API channel only (per routing config).

#### C.2.4 Evaluate Function — Per Inner Type Logic

```typescript
// evaluate.ts

import { createHash } from 'crypto'

export function evaluate(
  event: BondsEventV1,
  config: ThresholdConfig,
): EvaluationResult | null {
  const { inner_type, data } = event
  const details = data.details

  switch (inner_type) {
    case 'bond_underfunded_change':
      return evaluateUnderfunded(
        event,
        config.evaluated_events.bond_underfunded_change,
      )

    case 'auction_exited':
      return evaluateSimple(event, config.evaluated_events.auction_exited)

    case 'cap_changed':
      return evaluateCapChanged(event, config.evaluated_events.cap_changed)

    case 'bond_removed':
      return evaluateSimple(event, config.evaluated_events.bond_removed)

    case 'announcement':
      return {
        shouldNotify: true,
        priority: 'critical',
        relevanceHours: config.evaluated_events.announcement.relevance_hours,
        notificationId: null, // skip dedup
        routingKey: 'announcement',
      }

    case 'first_seen':
    case 'auction_entered':
    case 'bond_balance_change':
    case 'version_bump':
      return evaluatePassthrough(event, config.passthrough_events[inner_type])

    default:
      return null // unknown inner_type — drop silently
  }
}
```

**`evaluateUnderfunded`** — the most complex evaluator:

```typescript
function evaluateUnderfunded(
  event: BondsEventV1,
  cfg: UnderfundedConfig,
): EvaluationResult | null {
  const details = event.data.details
  const currentEpochs = details.current_epochs as number | null
  const bondBalanceSol = details.bond_balance_sol as number | null

  // If we can't determine coverage, notify as warning (data issue)
  if (currentEpochs === null || currentEpochs === undefined) {
    return {
      shouldNotify: true,
      priority: 'warning',
      relevanceHours: cfg.relevance_hours,
      notificationId: makeNotificationId(
        event.vote_account,
        'underfunded',
        'unknown',
        event.created_at,
        cfg.renotify_interval_hours,
      ),
      routingKey: 'bond_underfunded_change',
    }
  }

  // Apply priority rules in order (first match wins)
  for (const rule of cfg.priority_rules) {
    if (matchesCondition(rule.condition, currentEpochs)) {
      if (rule.shouldNotify === false) {
        return {
          shouldNotify: false,
          priority: rule.priority,
          relevanceHours: cfg.relevance_hours,
          notificationId: null,
          routingKey: 'bond_underfunded_change',
        }
      }

      // Check minimum deficit threshold
      const deficitSol = computeDeficitSol(details)
      if (deficitSol !== null && deficitSol < cfg.min_deficit_sol) {
        return {
          shouldNotify: false,
          priority: rule.priority,
          relevanceHours: cfg.relevance_hours,
          notificationId: null,
          routingKey: 'bond_underfunded_change',
        }
      }

      const amountBucket =
        deficitSol !== null
          ? computeAmountBucket(deficitSol, cfg.significant_change_pct)
          : 'unknown'

      return {
        shouldNotify: true,
        priority: rule.priority,
        relevanceHours: cfg.relevance_hours,
        notificationId: makeNotificationId(
          event.vote_account,
          'underfunded',
          String(amountBucket),
          event.created_at,
          cfg.renotify_interval_hours,
        ),
        routingKey: 'bond_underfunded_change',
      }
    }
  }

  // No rule matched — don't notify
  return {
    shouldNotify: false,
    priority: 'info',
    relevanceHours: cfg.relevance_hours,
    notificationId: null,
    routingKey: 'bond_underfunded_change',
  }
}
```

**`evaluateCapChanged`:**

```typescript
function evaluateCapChanged(
  event: BondsEventV1,
  cfg: CapChangedConfig,
): EvaluationResult {
  const currentCap = event.data.details.current_cap as string | null

  const isActionableCap =
    currentCap !== null && cfg.notify_cap_types.includes(currentCap)

  if (isActionableCap) {
    return {
      shouldNotify: true,
      priority: cfg.notify_cap_types_priority,
      relevanceHours: cfg.relevance_hours,
      notificationId: makeNotificationId(
        event.vote_account,
        'cap_changed',
        currentCap,
        event.created_at,
        cfg.renotify_interval_hours,
      ),
      routingKey: 'cap_changed',
    }
  }

  return {
    shouldNotify: cfg.other_caps_shouldNotify ?? false,
    priority: cfg.other_caps_priority ?? 'info',
    relevanceHours: cfg.relevance_hours,
    notificationId: null,
    routingKey: 'cap_changed',
  }
}
```

**`matchesCondition`** — evaluates simple threshold expressions:

```typescript
function matchesCondition(condition: string, currentEpochs: number): boolean {
  // Parses: 'currentEpochs < 2', 'currentEpochs < 10', 'currentEpochs >= 10'
  const match = condition.match(/^currentEpochs\s*(>=|<=|>|<|===|==)\s*(\d+)$/)
  if (!match) throw new Error(`Invalid condition expression: ${condition}`)
  const [, op, valueStr] = match
  const value = Number(valueStr)
  switch (op) {
    case '<':
      return currentEpochs < value
    case '<=':
      return currentEpochs <= value
    case '>':
      return currentEpochs > value
    case '>=':
      return currentEpochs >= value
    case '==':
    case '===':
      return currentEpochs === value
    default:
      return false
  }
}
```

**Why a mini expression parser and not `eval()`?** Security. The conditions come from YAML config which is embedded in the library and trusted, but we still avoid `eval()` as a matter of principle. The expression syntax is intentionally limited to `currentEpochs <op> <number>`.

**`computeDeficitSol`** — reads deficit directly from event details:

```typescript
function computeDeficitSol(details: Record<string, unknown>): number | null {
  // ✅ The emitter now includes deficit_sol, required_sol, epoch_cost_sol,
  // and expected_max_eff_bid_pmpe in bond_underfunded_change event details.
  // deficit_sol = max(0, required_sol - bondBalanceSol) where required_sol
  // accounts for on-chain obligations + 1 epoch of bid coverage.
  const deficitSol = details.deficit_sol as number | undefined
  return deficitSol !== undefined ? deficitSol : null
}
```

**Deficit metrics in emitter (✅ implemented):** The emitter's `bond_underfunded_change` and `first_seen` events now include:

- `deficit_sol` — how much more SOL is needed for 1 epoch of bid coverage
- `required_sol` — total bond needed (on-chain obligations + bid cost per epoch)
- `epoch_cost_sol` — bid cost per epoch: `(expectedMaxEffBidPmpe / 1000) * marinadeActivatedStakeSol`
- `expected_max_eff_bid_pmpe` — raw PMPE value from SDK for further computation

#### C.2.5 Notification ID Generation

The notification_id is a deterministic SHA-256 hash that encodes:

- **What** changed (vote_account + event category + magnitude bucket)
- **When** to re-notify (time bucket based on `renotify_interval_hours`)

When the hash changes, the dedup check passes and a new notification is delivered. This is the sole mechanism for re-notification — no timers, no state machine in the consumer.

```typescript
// notification-id.ts

import { createHash } from 'crypto'

/**
 * Generate a deterministic notification ID for dedup.
 *
 * The ID changes when:
 * 1. The situation changes significantly (different magnitudeBucket)
 * 2. The re-notify interval elapses (different timeBucket)
 *
 * Same ID = dedup'd (already delivered). New ID = new delivery.
 */
export function makeNotificationId(
  voteAccount: string,
  category: string,
  magnitudeBucket: string,
  createdAtIso: string,
  renotifyIntervalHours: number,
): string {
  const timeBucket = computeTimeBucket(createdAtIso, renotifyIntervalHours)
  const input = `${voteAccount}:${category}:${magnitudeBucket}:${timeBucket}`
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Time bucket: floor(timestamp / interval).
 * When the interval elapses, the bucket number increments,
 * producing a new notification_id → bypasses dedup.
 */
function computeTimeBucket(
  createdAtIso: string,
  intervalHours: number,
): number {
  const ms = new Date(createdAtIso).getTime()
  const intervalMs = intervalHours * 3600 * 1000
  return Math.floor(ms / intervalMs)
}

/**
 * Amount bucket using logarithmic scale.
 * Base = 1 + (pct / 100). Each bucket spans a ~pct% range.
 *
 * Example with pct=20:
 *   deficit 8.5 SOL → bucket 11  (range ~7.4–8.9)
 *   deficit 11.0 SOL → bucket 12  (range ~8.9–10.7)
 *   deficit 8.6 SOL → bucket 11  (same — <20% change, dedup'd)
 *
 * Edge case: values near bucket boundaries may cross on small changes.
 * This is acceptable — the goal is approximate dedup, not exact thresholds.
 */
export function computeAmountBucket(
  value: number,
  significantChangePct: number,
): number {
  if (value <= 0) return 0
  const base = 1 + significantChangePct / 100
  return Math.floor(Math.log(value) / Math.log(base))
}
```

**Notification ID per inner_type:**

| inner_type                | category         | magnitudeBucket                         | renotify interval |
| ------------------------- | ---------------- | --------------------------------------- | ----------------- |
| `bond_underfunded_change` | `underfunded`    | `computeAmountBucket(deficitOrBalance)` | 24h               |
| `auction_exited`          | `auction_exited` | `epoch` (string)                        | 24h               |
| `cap_changed`             | `cap_changed`    | `currentCap` (e.g., "BOND")             | 24h               |
| `bond_removed`            | `bond_removed`   | `epoch` (string)                        | 24h               |
| `first_seen`              | `first_seen`     | `epoch` (string)                        | — (no renotify)   |
| `auction_entered`         | `entered`        | `epoch` (string)                        | — (no renotify)   |
| `bond_balance_change`     | `balance`        | `epoch` (string)                        | — (no renotify)   |
| `announcement`            | —                | —                                       | — (skip dedup)    |
| `version_bump`            | —                | —                                       | — (skip dedup)    |

For `first_seen`, `auction_entered`, `bond_balance_change`: the notificationId uses epoch as the magnitude bucket and a very large renotify interval (effectively once per epoch). Since these are info-level, this prevents duplicates within an epoch without needing re-notification logic.

#### C.2.6 Notification Content Building

The brain provides a `buildContent()` method that returns **structured content** — the domain-specific "what to say." The notifications service handles "how to present it" per channel.

```typescript
buildContent(
  event: BondsEventV1,
  evaluation: EvaluationResult,
): NotificationContent {
  const details = event.data.details

  switch (event.inner_type) {
    case 'bond_underfunded_change':
      return {
        title: 'Bond Underfunded',
        body: event.data.message,
        dataPoints: [
          { label: 'Coverage', value: `${details.current_epochs} epochs` },
          { label: 'Balance', value: `${details.bond_balance_sol} SOL` },
          ...(details.deficit_sol != null
            ? [{ label: 'Deficit', value: `${details.deficit_sol} SOL` }]
            : []),
        ],
      }

    case 'auction_exited':
      return {
        title: 'Removed from Auction',
        body: event.data.message,
      }

    case 'cap_changed':
      return {
        title: 'Stake Cap Changed',
        body: event.data.message,
        dataPoints: [
          { label: 'Previous cap', value: `${details.previous_cap ?? 'none'}` },
          { label: 'Current cap', value: `${details.current_cap ?? 'none'}` },
        ],
      }

    // ... other inner_types follow the same pattern

    default:
      return {
        title: event.inner_type,
        body: event.data.message,
      }
  }
}
```

**Channel-specific formatting lives in marinade-notifications:**

```typescript
// notification-service/formatting/notification-formatter.ts (generic, reusable)

export function formatForTelegram(
  content: NotificationContent,
  priority: NotificationPriority,
): string {
  const emoji = { critical: '🔴', warning: '🟡', info: 'ℹ️' }[priority]
  let text = `${emoji} <b>${content.title}</b>\n\n${content.body}`
  if (content.dataPoints?.length) {
    text += '\n'
    for (const dp of content.dataPoints) {
      text += `\n• ${dp.label}: <b>${dp.value}</b>`
    }
  }
  return text
}

export function formatForApi(
  content: NotificationContent,
  priority: NotificationPriority,
): Record<string, unknown> {
  return { ...content, priority }
}
```

**Why this split?** The brain knows the domain semantics (what fields matter, what title to show). The notifications service knows the channel constraints (Telegram HTML, character limits, emoji conventions). This separation means:

- When bonds adds a new event type → only the brain changes
- When a new channel is added → only the formatter changes
- When staking-rewards migrates to the pipeline → it returns `NotificationContent` too, reusing the same formatters

#### C.2.7 `extractUserId` and Broadcast

```typescript
extractUserId(event: BondsEventV1): string {
  return event.vote_account
}
```

The user_id is always the `vote_account`. Subscriptions are keyed by vote_account (Part B server-side verifier returns `userId: vote_account`). Events are keyed by vote_account (Part A emitter). This alignment is critical — it's how the consumer connects events to subscribers.

**Announcement broadcasts:** For `announcement` events, the consumer uses the routing config's `force: true` flag to deliver to ALL bonds subscribers. The `extractUserId` still returns the vote_account from the event (which uses the sentinel pubkey `MarinadeNotifications1111111111111111111111` for system-wide announcements — 41 chars, passes the schema's minLength:32/maxLength:44 validation). The force flag overrides the standard "lookup this user's subscriptions" behavior — see C.4.4.

#### C.2.8 Package Structure

```
packages/bonds-notification/
  package.json                      — @marinade.finance/bonds-notification, NOT private
  tsconfig.json
  jest.config.js                    — setupFiles: ['reflect-metadata'] for class-transformer
  README.md                         — package overview
  src/
    index.ts                        — re-exports brain, types, evaluate, notification-id, DTOs
    brain.ts                        — async createBondsNotificationBrain(), config injected at construction
    evaluate.ts                     — evaluate() + per-type evaluators
    notification-id.ts              — makeNotificationId(), computeAmountBucket(), computeTimeBucket()
    content.ts                      — buildContent() + per-inner-type content builders
    threshold-config.ts             — async loadThresholdConfig() — loadFileSync + parseAndValidateYaml
    threshold-config-dto.ts         — class-validator DTOs for YAML config validation
    types.ts                        — BONDS_EVENT_INNER_TYPES const array, BondsEventInnerType, etc.
    config/
      thresholds.yaml               — embedded threshold config (copied to dist/ by build)
  __tests__/
    evaluate.spec.ts                — per-inner-type evaluation logic
    notification-id.spec.ts         — deterministic ID generation, bucket math
    content.spec.ts                 — content building per inner_type
    brain.spec.ts                   — integration: full brain flow for various scenarios
```

**Dependencies (updated after Part F migration):**

```json
{
  "name": "@marinade.finance/bonds-notification",
  "version": "0.0.1",
  "private": false,
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "files": ["dist/", "!dist/__tests__"],
  "dependencies": {
    "@marinade.finance/cli-common": "4.2.2",
    "@marinade.finance/ts-common": "4.2.2",
    "class-transformer": "0.5.1"
  },
  "peerDependencies": {
    "class-validator": "^0.14.0 || ^0.15.0"
  },
  "devDependencies": {
    "class-validator": "0.14.2",
    "reflect-metadata": "0.2.2"
  }
}
```

**No peer dependency on `@marinade.finance/bonds-eventing`:** The brain defines `BondsEventV1` locally. This avoids pulling the eventing package and its heavy `ds-sam-sdk` dependency into the consumer.

#### C.2.9 Testing

**`evaluate.spec.ts`** — per-inner-type tests:

- `bond_underfunded_change` with currentEpochs=1 → shouldNotify=true, priority=critical
- `bond_underfunded_change` with currentEpochs=5 → shouldNotify=true, priority=warning
- `bond_underfunded_change` with currentEpochs=15 → shouldNotify=false (well-funded)
- `bond_underfunded_change` with currentEpochs=null → shouldNotify=true, priority=warning (defensive)
- `bond_underfunded_change` with deficit_sol=0.3 (below min_deficit_sol=0.5) → shouldNotify=false
- `auction_exited` → shouldNotify=true, priority=critical
- `cap_changed` with current_cap=BOND → shouldNotify=true, priority=warning
- `cap_changed` with current_cap=COUNTRY → shouldNotify=false
- `cap_changed` with current_cap=null (cap removed) → shouldNotify=false
- `bond_removed` → shouldNotify=true, priority=critical
- `announcement` → shouldNotify=true, notificationId=null
- `first_seen` → shouldNotify=true, priority=info
- `bond_balance_change` → shouldNotify=true, priority=info
- unknown inner_type → returns null

**`notification-id.spec.ts`:**

- Same event data + same time bucket → same notification_id (deterministic)
- Same event data + different time bucket (24h later) → different notification_id
- Same event + different amount bucket (deficit changed >10%) → different notification_id
- Same event + small deficit change (<10%) → same notification_id (within same bucket)
- `computeAmountBucket` at boundary: 8.5 SOL and 8.6 SOL → same bucket
- `computeAmountBucket` at boundary: 8.5 SOL and 10.0 SOL → different bucket
- `computeTimeBucket` roll: event at 23:59 day N and 00:01 day N+1 → different buckets

**`content.spec.ts`:**

- bond_underfunded_change → title "Bond Underfunded", dataPoints include coverage + deficit
- auction_exited → title "Removed from Auction"
- cap_changed → title "Stake Cap Changed", dataPoints include previous/current cap
- unknown inner_type → title = inner_type, body = raw message

**`brain.spec.ts`** — integration scenarios:

- Full flow: underfunded event → evaluate → buildContent → verify all fields
- Full flow: auction_exited → evaluate → critical priority
- Announcement → skip dedup, critical priority
- Event with all null details → graceful handling, no crash

---

### C.3 Schema & Code Generation (marinade-notifications repo) ✅ IMPLEMENTED

> **Status:** The codegen pipeline is implemented. `bonds-event-v1.json` schema lives in `marinade-notifications/message-types/schemas/`. Running `pnpm generate` produces the `bonds-event-v1` TypeScript package (types + Ajv validator) and Rust crate. All three consumers import from the generated package.
>
> The plan below describes the intended future state.

#### C.3.0 Using the marinade-notifications codegen pipeline

The marinade-notifications system has a **JSON Schema → code generation** pipeline that auto-generates TypeScript packages (types + Ajv validator) and Rust crates (types + jsonschema validator) from schema files. This is the core automation of the framework — all message types must use it.

**Workflow:**

1. Define `schemas/bonds-event-v1.json` in `marinade-notifications/message-types/`
2. Run `pnpm generate` → auto-generates:
   - `typescript/bonds-event-v1/` — TS types + `BondsEventV1Validator` (Ajv-based)
   - `rust/bonds_event_v1/` — Rust types + validator
3. Generated code is committed to git (zero build deps for consumers, explicit diffs in PRs)
4. CI runs `pnpm check-sync` to prevent schema/code divergence

**Implications for bonds:**

- The **canonical `BondsEventV1` type** and **schema validator** come from the generated package — not from a separate testing package or `bonds-eventing`
- The **emitter** imports `BondsEventV1` type from the generated package + uses `Producer` from `ts-message-client` for envelope wrapping and pre-send validation
- The **consumer ingress** imports `BondsEventV1Validator` from the generated package for payload validation
- No separate `bonds-event-testing` package needed — each repo keeps its own test factories locally, both import the same generated types

#### C.3.1 Cross-Validation Testing Strategy

Both repos must validate that the messages they produce/consume match the shared schema. The generated `bonds-event-v1` package is the single contract — no separate shared testing package.

**Emitter side (validator-bonds/bonds-eventing):**

```typescript
// In emitter tests — validate that every emitted event passes the generated validator
import { BondsEventV1Validator } from 'bonds-event-v1'

it('emitted events pass schema validation', () => {
  const events = evaluateDeltas(
    validators,
    previousState,
    930,
    'bidding',
    logger,
  )
  for (const event of events) {
    // This catches drift: if emitter produces fields the schema doesn't allow,
    // or misses required fields, the test fails
    expect(() => BondsEventV1Validator.validate(event)).not.toThrow()
  }
})

it('rejects malformed events', () => {
  const bad = { type: 'bonds', inner_type: 'unknown_type' }
  expect(() => BondsEventV1Validator.validate(bad)).toThrow()
})
```

**Consumer side (marinade-notifications):**

```typescript
// In consumer/ingress tests — validate that the consumer correctly accepts/rejects
import { BondsEventV1Validator } from 'bonds-event-v1'

// Build realistic test events matching what the emitter actually produces
function makeTestEvent(overrides: Partial<BondsEventV1> = {}): BondsEventV1 {
  const event = { type: 'bonds', inner_type: 'bond_underfunded_change', ... , ...overrides }
  BondsEventV1Validator.validate(event) // factory output must be schema-valid
  return event
}

// E2E: POST test events to ingress, verify they flow through the pipeline
// This catches: ingress rejects valid events, consumer misreads fields, etc.
```

**The contract enforcement loop:**

1. Schema change in `marinade-notifications/message-types/schemas/bonds-event-v1.json`
2. `pnpm generate` → updates generated TypeScript + Rust packages
3. `pnpm check-sync` in CI catches uncommitted drift
4. Emitter tests in validator-bonds break if they produce events the schema no longer allows
5. Consumer tests in marinade-notifications break if they expect fields the schema removed
6. Both sides must update before CI goes green → no silent drift

#### C.3.3 JSON Schema (lives in `marinade-notifications/message-types/schemas/bonds-event-v1.json`)

This schema is the input to the codegen pipeline. Following the framework convention: schemas define **payload only** — the `Message<T>` header envelope is handled by `ts-message`/`rust-message`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "bonds-event-v1",
  "title": "BondsEventV1",
  "type": "object",
  "required": [
    "type",
    "inner_type",
    "vote_account",
    "bond_type",
    "data",
    "created_at"
  ],
  "properties": {
    "type": { "const": "bonds" },
    "inner_type": {
      "enum": [
        "first_seen",
        "bond_removed",
        "auction_entered",
        "auction_exited",
        "cap_changed",
        "bond_underfunded_change",
        "bond_balance_change",
        "announcement",
        "version_bump"
      ]
    },
    "vote_account": { "type": "string", "minLength": 32, "maxLength": 44 },
    "bond_type": { "type": "string", "enum": ["bidding", "institutional"] },
    "bond_pubkey": { "type": "string", "minLength": 32, "maxLength": 44 },
    "epoch": { "type": "integer", "minimum": 0 },
    "data": {
      "type": "object",
      "required": ["message", "details"],
      "properties": {
        "message": { "type": "string", "minLength": 1 },
        "details": { "type": "object", "additionalProperties": true }
      }
    },
    "created_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

**Type flow:** `marinade-notifications codegen` → `bonds-event-v1` (generated) → consumed directly by `bonds-eventing` and `bonds-notification`.

---

### C.4 Consumer Pipeline (marinade-notifications repo) ✅

> **Implemented** in marinade-notifications commit `98d7fb2` — ingress endpoint, consumer worker (8-stage pipeline), dedup, routing config, telegram delivery, outbox, DB migrations, rate limiting, metrics.
>
> **Key difference from plan:** Uses local hand-written `validateBondsEventV1()` instead of `BondsEventV1Validator` from generated package. The consumer imports `@marinade.finance/bonds-notification` via local file link (`link:../../validator-bonds/packages/bonds-notification`).

#### C.4.1 Ingress Endpoint — `POST /bonds-event-v1`

A new NestJS controller following the exact pattern of the existing `staking-rewards-report-status-v1` controller.

```typescript
// notification-service/ingress/bonds-event-v1/controller.ts

@Controller()
export class BondsEventV1Controller {
  constructor(
    private readonly queues: QueuesService,
    private readonly config: ConfigService,
  ) {}

  @Post('bonds-event-v1')
  @UseGuards(AuthGuard)
  @RateLimit({ windowMs: 60_000, max: 200 })
  async ingest(
    @Body() body: { header: Header; payload: BondsEventV1 },
  ): Promise<SubmitResponse> {
    // 1. Validate header (HeaderValidator from ts-message)
    headerValidator.validate(body.header)

    // 2. Validate payload (BondsEventV1Validator from generated bonds-event-v1 package)
    BondsEventV1Validator.validate(body.payload)

    // 3. Check per-producer rate limit
    if (!this.producerRateLimiter.check(body.header.producer_id)) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS)
    }

    // 4. Enqueue to bonds_event_v1_inbox
    await this.queues.enqueue('bonds-event-v1', {
      message_id: body.header.message_id,
      producer_id: body.header.producer_id,
      created_at: new Date(body.header.created_at),
      received_at: new Date(),
      payload: body.payload,
    })

    return {
      message_id: body.header.message_id,
      topic: 'bonds-event-v1',
      producer_id: body.header.producer_id,
      created_at: body.header.created_at,
      received_at: Date.now(),
    }
  }
}
```

**Ingress module structure (follows staking-rewards pattern exactly):**

The staking-rewards ingress has three files: controller, service, module. The bonds ingress follows the same pattern:

```
notification-service/ingress/bonds-event-v1/
  controller.ts     — @Controller('bonds-event-v1'), @Post(), validation + enqueue
  service.ts        — BondsEventV1IngressService: wraps QueuesService.enqueue()
  module.ts         — BondsEventV1Module: imports ConfigModule, QueuesModule, AuthModule
                      provides: Controller, Service, BondsRateLimiterService, AuthGuard
```

**`BondsRateLimiterService`** — per-producer rate limiter (same pattern as `StakingRewardsRateLimiterService`). Tracks request counts per `producer_id` in a sliding window. Configured via `BONDS_PRODUCER_RATE_LIMIT_MAX` env var (default: 200/min — higher than staking-rewards due to burst patterns on first run).

**Differences from staking-rewards controller:**

- Route: `/bonds-event-v1` (not `/staking-rewards-report-status-v1`)
- Higher rate limit: 200/min (emitter can send ~100 events in bursts on first run or after reconnect)
- Payload validation uses `BondsEventV1Validator` from the auto-generated `bonds-event-v1` package (codegen pipeline)
- Same JWT auth, same queue pattern

**Event wrapping (✅ implemented):** The emitter now wraps events in the standard `Message<BondsEventV1>` envelope:

```typescript
// bonds-eventing emit-events.ts — already implemented:
{
  header: {
    producer_id: 'bonds-eventing',
    message_id: crypto.randomUUID(),
    created_at: Date.now(),
  },
  payload: event,  // BondsEventV1
}
```

#### C.4.2 Queue Tables — Topic Registration

The existing `QueuesService` maps topic strings to table prefixes via a hardcoded `TOPIC_TABLE_MAP` record. Add the bonds topic:

```typescript
// File: notification-service/queues/queues.service.ts, line ~101
// Add to the TOPIC_TABLE_MAP constant:
const TOPIC_TABLE_MAP: Record<string, string> = {
  'staking-rewards/report-status/v1': 'staking_rewards_report_status_v1',
  'staking-rewards-report-status-v1': 'staking_rewards_report_status_v1',
  'bonds-event-v1': 'bonds_event_v1', // NEW
}
```

This enables the standard three-table pattern: `bonds_event_v1_inbox`, `bonds_event_v1_archive`, `bonds_event_v1_dlq`. All `QueuesService` methods (`enqueue`, `dequeue`, `archive`, `moveToDeadLetter`, `scheduleRetry`) auto-work with the new topic.

#### C.4.3 Database Migrations

Single migration file in `notification-service/migrations/` for all Part C tables (queue tables + dedup + outbox):

```sql
-- 04-bonds-event-v1.sql

-- Queue tables for bonds-event-v1 topic (same pattern as staking-rewards)
CREATE TABLE bonds_event_v1_inbox (
    message_id UUID PRIMARY KEY,
    producer_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ
);
CREATE INDEX idx_bonds_inbox_next_retry ON bonds_event_v1_inbox(next_retry_at)
    WHERE next_retry_at IS NOT NULL;
CREATE INDEX idx_bonds_inbox_received_at ON bonds_event_v1_inbox(received_at);

CREATE TABLE bonds_event_v1_archive (
    message_id UUID PRIMARY KEY,
    producer_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace JSONB
);
CREATE INDEX idx_bonds_archive_archived_at ON bonds_event_v1_archive(archived_at);

CREATE TABLE bonds_event_v1_dlq (
    message_id UUID PRIMARY KEY,
    producer_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error TEXT,
    trace JSONB
);
CREATE INDEX idx_bonds_dlq_failed_at ON bonds_event_v1_dlq(failed_at);

-- Dedup table — shared across all notification types
-- The notification_id is the sole dedup key. No user_id, no time comparison.
CREATE TABLE notification_dedup (
    notification_id TEXT PRIMARY KEY,
    notification_type TEXT NOT NULL,          -- 'bonds', 'staking-rewards', etc.
    user_id TEXT NOT NULL,                    -- vote_account for bonds
    inner_type TEXT,                          -- event inner_type (for diagnostics)
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    channels TEXT[] NOT NULL DEFAULT '{}'     -- which channels were delivered to
);
CREATE INDEX idx_dedup_user ON notification_dedup(user_id, notification_type);
CREATE INDEX idx_dedup_delivered ON notification_dedup(delivered_at);

-- Notifications outbox — for the API pull channel
-- Stores delivered notifications that can be read by CLI / PSR dashboard
CREATE TABLE notifications_outbox (
    id BIGSERIAL PRIMARY KEY,
    notification_type TEXT NOT NULL,
    inner_type TEXT NOT NULL,
    user_id TEXT NOT NULL,                    -- vote_account for bonds
    priority TEXT NOT NULL,                   -- 'critical', 'warning', 'info'
    message TEXT NOT NULL,                    -- human-readable notification text
    data JSONB NOT NULL,                      -- full event payload for rich display
    notification_id TEXT,                     -- dedup reference (nullable for skip-dedup events)
    relevance_until TIMESTAMPTZ NOT NULL,     -- created_at + relevanceHours
    deactivated_at TIMESTAMPTZ,              -- soft-delete: non-NULL = hidden from read API
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_user_type ON notifications_outbox(user_id, notification_type);
CREATE INDEX idx_outbox_active ON notifications_outbox(user_id, notification_type, relevance_until)
    WHERE deactivated_at IS NULL;             -- partial index; relevance_until > now() filtering stays in the query, not the index
CREATE INDEX idx_outbox_created ON notifications_outbox(created_at);
```

**Design decisions:**

- **`notification_dedup` is shared** — not per-topic. The notification_id is globally unique (includes vote_account + category in the hash). A single table is simpler and dedup checks are O(1) by primary key.

- **`notifications_outbox` has `relevance_until`** — computed as `created_at + relevanceHours`. The read API filters `WHERE relevance_until > now() AND deactivated_at IS NULL`. Old entries naturally expire from query results without deletion. A periodic cleanup job can archive rows where `relevance_until < now() - 30d`.

- **`deactivated_at` for soft-delete** — admin can deactivate any notification (especially announcements) via `PATCH /notifications/{id}/deactivate` which sets `deactivated_at = NOW()`. The row stays in DB for audit trail. Read API and dashboard filter it out. No row deletion needed.

- **`channels TEXT[]` in dedup table** — records which channels were delivered to. Useful for diagnostics ("was this sent via Telegram?").

#### C.4.4 Consumer Worker

A new NestJS service following the existing consumer pattern (polling loop, lease-based dequeue, retry with backoff).

```typescript
// notification-service/consumers/bonds-event-v1/consumer.ts

@Injectable()
export class BondsEventV1Consumer implements OnModuleInit, OnModuleDestroy {
  private readonly brain: BondsNotificationBrain
  private abortController: AbortController

  constructor(
    private readonly logger: PinoLogger,
    private readonly queues: QueuesService,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramDeliveryService,
    private readonly rds: RdsService,
    // Metrics injected via @InjectMetric (same pattern as staking-rewards consumer)
  ) {
    this.brain = createBondsNotificationBrain() // from @marinade.finance/bonds-notification
  }

  async processMessage(msg: QueueMessageWithRetry): Promise<void> {
    const event = msg.payload as BondsEventV1
    const topic = 'bonds-event-v1'

    // Stage 1: Validate (schema already validated at ingress, but defense-in-depth)
    BondsEventV1Validator.validate(event) // from generated bonds-event-v1 package

    // Stage 2: Evaluate via brain
    const evaluation = this.brain.evaluate(event)
    if (!evaluation || !evaluation.shouldNotify) {
      await this.queues.archive(topic, msg.message_id, {
        reason: 'brain_filtered',
        evaluation,
      })
      return
    }

    // Stage 3: Extract user ID
    const userId = this.brain.extractUserId(event)

    // Stage 4: Dedup — optimistic reservation (insert-or-skip)
    if (evaluation.notificationId !== null) {
      const reserved = await this.reserveDedup(
        evaluation.notificationId,
        'bonds',
        userId,
        event.inner_type,
      )
      if (!reserved) {
        // Already reserved by another consumer → skip (archive as dedup)
        await this.queues.archive(topic, msg.message_id, {
          reason: 'dedup',
          notification_id: evaluation.notificationId,
        })
        return
      }
    }

    // Stage 5: Resolve delivery targets
    const targets = await this.resolveTargets(userId, event, evaluation)

    // Stage 6: Build content + deliver
    const content = this.brain.buildContent(event, evaluation)
    const deliveredChannels: string[] = []
    for (const target of targets) {
      await this.deliver(target, content, evaluation, event)
      if (!target.metadata?.skipped) {
        deliveredChannels.push(target.channel)
      }
    }

    // Stage 7: Update dedup record with delivered channels
    if (evaluation.notificationId !== null) {
      await this.finalizeDedupChannels(
        evaluation.notificationId,
        deliveredChannels,
      )
    }

    // Stage 8: Write to notifications_outbox (API channel — always, for pull access)
    await this.writeOutbox(event, evaluation, userId)

    // Stage 9: Archive
    await this.queues.archive(topic, msg.message_id, {
      reason: 'delivered',
      notification_id: evaluation.notificationId,
      channels: deliveredChannels,
      priority: evaluation.priority,
    })
  }
}
```

**Key implementation details:**

**Optimistic dedup reservation (insert-or-skip):**

```typescript
private async reserveDedup(
  notificationId: string,
  notificationType: string,
  userId: string,
  innerType: string,
): Promise<boolean> {
  // Optimistic lock: INSERT with ON CONFLICT DO NOTHING, check affected rows
  const result = await this.rds.pool.query(sql.unsafe`
    INSERT INTO notification_dedup (notification_id, notification_type, user_id, inner_type, channels)
    VALUES (${notificationId}, ${notificationType}, ${userId}, ${innerType}, ${sql.array([], 'text')})
    ON CONFLICT (notification_id) DO NOTHING
  `)
  // 1 row affected → reservation acquired (proceed with delivery)
  // 0 rows affected → already reserved by another consumer (skip)
  return result.rowCount === 1
}
```

**Finalize dedup channels (after successful delivery):**

```typescript
private async finalizeDedupChannels(
  notificationId: string,
  channels: string[],
): Promise<void> {
  await this.rds.pool.query(sql.unsafe`
    UPDATE notification_dedup
    SET channels = ${sql.array(channels, 'text')}
    WHERE notification_id = ${notificationId}
  `)
}
```

**Release dedup reservation (on delivery failure):**

```typescript
private async releaseDedupReservation(
  notificationId: string,
): Promise<void> {
  await this.rds.pool.query(sql.unsafe`
    DELETE FROM notification_dedup WHERE notification_id = ${notificationId}
  `)
}
```

**Resolve delivery targets:**

```typescript
private async resolveTargets(
  userId: string,
  event: BondsEventV1,
  evaluation: EvaluationResult,
): Promise<DeliveryTarget[]> {
  const routingConfig = this.loadRoutingConfig()
  const innerTypeConfig = routingConfig.bonds.inner_types[evaluation.routingKey]
    ?? { channels: routingConfig.bonds.default_channels }

  // Force broadcast (announcements) — deliver to ALL bonds subscribers
  if (innerTypeConfig.force) {
    return this.getAllBondsSubscriberTargets(innerTypeConfig.channels)
  }

  // Standard path: look up this user's subscriptions
  const subscribed = await this.subscriptions.getSubscribedChannels(userId, 'bonds')

  // Intersect subscribed channels with allowed channels for this inner_type
  const targets: DeliveryTarget[] = []
  for (const sub of subscribed) {
    if (innerTypeConfig.channels.includes(sub.channel)) {
      targets.push(await this.resolveTarget(sub, userId))
    }
  }

  return targets
}
```

**Why intersect subscribed ∩ allowed?** The routing config defines which channels are ALLOWED for each inner_type. The subscription defines which channels the user WANTS. The intersection ensures:

- `bond_balance_change` (allowed: [api] only) never goes to Telegram even if the user subscribed to Telegram
- `auction_exited` (allowed: [telegram, api]) goes to Telegram only if the user subscribed to Telegram

**Resolve target — Telegram chat_id lookup:**

```typescript
private async resolveTarget(
  sub: { channel: string; channelAddress: string },
  userId: string,
): Promise<DeliveryTarget> {
  if (sub.channel === 'telegram') {
    // Look up the activated chat_id for this subscription
    const chatId = await this.subscriptions.getTelegramChatId(
      userId, 'bonds', sub.channelAddress,
    )
    if (!chatId) {
      // Subscription exists but Telegram not activated (user didn't click deep link)
      // Skip this target — log warning
      this.logger.warn({ userId, channel: 'telegram' }, 'Telegram not activated, skipping')
      return { channel: 'telegram', address: '', metadata: { skipped: true } }
    }
    return { channel: 'telegram', address: String(chatId) }
  }

  return { channel: sub.channel, address: sub.channelAddress }
}
```

**Deliver:**

```typescript
private async deliver(
  target: DeliveryTarget,
  content: NotificationContent,
  evaluation: EvaluationResult,
  event: BondsEventV1,
): Promise<void> {
  if (target.metadata?.skipped) return

  switch (target.channel) {
    case 'telegram':
      // v1: plain text. The content.body from the brain is a human-readable summary.
      // Future: introduce a NotificationFormatter service for rich formatting
      // (emojis, HTML, dataPoints rendering) — the NotificationContent interface
      // already carries all the data needed for channel-specific presentation.
      await this.telegram.sendMessage(Number(target.address), content.body)
      break
    case 'api':
      // API channel is handled by writeOutbox() — no additional delivery needed
      break
    default:
      this.logger.warn({ channel: target.channel }, 'Unknown delivery channel')
  }
}
```

**Write to outbox (API pull channel):**

```typescript
private async writeOutbox(
  event: BondsEventV1,
  evaluation: EvaluationResult,
  userId: string,
  isBroadcast: boolean,
): Promise<void> {
  const relevanceUntil = new Date(
    new Date(event.created_at).getTime() + evaluation.relevanceHours * 3600 * 1000
  )

  // For broadcast (force: true) announcements, insert a SINGLE row with the
  // sentinel pubkey as user_id. The read API returns broadcast rows to all users.
  const outboxUserId = isBroadcast
    ? 'MarinadeNotifications1111111111111111111111'
    : userId

  await this.rds.pool.query(sql.unsafe`
    INSERT INTO notifications_outbox
      (notification_type, inner_type, user_id, priority, message, data, notification_id, relevance_until)
    VALUES
      (${'bonds'}, ${event.inner_type}, ${outboxUserId}, ${evaluation.priority},
       ${event.data.message}, ${sql.jsonb(event)}, ${evaluation.notificationId},
       ${relevanceUntil.toISOString()})
  `)
}
```

**Polling loop and error handling** follow the existing `staking-rewards` consumer pattern:

- `OnModuleInit`: start polling loop
- `OnModuleDestroy`: set abort signal
- Dequeue with SKIP LOCKED + processing lease
- On retryable error: schedule retry with exponential backoff
- On non-retryable error (validation, brain error): move to DLQ
- Metrics: messages processed, messages DLQ'd, processing duration

#### C.4.5 Formatting Strategy (v1: plain text, future: rich formatting)

**v1:** The consumer sends `content.body` (from the brain) as plain text to Telegram. No `parse_mode` parameter — Telegram renders it as-is. The API channel returns the full `NotificationContent` as JSON (title, body, dataPoints, priority).

**Future extension path:** When rich formatting is needed (emojis, HTML, dataPoints rendering), introduce a `NotificationFormatter` service:

```typescript
// Future: notification-service/formatting/notification-formatter.ts
@Injectable()
export class NotificationFormatter {
  format(
    content: NotificationContent,
    channel: string,
    priority: string,
  ): string
}
```

The `NotificationContent` interface already carries all the data needed for channel-specific presentation (title, body, dataPoints). The formatter can be added without changing the brain — it only changes how the consumer calls `deliver()`. No v1 code changes needed when this is introduced — just inject the formatter and use it instead of `content.body` directly.

#### C.4.6 Telegram Delivery Service

The existing `TelegramController` handles webhook events (activation, unsubscribe on block). For **outbound message delivery**, we need a dedicated service:

```typescript
// notification-service/telegram/telegram-delivery.service.ts

@Injectable()
export class TelegramDeliveryService {
  constructor(private readonly config: ConfigService) {}

  async sendMessage(chatId: number, text: string): Promise<void> {
    const botToken = this.config.telegramBotToken
    if (!botToken) {
      this.logger.warn('Telegram bot token not configured, skipping delivery')
      return
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        // v1: no parse_mode — plain text. When NotificationFormatter is added,
        // switch to parse_mode: 'HTML' for rich formatting (emojis, bold, etc.)
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const body = await response.text()
      // Check for specific Telegram errors
      if (response.status === 403) {
        // Bot was blocked by user — unsubscribe
        this.logger.info({ chatId }, 'Bot blocked by user, unsubscribing')
        // Note: the webhook handler already handles this via my_chat_member events.
        // This is a defense-in-depth catch for race conditions.
      }
      throw new Error(`Telegram API error ${response.status}: ${body}`)
    }
  }
}
```

**Design note:** The existing `telegram.controller.ts` already has a `sendMessage` method used for activation confirmations. The delivery service can either:

1. **Reuse it** — extract `sendMessage` from the controller into a shared service
2. **New service** — `TelegramDeliveryService` for outbound notification delivery

Option 1 is cleaner (DRY). The refactor: move `sendMessage` to `TelegramDeliveryService`, inject it into both the controller and the consumer.

#### C.4.7 Notification Routing Config

```yaml
# notification-service/configuration/notification-routing.yaml

bonds:
  default_channels: [api]
  inner_types:
    bond_underfunded_change:
      channels: [telegram, api]
    auction_exited:
      channels: [telegram, api]
    cap_changed:
      channels: [telegram, api]
    bond_removed:
      channels: [telegram, api]
    announcement:
      channels: [telegram, api]
      force: true # deliver to ALL bonds subscribers
    first_seen:
      channels: [api]
    auction_entered:
      channels: [api]
    bond_balance_change:
      channels: [api]
    version_bump:
      channels: [api]
```

**Key design decisions:**

- **`default_channels: [api]`** — unknown inner_types go to API only (safe default)
- **`telegram` only for actionable events** — `bond_underfunded_change`, `auction_exited`, `cap_changed`, `bond_removed`, `announcement`. These are events where the validator should take action.
- **`api` for everything** — all events are available via the pull API, even info-level ones
- **`force: true` only for `announcement`** — broadcasts to all subscribers. Other events route per-user.
- **Routing config uses delta inner_types** (not condition-based types from the original SUMMARY). This matches what the emitter actually produces.

#### C.4.8 Notifications Read API

```typescript
// notification-service/notifications/notifications.controller.ts

@Controller('notifications')
export class NotificationsController {
  @Get()
  @UseGuards(OptionalSolanaAuthGuard) // auth is optional — see below
  async getNotifications(
    @AuthUser() user: { userId: string } | null, // null when unauthenticated
    @Query('notification_type') type?: string,
    @Query('priority') priority?: string,
    @Query('inner_type') innerType?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<NotificationOutboxEntry[]> {
    if (user) {
      // Authenticated: return notifications for this user + broadcast rows
      // WHERE (user_id = $1 OR user_id = 'MarinadeNotifications1111111111111111111111')
      //   AND relevance_until > now()
      //   AND deactivated_at IS NULL
      //   AND (notification_type = $2 OR $2 IS NULL)
      //   AND (priority = $3 OR $3 IS NULL)
      //   AND (inner_type = $4 OR $4 IS NULL)
      // ORDER BY created_at DESC
      // LIMIT $5 OFFSET $6
    } else {
      // Unauthenticated: return all notifications (with pagination)
      // WHERE relevance_until > now()
      //   AND deactivated_at IS NULL
      //   AND (notification_type = $2 OR $2 IS NULL)
      //   AND (priority = $3 OR $3 IS NULL)
      //   AND (inner_type = $4 OR $4 IS NULL)
      // ORDER BY created_at DESC
      // LIMIT $5 OFFSET $6
    }
  }
}
```

**Auth:** Optional. Accepts EITHER:

- **Authenticated request** (Solana signature, same pattern as subscriptions) — returns notifications for the authenticated user_id (derived from signature) plus broadcast rows (sentinel `MarinadeNotifications1111111111111111111111`).
- **Unauthenticated request** — returns all notifications with pagination. No admin gate needed — notifications are not secret.

**Admin deactivation endpoint:**

```typescript
@Patch(':id/deactivate')
@UseGuards(AuthGuard) // same JWT auth as ingress — admin users in ALLOWED_USERS
async deactivateNotification(
  @Param('id') id: number,
): Promise<void> {
  // UPDATE notifications_outbox
  // SET deactivated_at = now()
  // WHERE id = $1 AND deactivated_at IS NULL
}
```

Used primarily for retracting announcements. Uses the existing JWT `AuthGuard` (same as ingress endpoints) — admin users are listed in the `ALLOWED_USERS` config. No new guard needed.

#### C.4.9 NestJS Module Wiring

```typescript
// notification-service/app.module.ts additions:
imports: [
  // ... existing imports ...
  BondsEventV1Module, // ingress controller + rate limiter
  BondsEventV1ConsumerModule, // consumer worker
  NotificationsModule, // read API + deactivation endpoint
]
```

**Ingress module** (`ingress/bonds-event-v1/module.ts`):

```typescript
@Module({
  imports: [ConfigModule, QueuesModule, AuthModule],
  controllers: [BondsEventV1Controller],
  providers: [BondsEventV1IngressService, BondsRateLimiterService, AuthGuard],
})
export class BondsEventV1Module {}
```

**Consumer module** (`consumers/bonds-event-v1/module.ts`):

```typescript
@Module({
  imports: [
    ConfigModule,
    QueuesModule,
    RdsModule,
    SubscriptionsModule,
    TelegramModule,
  ],
  providers: [BondsEventV1Consumer, ...getMetricsProviders()],
})
export class BondsEventV1ConsumerModule {}
```

**Note:** The consumer imports `SubscriptionsModule` (for routing to subscribers) and `TelegramModule` (for `TelegramDeliveryService`). This is different from the staking-rewards consumer which imports `IntercomModule` and `PartnersModule`. The bonds consumer is the first to use subscription-based routing from a consumer — verify `SubscriptionsService.getActiveSubscriptions()` works correctly in integration tests.

**Notifications module** (`notifications/module.ts`):

```typescript
@Module({
  imports: [ConfigModule, RdsModule, AuthModule, SubscriptionsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
```

**Note:** `BondsSubscriptionVerifier` already exists in marinade-notifications and is wired in `app.module.ts` (line 40). No new verifier needed — subscription auth for bonds is already functional.

#### C.4.10 Emitter Enhancement — Message Envelope ✅ Implemented

The emitter (`emit-events.ts`) now wraps events in the standard `Message<T>` envelope. Each POST includes `{ header: { producer_id: 'bonds-eventing', message_id: UUID, created_at: timestamp }, payload: BondsEventV1 }`. Existing emit-events tests updated to verify the envelope structure.

#### C.4.11 Testing (marinade-notifications)

**Unit tests:**

**`bonds-event-v1-consumer.spec.ts`:**

- Mock brain, queues, subscriptions, telegram delivery, rds
- Event evaluated as shouldNotify=false → archived with reason `brain_filtered`
- Event evaluated as shouldNotify=true, no dedup match → delivered to Telegram + outbox
- Event evaluated as shouldNotify=true, dedup match → archived with reason `dedup`
- Event with notificationId=null → dedup skipped, delivered
- Announcement with force=true → resolves ALL bonds subscribers, not just the event's userId
- Telegram not activated (no chat_id) → target skipped, warning logged
- Outbox write: verify correct fields (priority, relevance_until, message, data)
- Brain throws error → message moves to DLQ
- Retry on telegram delivery failure → schedules retry with backoff

**`bonds-event-v1-controller.spec.ts`:**

- Valid event → enqueued, returns 200 with SubmitResponse
- Invalid event (missing required fields) → 400
- Invalid event (unknown inner_type) → 400
- Rate limit exceeded → 429
- Missing/invalid JWT → 401

**`notification-routing.spec.ts`:**

- bond_underfunded_change → channels include telegram and api
- bond_balance_change → channels include only api
- announcement → channels include telegram and api, force=true
- unknown inner_type → falls back to default_channels [api]

**E2E tests (TestContainers PostgreSQL):**

**`bonds-notification-e2e.spec.ts`:**

- Full flow: POST event to ingress → consumer processes → Telegram delivery mock called → outbox written → dedup recorded
- Dedup: POST same event twice → only one delivery, second archived as dedup
- Time bucket roll: POST event, advance mock clock by 25h, POST same event → two deliveries (dedup bypassed)
- Subscription-based routing: subscribe user to telegram → post event → telegram delivered. Unsubscribe → post again → only outbox, no telegram.
- Announcement broadcast: 3 users subscribed → post announcement → all 3 receive telegram message
- Schema contract: build test events using generated `BondsEventV1` type, POST each → valid events accepted, malformed events rejected

#### C.4.12 Configuration Additions

New environment variables for `ConfigService`:

```typescript
// Bonds consumer
BONDS_CONSUMER_POLL_INTERVAL_MS // default: 1000
BONDS_CONSUMER_MAX_RETRIES // default: 6
BONDS_CONSUMER_RETRY_MINUTES // default: 1

// Notifications outbox
OUTBOX_CLEANUP_INTERVAL_HOURS // default: 24 (periodic cleanup of expired entries)
OUTBOX_RETENTION_DAYS // default: 30 (keep expired entries for N days before deleting)

// Dedup cleanup
DEDUP_CLEANUP_INTERVAL_HOURS // default: 24
DEDUP_RETENTION_DAYS // default: 30
```

---

### C.5 Implementation Order

```
Step 1: Add bonds-event-v1 schema to codegen pipeline (marinade-notifications repo)
  ├── Create message-types/schemas/bonds-event-v1.json (schema from C.3.3)
  ├── Run `pnpm generate` → auto-generates:
  │     typescript/bonds-event-v1/ (BondsEventV1 type + BondsEventV1Validator)
  │     rust/bonds_event_v1/ (Rust types + validator)
  ├── Commit generated code (framework convention: generated code is committed)
  ├── Run `pnpm check-sync` to verify no drift
  └── Run `pnpm test` to verify generated validators work
  → verify: generated BondsEventV1 type matches current bonds-eventing output

Step 2: Update bonds-eventing to use generated types + Producer
  ├── Import BondsEventV1 type from bonds-event-v1 (generated package)
  ├── Use Producer from ts-message-client for envelope + validation
  │     (keep retry logic on top — Producer doesn't retry)
  ├── Remove local BondsEventV1 type definition, hand-rolled envelope
  ├── Add cross-validation: emitter tests validate all produced events
  │     against BondsEventV1Validator from the generated package
  └── Add negative tests: malformed events rejected by validator
  → verify: existing tests still pass; emitted events pass schema validation

Step 3: Create bonds-notification package (validator-bonds repo)
  ├── types.ts: EvaluationResult, BondsNotificationBrain interface
  ├── threshold-config.ts: load embedded YAML
  ├── notification-id.ts: makeNotificationId, computeAmountBucket, computeTimeBucket
  ├── evaluate.ts: per-inner-type evaluators
  ├── content.ts: per-inner-type content builders
  ├── brain.ts: BondsNotificationBrainImpl wiring it all together
  └── Tests: evaluate, notification-id, format, brain integration
  → verify: pnpm build, pnpm test pass; brain correctly evaluates all inner_types

Step 4: Publish bonds-notification to npm (or link locally for testing)
  → verify: package installable from npm registry

Step 5: Database migration (marinade-notifications repo)
  ├── Single file: 04-bonds-event-v1.sql
  │     All Part C tables in one migration:
  │     - bonds_event_v1_inbox/archive/dlq (queue tables)
  │     - notification_dedup (shared, reusable by future topics)
  │     - notifications_outbox (shared, reusable by future topics)
  └── Test migration runs cleanly on fresh DB and on existing DB
  → verify: migration runs, tables created, indexes present

Step 6: Ingress endpoint (marinade-notifications repo)
  ├── BondsEventV1Controller + BondsEventV1IngressService + BondsEventV1Module
  ├── BondsRateLimiterService (per-producer rate limiting)
  ├── Uses BondsEventV1Validator from generated package for payload validation
  ├── Add 'bonds-event-v1' to TOPIC_TABLE_MAP in queues.service.ts (line ~101)
  ├── Register BondsEventV1Module in app.module.ts
  └── Tests: valid/invalid events, rate limiting, JWT auth
  → verify: POST /bonds-event-v1 enqueues to inbox table

Step 7: Telegram delivery service refactor (marinade-notifications repo)
  ├── Extract sendMessage from TelegramController → TelegramDeliveryService
  ├── Inject service into controller (existing) and consumer (new)
  ├── Export from TelegramModule so consumer module can import it
  └── Test: mock Telegram API, verify sendMessage called correctly
  → verify: existing Telegram tests still pass; sendMessage callable from consumer

Step 8: Consumer worker (marinade-notifications repo)
  ├── BondsEventV1Consumer + BondsEventV1ConsumerModule
  ├── Module imports: QueuesModule, RdsModule, SubscriptionsModule, TelegramModule
  │     NOTE: first consumer to use SubscriptionsService for routing — verify
  │     getActiveSubscriptions() + getTelegramChatId() in integration tests
  ├── Import @marinade.finance/bonds-notification brain
  ├── Hard-coded pipeline: evaluate → dedup → route → deliver → record
  │     (no generic plugin abstraction — follows staking-rewards pattern)
  ├── v1 delivery: content.body as plain text to Telegram, full content as JSON to outbox
  ├── Routing config YAML (notification-routing.yaml)
  ├── Register BondsEventV1ConsumerModule in app.module.ts
  ├── Cross-validation: consumer tests build test events using generated type,
  │     validate them against BondsEventV1Validator before feeding to pipeline
  └── Unit tests: all pipeline stages, routing config parsing, subscription lookup
  → verify: consumer processes events correctly in unit tests

Step 9: Notifications read API + deactivation (marinade-notifications repo)
  ├── NotificationsController + NotificationsModule
  ├── GET /notifications: query notifications_outbox with filters + deactivated_at IS NULL
  ├── PATCH /notifications/:id/deactivate: soft-delete (JWT auth, same AuthGuard as ingress)
  ├── Solana signature auth for GET (read own notifications)
  └── Tests: read with filters, auth verification, deactivation, empty results
  → verify: GET /notifications returns correct data; deactivation hides entries

Step 10: E2E tests (marinade-notifications repo)
  ├── TestContainers PostgreSQL
  ├── Full flow: ingress → consumer → delivery → outbox → read
  ├── Dedup scenarios
  ├── Subscription routing scenarios
  ├── Announcement broadcast
  ├── Cross-validation: POST events matching emitter output format,
  │     verify ingress accepts them (schema contract test)
  │     POST malformed events, verify ingress rejects them
  → verify: all E2E tests pass

Step 11: Wire up to Buildkite / deployment
  ├── Verify bonds-eventing POST to real marinade-notifications endpoint works
  ├── Configure env vars (NOTIFICATIONS_API_URL, JWT, etc.)
  └── Monitor first events flowing through the pipeline
  → verify: events visible in notifications_outbox, Telegram messages received
```

---

### C.6 Data Flow — End to End

```
Buildkite cron (hourly)
  │
  ├── bonds-collector loads on-chain data
  ├── store-bonds writes to API PostgreSQL
  │
  ▼
bonds-eventing (Part A)
  │  DsSamSDK.run() → AuctionValidator[]
  │  Load previous state from bond_event_state
  │  Compare → delta events (BondsEventV1[])
  │
  │  For each event:
  │  ┌─────────────────────────────────────────────────────┐
  │  │ POST /bonds-event-v1                                 │
  │  │ { header: { producer_id, message_id, created_at },   │
  │  │   payload: { type, inner_type, vote_account, ... } } │
  │  └──────────────────────┬──────────────────────────────┘
  │                         │
  │  Write to emitted_bond_events (sent/failed)
  │  Upsert bond_event_state
  │
  ▼
marinade-notifications (Part C)
  │
  ├── Ingress: validate → enqueue to bonds_event_v1_inbox
  │
  ├── Consumer dequeues (polling):
  │   │
  │   ├── 1. brain.evaluate(event) → { shouldNotify, priority, notificationId, ... }
  │   │      └── shouldNotify=false → archive, DONE
  │   │
  │   ├── 2. brain.extractUserId(event) → vote_account
  │   │
  │   ├── 3. Dedup: SELECT FROM notification_dedup WHERE notification_id = ?
  │   │      └── found → archive (already delivered), DONE
  │   │
  │   ├── 4. Resolve targets:
  │   │      ├── Load routing config → allowed channels for this inner_type
  │   │      ├── If force=true → query ALL bonds subscribers
  │   │      └── Else → query subscriptions for this user_id
  │   │           → intersect with allowed channels
  │   │
  │   ├── 5. Deliver:
  │   │      ├── Telegram: brain.buildContent() → formatter.format('telegram') → sendMessage(chatId, text)
  │   │      └── API: (handled by outbox write)
  │   │
  │   ├── 6. Record dedup: INSERT INTO notification_dedup
  │   │
  │   ├── 7. Write outbox: INSERT INTO notifications_outbox
  │   │
  │   └── 8. Archive message
  │
  ▼
Validator reads notifications:
  ├── Telegram: push message received in chat
  ├── CLI: GET /notifications → reads from notifications_outbox
  └── PSR Dashboard: GET /notifications → reads from notifications_outbox
```

---

### C.7 Potential Issues & Mitigations

#### C.7.1 Consumer Crash Between Delivery and Dedup Write

**Risk:** Consumer delivers Telegram message, crashes before writing to `notification_dedup`. Next run re-delivers → duplicate message. Also: concurrent consumers could both pass a check-then-act dedup and deliver the same notification twice.

**Mitigation:** The dedup flow uses an optimistic reservation pattern: before delivery, the consumer INSERTs into `notification_dedup` with `ON CONFLICT DO NOTHING` and checks affected rows. If 0 rows → already reserved by another consumer → skip. If 1 row → reservation acquired → proceed with delivery. On delivery failure, the reservation is released (`DELETE`). This prevents concurrent duplicate delivery. If the consumer crashes after reservation but before delivery, the reservation remains — no message is sent, and re-processing will skip (acceptable: better to miss than duplicate in this edge case, and the next time bucket will re-notify). Telegram messages are naturally idempotent to the user (they see the same message twice, not a conflicting one).

#### C.7.2 ~~Deficit SOL Not in Emitter Output~~ ✅ RESOLVED

The emitter now includes `deficit_sol`, `required_sol`, `epoch_cost_sol`, and `expected_max_eff_bid_pmpe` in `bond_underfunded_change` and `first_seen` event details. Computation uses `revShare.expectedMaxEffBidPmpe` and `revShare.onchainDistributedPmpe` from the SDK's `AuctionValidator`. The brain can use `deficit_sol` directly for threshold evaluation.

#### C.7.3 ~~Amount Bucket Boundary Oscillation~~ ✅ RESOLVED

The emitter now rounds `bondGoodForNEpochs` to 2 decimal places before comparison and state storage, eliminating float jitter. Combined with 20% bucket width (`significant_change_pct: 20`), boundary oscillation is effectively eliminated. The emitter runs hourly, so a deficit would need to swing by >20% between runs to cross a boundary — unlikely for normal bond operations.

#### C.7.4 First-Run Event Burst

**Risk:** When `bond_event_state` is empty, the emitter produces ~1000 `first_seen` events. All are POSTed to the ingress, queued, and processed.

**Mitigation:** `first_seen` events are info-level, routed to API channel only (no Telegram). The consumer processes them normally — they just populate the outbox. The ingress rate limit (200/min) may throttle the burst, causing retries in the emitter. The emitter's retry logic handles this gracefully (it logs warnings and continues).

#### C.7.5 Announcements Without vote_account

**Risk:** Admin posts a system-wide announcement — what vote_account to use? The schema requires `vote_account`.

**Mitigation:** Use the sentinel pubkey `MarinadeNotifications1111111111111111111111` (41 chars, passes the schema's minLength:32/maxLength:44 validation). The `force: true` routing ignores the userId for target resolution anyway. The vote_account field is still required by schema but its value doesn't affect delivery for announcements. The same sentinel is used as `user_id` in the outbox for broadcast rows (see C.4.4 writeOutbox).

#### C.7.6 Dedup Table Growth

**Risk:** Dedup table grows unboundedly as notification_ids accumulate.

**Mitigation:** Periodic cleanup: `DELETE FROM notification_dedup WHERE delivered_at < now() - interval '${DEDUP_RETENTION_DAYS} days'`. Run as a scheduled task (cron job or NestJS scheduled task). 30-day retention is generous — no re-notification interval exceeds 24h, so entries older than a few days will never be checked.

#### C.7.7 Telegram API Rate Limits

**Risk:** Telegram Bot API has rate limits (~30 messages/second per bot, 1 message/second per chat).

**Mitigation:** For v1, with ~100 active bonds subscribers, rate limits are unlikely to be hit. If they become an issue: add a per-chat rate limiter in `TelegramDeliveryService` with exponential backoff on 429 responses. The consumer's retry mechanism already handles transient delivery failures.

---

### C.8 Open Items

1. ~~**`deficit_sol` in emitter output**~~ — ✅ RESOLVED. Emitter now includes `deficit_sol`, `required_sol`, `epoch_cost_sol`, `expected_max_eff_bid_pmpe` in event details.

2. ~~**Telegram message format**~~ — ✅ DECIDED. v1 uses plain text (no `parse_mode`). When rich formatting is needed, introduce a `NotificationFormatter` service and switch to `parse_mode: 'HTML'`. The `NotificationContent` interface already carries all data needed for rich formatting (title, body, dataPoints).

3. **Notifications API URL and JWT for production** — Same as Part A open item. Needed for both the emitter POST and the CLI notifications read.

4. ~~**bonds-event-testing publication workflow**~~ — ✅ RESOLVED. `bonds-event-testing` package dropped. Types and validators come from the auto-generated `bonds-event-v1` package in the marinade-notifications codegen pipeline. Each repo keeps its own test factories locally. Cross-validation is done by importing the generated `BondsEventV1Validator` in both repos' test suites.

5. **Dedup + outbox cleanup job** — Where to run periodic cleanup? Options: NestJS `@Cron` decorator, Buildkite scheduled pipeline, or PostgreSQL `pg_cron`. Recommend NestJS cron (keeps it in the application).

6. ~~**API channel "always on"**~~ — ✅ DECIDED. All events go to the outbox regardless of subscription. Every validator with bond events has entries in the outbox, queryable via the dashboard (aggregated view) and CLI (individual view). The dashboard shows data to all validators even without explicit subscription.

7. ~~**SUMMARY.md routing config vs implementation**~~ — ✅ RESOLVED. SUMMARY.md updated to use delta-based inner_types.

8. ~~**Codegen pipeline integration**~~ — ✅ DECIDED. The `BondsEventV1` schema goes through the marinade-notifications codegen pipeline (`message-types/schemas/bonds-event-v1.json` → `pnpm generate`). Auto-generates TypeScript package (types + Ajv validator) and Rust crate. The emitter uses `Producer` from `ts-message-client` for envelope wrapping and pre-send validation. No separate `bonds-event-testing` package — both repos import directly from the generated `bonds-event-v1` package and cross-validate in their test suites.

9. ~~**Float equality / amount bucket jitter (OQ3)**~~ — ✅ RESOLVED. The emitter now rounds `bondGoodForNEpochs` to 2 decimal places before comparison and state storage, eliminating float jitter. See C.7.3.

10. ~~**`bond_pubkey` derivation (OQ2)**~~ — ✅ RESOLVED. `bond_pubkey` is now derived from `(config_address, vote_account)` using `bondAddress()` from `@marinade.finance/validator-bonds-sdk`. The config address is resolved from `bondType` using `MARINADE_CONFIG_ADDRESS` (bidding) or `MARINADE_INSTITUTIONAL_CONFIG_ADDRESS` (institutional) constants. No SDK change was needed. The `bond_pubkey` field is always populated in all events.

---

## Part D: Subscription Infrastructure (marinade-notifications repo)

### D.1 Subscription API (Server Side) ✅

**Location:** `marinade-notifications/notification-service/subscriptions/`

Implements the subscription management API with Solana off-chain message signature verification:

**Files implemented:**

| File                                  | Purpose                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `subscriptions.controller.ts`         | POST/DELETE/GET `/subscriptions` endpoints + Telegram webhook      |
| `subscriptions.service.ts`            | DB operations (subscribe, unsubscribe, list, telegram activation)  |
| `subscriptions.module.ts`             | NestJS module wiring                                               |
| `bonds-subscription-verifier.ts`      | Verifies signer is bond authority or validator identity (on-chain) |
| `subscription-verifier.interface.ts`  | `SubscriptionVerifier` interface                                   |
| `solana-auth.ts`                      | Solana off-chain message signature verification                    |
| `constants.ts`                        | Shared constants                                                   |
| `telegram/telegram.controller.ts`     | Telegram bot webhook handler (`/start`, kicked events)             |
| `telegram/telegram.module.ts`         | NestJS module for telegram                                         |
| `migrations/03-subscriptions.sql`     | Schema: subscriptions + telegram_activations tables                |
| `__tests__/subscriptions.e2e.ts`      | E2E tests for subscribe/unsubscribe/list flows                     |
| `__tests__/bonds-verifier.e2e.ts`     | E2E tests for bonds subscription verifier                          |
| `bonds-subscription-verifier.spec.ts` | Unit tests for bonds verifier                                      |

**Key design:**

- Bond verification: loads bond account on-chain, checks if signer is `bond.authority` or `vote_account.node_pubkey`
- Subscriptions keyed by `(user_id, notification_type, channel, channel_address)` where `user_id = vote_account`
- Telegram deep link flow: subscribe → generate token → return deep link URL → user clicks → bot receives `/start <token>` → saves `chat_id`
- Solana off-chain message signing with application domain = validator-bonds program ID

### D.2 Subscription SDK (`ts-subscription-client`) ✅

**Location:** `marinade-notifications/ts-subscription-client/`

Reusable SDK package extracting HTTP subscription logic for consumption by CLI and other clients.

**Files implemented:**

| File                        | Purpose                                                 |
| --------------------------- | ------------------------------------------------------- |
| `client.ts`                 | `SubscriptionClient` class (subscribe/unsubscribe/list) |
| `types.ts`                  | Request/response types + `NetworkError` class           |
| `message.ts`                | Message format helpers (`subscribeMessage`, etc.)       |
| `index.ts`                  | Public exports + `createSubscriptionClient()`           |
| `__tests__/client.test.ts`  | Unit tests (mocked fetch)                               |
| `__tests__/client.e2e.ts`   | E2E tests (mock HTTP server)                            |
| `__tests__/message.test.ts` | Message format tests                                    |

**SDK API:**

```typescript
const client = createSubscriptionClient({ base_url: 'https://...' })

// Subscribe
const result = await client.subscribe({
  pubkey,
  notification_type,
  channel,
  channel_address,
  signature,
  message,
  additional_data,
})

// Unsubscribe
const result = await client.unsubscribe({
  pubkey,
  notification_type,
  channel,
  channel_address,
  signature,
  message,
})

// List
const subs = await client.listSubscriptions(
  { pubkey, notification_type },
  { signature, message },
)
```

**Message helpers:**

```typescript
subscribeMessage('bonds', 'telegram', timestampSeconds)
// → 'Subscribe bonds telegram 1710000000'

unsubscribeMessage('bonds', 'email', timestampSeconds)
// → 'Unsubscribe bonds email 1710000000'

listSubscriptionsMessage('GrxB8U...', timestampSeconds)
// → 'ListSubscriptions GrxB8U... 1710000000'
```

No external dependencies — uses native `fetch`. Published as `@marinade.finance/ts-subscription-client`. Registered in `pnpm-workspace.yaml`.

### D.3 CLI Refactor to Use SDK ✅

CLI commands in `validator-bonds-cli-core` now use `ts-subscription-client` SDK instead of raw `fetch` calls.

**What was changed:**

| CLI file           | Uses                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `subscribe.ts`     | `createSubscriptionClient()` + `client.subscribe()` + `subscribeMessage()`                 |
| `unsubscribe.ts`   | `createSubscriptionClient()` + `client.unsubscribe()` + `unsubscribeMessage()`             |
| `subscriptions.ts` | `createSubscriptionClient()` + `client.listSubscriptions()` + `listSubscriptionsMessage()` |

**What stays in CLI:** Bond resolution, wallet/Ledger signing, Commander options, logging, `additional_data` construction, `CliCommandError` wrapping.

**Error handling:** Catches `NetworkError` from SDK, wraps into `CliCommandError` for CLI-friendly messages.

**Dependency:** `@marinade.finance/ts-subscription-client` added as devDependency via local file path (`file:/home/chalda/marinade/marinade-notifications/ts-subscription-client`) and as peerDependency (`^1.0.1`).

---

## Part E: Subscription Table Redesign (marinade-notifications repo) ✅

### E.1 Goal

Replace the append-only `subscriptions` table with two tables: `subscriptions` (mutable active state) and `subscriptions_log` (immutable audit trail). **✅ Implemented** — the migration and service code use this design.

**Design:**

- **Reads** (hot path — notification delivery, list): Direct lookup on `subscriptions`, no `DISTINCT ON`
- **Writes**: INSERT/UPDATE on `subscriptions` + INSERT on `subscriptions_log` in application code
- **Replay protection**: Preserved via unique index on `subscriptions_log.message_ts`

### E.2 Migration: Replace `03-subscriptions.sql`

```sql
-- Active state: one mutable row per subscription key.
CREATE TABLE subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    channel_address TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'self-service',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, notification_type, channel, channel_address)
);

CREATE INDEX idx_sub_user_type
ON subscriptions(user_id, notification_type);

-- Immutable audit log. Every subscribe/unsubscribe produces a row.
CREATE TABLE subscriptions_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    channel_address TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'self-service',
    action TEXT NOT NULL,  -- 'subscribe' or 'unsubscribe'
    message_ts BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Replay protection: same signed message cannot be applied twice.
CREATE UNIQUE INDEX idx_log_replay
ON subscriptions_log(user_id, notification_type, channel,
                     channel_address, message_ts)
WHERE message_ts IS NOT NULL;

CREATE INDEX idx_log_user_type
ON subscriptions_log(user_id, notification_type);

-- Telegram activation tokens.
-- UNIQUE constraint on (user_id, notification_type, channel_address)
-- prevents stale token accumulation.
CREATE TABLE telegram_activations (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    channel_address TEXT NOT NULL,
    chat_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    UNIQUE (user_id, notification_type, channel_address)
);

CREATE INDEX idx_tg_chat_id
ON telegram_activations(chat_id)
WHERE chat_id IS NOT NULL;
```

### E.3 Service Changes (`subscriptions.service.ts`)

**subscribe():** Transaction wrapping log insert (replay check) + active table upsert. Replay returns 409 via `null` return. Re-subscribe after unsubscribe re-inserts the active row.

**unsubscribe():** Single CTE: find active rows → insert log entries (with replay protection) → delete only successfully logged rows.

**getActiveSubscriptions():** Direct SELECT from `subscriptions` — no CTE, no `DISTINCT ON`. Every row is active.

**unsubscribeByTelegramChatId():** Single CTE: join `telegram_activations` to find active subscriptions for the chat → log → delete.

**createTelegramActivation():** UPSERT pattern — at most one row per `(user_id, notification_type, channel_address)`. Resubscribe with pending token replaces old token (invalidating stale deep link). Resubscribe after activation returns existing `chatId`.

### E.4 Atomicity

- **subscribe:** Two statements in slonik `pool.transaction()`. Log failure rolls back, preserving replay correctness.
- **unsubscribe:** Single atomic CTE statement.
- **unsubscribeByTelegramChatId:** Single atomic CTE statement.

### E.5 Telegram Bot Verification Retry

Replace startup-only `verifyTelegramBot()` probe with lazy verification that retries on the subscribe hot path. Once verified, stays verified. On failure, retries at most once per 60s. Self-healing for transient boot failures.

### E.6 Test Changes

- Update `cleanDatabase` TRUNCATE to include `subscriptions_log`
- Existing E2E tests should pass unchanged (same HTTP API semantics)
- Add Telegram E2E tests: activation happy path, stale token rejection, kicked unsubscribe, kicked with no active sub

### E.7 Files Changed Summary

| File                                        | Change                                                  |
| ------------------------------------------- | ------------------------------------------------------- |
| `migrations/03-subscriptions.sql`           | **REWRITE** — new schema with two tables + telegram fix |
| `subscriptions/subscriptions.service.ts`    | Rewrite query methods + fix `createTelegramActivation`  |
| `subscriptions/subscriptions.controller.ts` | Lazy telegram bot verification with retry               |
| `__tests__/db-utils.ts`                     | Update TRUNCATE to include `subscriptions_log`          |
| `__tests__/telegram.e2e.ts`                 | **NEW** — Telegram activation/webhook E2E tests         |

### E.8 Implementation Order ✅

All steps completed:

1. ✅ Rewrite migration `03-subscriptions.sql`
2. ✅ Update `subscriptions.service.ts` (all query methods + `createTelegramActivation` fix)
3. ✅ Update `subscriptions.controller.ts` (lazy bot verification)
4. ✅ Update `db-utils.ts` (TRUNCATE list — includes `subscriptions_log`)
5. ✅ E2E tests pass
6. ✅ Replay protection verified
7. ✅ Subscribe-unsubscribe-resubscribe cycle verified
8. ✅ Telegram E2E tests added
9. ✅ Full test suite passing

---

## Part G: DsSamSDK Production Config ❌ Not Yet

### G.1 Purpose

The eventing module currently constructs `DsSamSDK` with API URL overrides only. For correct auction simulation, it needs the full production auction config (constraints, caps, thresholds, etc.).

### G.2 Implementation

The SDK already provides `loadSamConfig()` which fetches from `https://thru.marinade.finance/marinade-finance/ds-sam-pipeline/main/auction-config.json`. The change is in `packages/bonds-eventing/src/run-auction.ts`:

```typescript
import { DsSamSDK, loadSamConfig } from '@marinade.finance/ds-sam-sdk'

export async function runAuction(config: EventingConfig, logger: Logger) {
  // Load production auction config (constraints, caps, etc.)
  const samConfig = await loadSamConfig()

  // Override API URLs from CLI options
  const sdkConfig = {
    ...samConfig,
    bondsApiBaseUrl: config.bondsApiUrl,
    validatorsApiBaseUrl: config.validatorsApiUrl,
    scoringApiBaseUrl: config.scoringApiUrl,
    tvlInfoApiBaseUrl: config.tvlApiUrl,
  }

  if (config.cacheInputs) {
    sdkConfig.inputsSource = InputsSource.APIS
    sdkConfig.cacheInputs = true
    sdkConfig.inputsCacheDirPath = config.cacheInputs
  }

  const sdk = new DsSamSDK(sdkConfig)
  return sdk.run()
}
```

### G.3 Verify

- `loadSamConfig()` fetches from the correct URL (same config ds-sam-pipeline uses in production)
- CLI API URL overrides still take precedence
- `--cache-inputs` still works for debugging

---

## Part H: Telegram Delivery Telemetry ❌ Not Yet

### H.1 Purpose

Add Prometheus metrics to `TelegramBotClient` in marinade-notifications for monitoring delivery health. Currently the client has APM spans (`@CaptureSpan`) and retry logic (`@Retry`) but no Prometheus counters/histograms.

### H.2 Scope (from MUST_HAVE_FUTURE.md)

**Required:**

- Counter by POST /send response status (success, failure, error)
- Histogram for POST /send response time
- Logging of all failed sends with subscription context

**Nice to have:**

- Periodic reconciliation (detect drift between marinade-notifications and telegram-bot subscription state)
- Dead letter handling for repeatedly failing deliveries

### H.3 Implementation Plan

**File 1: `notification-service/telemetry/metrics.config.ts`** — Add metrics:

```typescript
export const PROVIDER_NAME_TELEGRAM_API_CALLS = 'telegram_api_calls_total'
export const PROVIDER_NAME_TELEGRAM_API_DURATION = 'telegram_api_duration_seconds'

// In getMetricsProviders():
makeCounterProvider({
  name: PROVIDER_NAME_TELEGRAM_API_CALLS,
  help: 'Telegram bot API calls by status',
  labelNames: ['status'],  // 'success' | 'failure' | 'error'
}),
makeHistogramProvider({
  name: PROVIDER_NAME_TELEGRAM_API_DURATION,
  help: 'Telegram bot API call duration in seconds',
  labelNames: ['status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
}),
```

**File 2: `notification-service/subscriptions/telegram-bot-client.ts`** — Inject and track:

```typescript
constructor(
  private readonly logger: PinoLogger,
  private readonly config: ConfigService,
  @InjectMetric(PROVIDER_NAME_TELEGRAM_API_CALLS)
  private readonly apiCallsCounter: Counter<string>,
  @InjectMetric(PROVIDER_NAME_TELEGRAM_API_DURATION)
  private readonly apiDurationHistogram: Histogram<string>,
) {}

async send(params: { ... }): Promise<SendResult> {
  const startTime = Date.now()
  try {
    // ... existing fetch logic ...
    const durationSec = (Date.now() - startTime) / 1000
    const status = response.ok ? 'success' : 'failure'
    this.apiCallsCounter.inc({ status })
    this.apiDurationHistogram.observe({ status }, durationSec)

    if (!response.ok) {
      this.logger.warn({
        msg: 'telegram send failed',
        feature: params.feature,
        externalId: params.externalId,
        httpStatus: response.status,
      })
    }
    return result
  } catch (error) {
    const durationSec = (Date.now() - startTime) / 1000
    this.apiCallsCounter.inc({ status: 'error' })
    this.apiDurationHistogram.observe({ status: 'error' }, durationSec)
    throw error
  }
}
```

**File 3: `notification-service/subscriptions/subscriptions.module.ts`** — Add metric providers to the module's `providers` array.

### H.4 Verify

- `GET /metrics` exposes `telegram_api_calls_total` and `telegram_api_duration_seconds`
- Grafana/Prometheus can alert on `rate(telegram_api_calls_total{status="error"}[5m]) > threshold`
- Failed sends are logged with subscription context for debugging

---

## Part I: PSR Dashboard Integration ❌ Not Yet

### I.1 Purpose

The PSR dashboard (`/home/chalda/marinade/psr-dashboard`) currently has a hardcoded banner system (`src/services/banner.tsx`). It should poll the `GET /notifications` API to show bond-specific notifications per validator row.

### I.2 Auth — RESOLVED

`GET /notifications` is a **public endpoint** (no auth). Notification data is derived from on-chain state and is not sensitive. Only subscription management requires Solana signature auth. The PSR dashboard can query directly for any vote_account.

### I.3 Implementation Plan

**Approach:** For each validator row in the SAM dashboard, fetch notifications and show icons (or a column) indicating active notifications.

**File 1: `src/services/notifications.ts`** — Fetch service:

```typescript
export async function fetchNotifications(
  voteAccount: string,
  notificationsApiUrl: string,
): Promise<Notification[]> {
  const url = new URL('/notifications', notificationsApiUrl)
  url.searchParams.set('user_id', voteAccount)
  url.searchParams.set('notification_type', 'sam_auction')
  url.searchParams.set('limit', '10')
  const res = await fetch(url.toString())
  if (!res.ok) return []
  return res.json()
}
```

**File 2: `src/services/banner.tsx`** — Replace hardcoded `getBannerData()` with dynamic fetch from notifications API.

**File 3: `src/pages/sam.tsx`** — Wire notifications into the SAM dashboard page. Show notification icons alongside each validator row (e.g., warning/critical indicators).

### I.4 Verify

- SAM dashboard shows bond notifications per validator
- Critical notifications display prominently (red icon)
- Notifications disappear after `relevance_until` expires
- Hardcoded banner can be removed

---

## Part J: NotificationFormatter (Rich Telegram) — Deferred (not v1)

The brain returns `NotificationContent` with `title`, `body`, and `dataPoints`. v1 sends `body` as plain text to Telegram. A future `NotificationFormatter` service in marinade-notifications would add:

- Priority emojis (🔴 critical, 🟡 warning, ℹ️ info)
- HTML formatting (`<b>title</b>`, data points as bullet list)
- `parse_mode: 'HTML'` on the telegram-bot `/send` call

This is cosmetic and not required for v1 functionality.

---

## Part K: marinade-notifications SPEC.md & ARCHITECTURE.md Updates ✅

Brief summaries to add to the marinade-notifications documentation:

### ARCHITECTURE.md — Add section "Bonds Notification Channel"

> **Bonds Notification (bonds-event-v1)**
>
> Validator bond risk events flow through: bonds-eventing (emitter in validator-bonds repo) → POST /bonds-event-v1 → inbox queue → BondsEventV1Consumer → bonds-notification brain (evaluate/dedup/content) → delivery channels (Telegram via telegram-bot POST /send, API via notifications_outbox).
>
> The brain library (`@marinade.finance/bonds-notification`) is external — linked from the validator-bonds repo. It provides threshold evaluation, priority assignment, deterministic notification_id generation, and structured content building. The consumer is a hard-coded pipeline (not generic plugin).
>
> Subscriptions use Solana off-chain message signing for auth. The SAM auction verifier resolves bond authority → vote_account for userId mapping.

### SPEC.md — Add to "Adding New Topics" section

> **bonds-event-v1** — Schema: `message-types/schemas/bonds-event-v1.json`. 9 inner_types (delta-based: first_seen, bond_removed, auction_entered, auction_exited, cap_changed, bond_underfunded_change, bond_balance_change, announcement, version_bump). Generated package: `bonds-event-v1` (types + Ajv validator). Consumer uses external brain library for evaluation.

### README.md — Add to "Modules" section

> - `ts-subscription-client/` — TypeScript client for subscription and notification APIs (subscribe, unsubscribe, listSubscriptions, listNotifications)
