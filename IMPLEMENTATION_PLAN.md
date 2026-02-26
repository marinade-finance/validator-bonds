# Implementation Plan — Eventing Module & CLI Subscribe

This document covers the two pieces of work scoped to the **validator-bonds** repository:

- **Part A: Eventing Module** (`packages/bonds-eventing/`)
- **Part B: CLI Subscribe Commands** (`packages/validator-bonds-cli-core/`)

Both live in this repo. The marinade-notifications side (consumer, subscription API, etc.) is out of scope here — we build against the **planned contract** (event schema, subscription API shape). Where the contract is not yet finalized, we note it and design for easy iteration.

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

## Part A: Eventing Module

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

### A.5 Package Structure

```
packages/bonds-eventing/
  package.json
  tsconfig.json
  jest.config.ts
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
    run-auction.spec.ts
    evaluate-deltas.spec.ts
    state.spec.ts
    emit-events.spec.ts
    persist-events.spec.ts
    integration.spec.ts         — Full flow with all externals mocked
```

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

**NOTE:** The schema is provisional. It will be refined as we implement both sides. The `bonds-event-testing` package is the contract enforcement mechanism — when the schema changes, both sides run tests against shared fixtures.

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

### A.9 `/bonds-event-v1` Endpoint Not Yet Implemented

The marinade-notifications `/bonds-event-v1` POST endpoint does not exist yet. That's fine for this phase:

- The eventing module will attempt to POST and the request will fail (404 or connection refused)
- The retry logic kicks in (configurable attempts, exponential backoff)
- After retry exhaustion, the event is logged as `status: failed` in `emitted_bond_events`
- The Buildkite step does NOT fail — it logs a warning and continues
- When the endpoint is implemented later, the events will start flowing through

This means we can develop and deploy the eventing module independently. It will produce a useful event log in the DB even before the notification pipeline is ready.

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

### A.11 Buildkite Pipeline Update

Add a new step to `.buildkite/collect-bonds.yml` after "Store Bonds" and before "Concurrency gate unlock":

```yaml
- label: ':bell: Emit Bond Events'
  key: 'emit-bond-events'
  commands:
    - |
      claim_type=${CLAIM_TYPE:-$(buildkite-agent meta-data get claim_type)}
      if [ "$claim_type" = "bid" ]; then bond_type="bidding"; else bond_type="institutional"; fi
      echo "--- Emitting bond events for $bond_type"
    - |
      npx ts-node packages/bonds-eventing/src/index.ts \
        --bond-type "$bond_type"
  env:
    NOTIFICATIONS_API_URL: '$$NOTIFICATIONS_API_URL'
    NOTIFICATIONS_JWT: '$$NOTIFICATIONS_JWT'
    POSTGRES_URL: '$$POSTGRES_URL'
    POSTGRES_SSL_ROOT_CERT: './eu-west-1-bundle.pem'
  plugins:
    - artifacts#v1.9.4:
        download:
          - eu-west-1-bundle.pem
  soft_fail:
    - exit_status: '*' # Never fail the pipeline; events are best-effort
```

Key decisions:

- `soft_fail` — the pipeline must not fail due to eventing issues (the collector + store are the critical path)
- Runs after store-bonds so the bonds API has fresh data
- Uses the same `POSTGRES_URL` and SSL cert as store-bonds
- API URLs use SDK defaults in prod; overridable via env vars or CLI args for testing

### A.12 Testing

**Framework:** Jest (matches the rest of the TS packages in this repo). Add `jest.config.ts` to the package.

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

#### `subscribe` command

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

#### `unsubscribe` command

```
validator-bonds unsubscribe <bond-or-vote> --type <telegram|email>
```

Same signing flow as subscribe, but with `"Unsubscribe bonds <type> <timestamp>"` message text. Calls `DELETE /subscriptions`. No `--address` needed — unsubscribes from the given type entirely.

#### `show-notifications` command

```
validator-bonds show-notifications <bond-or-vote> [--priority <critical|warning|info>] [--limit <n>]
```

| Option                            | Description                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `<bond-or-vote>`                  | Bond or vote account address                                                                           |
| `--priority`                      | Filter by priority level                                                                               |
| `--limit`                         | Max notifications to show (default: 10)                                                                |
| `--format`                        | Output format: `text` (default), `yaml`, `json` — uses `printData` from `@marinade.finance/cli-common` |
| `--notifications-api-url`         | Override URL. Env: `NOTIFICATIONS_API_URL`. Hidden.                                                    |
| `--authority <keypair-or-ledger>` | Keypair for authenticated request                                                                      |

**Flow:**

1. Resolve vote account from bond-or-vote
2. Build and sign an auth message (same pattern): `"ListSubscriptions <pubkey> <timestamp>"`
3. GET `{notifications-api-url}/subscriptions?pubkey={pubkey}` with `x-solana-signature` and `x-solana-message` headers
4. Display notifications using `printData` for the selected format

**Authentication:** The endpoint requires Solana signature auth to prevent enumeration of validator Telegram handles and notification contents. The auth pattern is the same as subscribe — sign a message, send signature + pubkey in the request.

### B.5 File Structure

```
packages/validator-bonds-cli-core/src/
  commands/manage/
    subscribe.ts                           — NEW: configureSubscribe() + manageSubscribe()
    unsubscribe.ts                         — NEW: configureUnsubscribe() + manageUnsubscribe()
  commands/
    showNotifications.ts                   — NEW: configureShowNotifications() + showNotifications()
```

No `signMessage.ts` is needed in cli-core — signing is handled by `@marinade.finance/ledger-utils` which provides both `LedgerWallet.signOffchainMessage()` and standalone `signOffchainMessage()` for keypairs.

The commands are defined in cli-core as `configure*()` + `manage*()`/`show*()` functions (matching the existing pattern). Each downstream CLI wires them in via `installSubcommands()`.

### B.6 Integration with Downstream CLIs

Both `validator-bonds-cli` and `validator-bonds-cli-institutional` register the new commands in their `installSubcommands()`:

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

The event schema (`bonds-event-v1`) and subscription API contract are not finalized. Our approach:

1. **Start with local types** — define `BondsEventV1` and subscription request/response types locally in this repo
2. **Build and test against those types** — all tests validate against local type definitions
3. **When marinade-notifications implements the endpoints** — align the types, create the shared `bonds-event-testing` package with fixtures
4. **Iterate** — as the schema evolves during implementation, update types on both sides and use the test fixtures as the compatibility check

The eventing module is designed to be resilient to the notification service not being ready (retry → fail → log). The CLI subscribe commands will need the subscription API to exist, but can be developed and unit-tested against a mock server first.

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

Step 9: Implement subscribe command + tests
  ├── configureSubscribe (cli-core), manageSubscribe
  ├── Signing via @marinade.finance/ledger-utils (both Ledger and keypair paths)
  ├── Unit tests with mocked API (TestHttpServer)
  └── Integration test: real bond on-chain + mock subscription server
  → verify: correct POST body, valid off-chain message signature, bond resolution works

Step 10: Implement unsubscribe command + tests
  ├── configureUnsubscribe, manageUnsubscribe
  └── Tests (same pattern as subscribe, DELETE method)
  → verify: correct request with unsubscribe message

Step 11: Implement show-notifications command + tests
  ├── configureShowNotifications, showNotifications
  ├── Auth headers with signed off-chain message
  └── Tests with TestHttpServer: various response shapes, output formats
  → verify: correct GET params, auth headers, printData output

Step 12: Wire commands into downstream CLIs
  ├── validator-bonds-cli: installSubscribe, installUnsubscribe, installShowNotifications
  └── validator-bonds-cli-institutional: same
  → verify: commands appear in --help, basic smoke test
```

---

## Open Items (to resolve during implementation)

1. **Notifications API URL in production** — what URL will marinade-notifications be at? Needed for Buildkite env var and CLI default.

2. **JWT for notifications POST** — how is the JWT obtained? Is it a static service token or dynamic? Needed for the emit-events.ts auth header.

3. **Telegram deep link flow details** — the subscribe response for Telegram may return a deep link URL. Exact response shape TBD based on marinade-notifications implementation.

4. **`DsSamSDK` production config** — the SDK has a `loadSamConfig()` that fetches the production auction config from GitHub. We need to verify this is the right config to use or if we should pass a custom one.

5. **marinade-notifications SPEC.md & ARCHITECTURE.md** — After implementing the subscription endpoint changes and bonds-event-v1 consumer, revisit and update `SPEC.md` and `ARCHITECTURE.md` in the marinade-notifications repo to reflect the new subscription auth model (Solana off-chain message signing), the bonds notification plugin, and the bonds-event-v1 topic.

## Resolved Items

- **~~Ledger off-chain signing~~** — Resolved. `@marinade.finance/ledger-utils@^3.2.0` provides `LedgerWallet.signOffchainMessage()` and standalone `signOffchainMessage()` for keypairs, both using Solana off-chain message standard via `@solana/offchain-messages`.

- **~~Unsubscribe HTTP method~~** — Resolved. `DELETE /subscriptions` (confirmed from marinade-notifications subscription controller implementation).

- **~~Stateless vs delta-based design~~** — Resolved. Delta-based with `bond_event_state` snapshot table. Events report changes, not persistent conditions.
