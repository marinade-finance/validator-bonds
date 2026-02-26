# Implementation Plan — Eventing Module & CLI Subscribe

This document covers the two pieces of work scoped to the **validator-bonds** repository:

- **Part A: Eventing Module** (`packages/bonds-eventing/`)
- **Part B: CLI Subscribe Commands** (`packages/validator-bonds-cli-core/`)

Both live in this repo. The marinade-notifications side (consumer, subscription API, etc.) is out of scope here — we build against the **planned contract** (event schema, subscription API shape). Where the contract is not yet finalized, we note it and design for easy iteration.

---

## Part A: Eventing Module

### A.1 Purpose

A new TypeScript package `packages/bonds-eventing/` that runs as a Buildkite step after `store-bonds` in `collect-bonds.yml`. It:

1. Reads current bond state from the validator-bonds API
2. Fetches auction/validator data from external APIs
3. Runs ds-sam-sdk auction simulation to compute `bondGoodForNEpochs` and auction status per validator
4. For each condition met (underfunded, out of auction, stake capped), constructs a raw event
5. POSTs each event to `marinade-notifications /bonds-event-v1` endpoint (with retry)
6. Writes each emitted event to `emitted_bond_events` table in validator-bonds-api PostgreSQL

### A.2 Bonds-collector: No Change Needed

After reviewing the bonds-collector pipeline:

- The collector reads on-chain data → writes YAML → `store-bonds` upserts to DB with `ON CONFLICT (pubkey, epoch) DO UPDATE`
- The eventing module reads the **current snapshot** from the API (latest epoch) and evaluates conditions, not deltas
- All "has this already been notified?" logic is in the consumer side (dedup via `notification_id` in marinade-notifications)
- The upsert pattern is fine — we don't need an append-only changelog for the bonds table

**Why no change:** The eventing module is condition-based, not delta-based. It asks "is this bond underfunded right now?" — not "did the bond balance just change?". If the same condition persists across hourly runs, the same raw event is emitted and the consumer deduplicates it. If in the future we want delta-based events (e.g., "balance dropped by X"), we can compare current state with previous-epoch data that already exists in the `bonds` table (different epoch key).

### A.3 Package Structure

```
packages/bonds-eventing/
  package.json
  tsconfig.json
  src/
    index.ts                    — CLI entry point (ts-node script)
    config.ts                   — Configuration (env vars, defaults)
    fetch-data.ts               — Fetch bond data from bonds API, validator data from validators-api,
                                  scoring data from scoring API
    simulate-auction.ts         — Run ds-sam-sdk auction simulation, compute bondGoodForNEpochs
    evaluate-conditions.ts      — Check conditions per bond, generate raw events
    emit-events.ts              — POST events to marinade-notifications with retry
    persist-events.ts           — Write emitted events to emitted_bond_events table
    types.ts                    — Local type definitions (BondsEventV1 etc.)
  __tests__/
    fetch-data.spec.ts
    simulate-auction.spec.ts
    evaluate-conditions.spec.ts
    emit-events.spec.ts
    persist-events.spec.ts
    integration.spec.ts         — Full flow with all externals mocked
```

### A.4 Configuration (`config.ts`)

All via environment variables (injected by Buildkite):

| Env var                  | Description                                               | Default                                        |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------------- |
| `BONDS_API_URL`          | validator-bonds API base URL                              | `https://validator-bonds-api.marinade.finance` |
| `VALIDATORS_API_URL`     | validators API base URL                                   | `https://validators-api.marinade.finance`      |
| `SCORING_API_URL`        | scoring API base URL                                      | `https://scoring.marinade.finance`             |
| `NOTIFICATIONS_API_URL`  | marinade-notifications base URL                           | (required)                                     |
| `NOTIFICATIONS_JWT`      | JWT for authenticating to marinade-notifications          | (required)                                     |
| `POSTGRES_URL`           | PostgreSQL connection string (same DB as bonds-collector) | (required)                                     |
| `POSTGRES_SSL_ROOT_CERT` | Path to AWS RDS SSL cert                                  | (optional)                                     |
| `BOND_TYPE`              | `bidding` or `institutional`                              | (required, from pipeline)                      |
| `RETRY_MAX_ATTEMPTS`     | Max retries for notification POST                         | `4`                                            |
| `RETRY_BASE_DELAY_MS`    | Base delay for exponential backoff                        | `30000`                                        |
| `DRY_RUN`                | If `true`, skip POST and DB write, just log events        | `false`                                        |

### A.5 Data Flow

```
1. fetch-data.ts
   ├── GET {BONDS_API_URL}/bonds/{bond_type}           → BondRecord[]
   ├── GET {VALIDATORS_API_URL}/validators              → ValidatorRecord[]
   └── GET {SCORING_API_URL}/api/v1/scores/sam          → ScoringRecord[]

2. simulate-auction.ts
   ├── Import ds-sam-sdk
   ├── Merge bond + validator + scoring data
   └── For each bonded validator, compute:
       ├── bondGoodForNEpochs (same formula as PSR dashboard)
       ├── isInAuction (is the validator winning any stake?)
       └── stakeCappedPct (how much stake is capped due to bond size?)

3. evaluate-conditions.ts
   For each validator, check:
   ├── bond_underfunded: bondGoodForNEpochs < threshold (e.g., 10)
   ├── out_of_auction: validator has a bond + bid but is not winning
   └── stake_capped: bond limits the validator's maximum stake
   Each condition → raw BondsEventV1 with:
   ├── message_id: crypto.randomUUID()
   ├── type: "bonds"
   ├── inner_type: "bond_underfunded" | "out_of_auction" | "stake_capped"
   ├── vote_account, bond_pubkey, epoch
   ├── data.message: human-readable text
   ├── data.details: all raw numeric data points
   └── created_at: ISO 8601

4. emit-events.ts
   For each event:
   ├── POST {NOTIFICATIONS_API_URL}/bonds-event-v1  (with JWT auth header)
   ├── Retry with exponential backoff: 30s → 60s → 120s → 240s
   ├── On success: return { status: 'sent' }
   └── On retry exhaustion: log warning, return { status: 'failed', error }

5. persist-events.ts
   For each event + delivery result:
   └── INSERT INTO emitted_bond_events (message_id, inner_type, vote_account, payload, status, error)
```

### A.6 Event Schema (Local Types)

The event schema is the **contract** with marinade-notifications. It will be defined as a JSON Schema in the marinade-notifications repo (`message-types/schemas/bonds-event-v1.json`). Here we keep local TypeScript types that must match.

**NOTE:** The schema is provisional. It will be refined as we implement both sides. The `bonds-event-testing` package (Section A.10) is the contract enforcement mechanism — when the schema changes, both sides run tests against shared fixtures.

```typescript
// types.ts — local copy, must match the JSON Schema
interface BondsEventV1 {
  type: 'bonds'
  inner_type:
    | 'bond_underfunded'
    | 'out_of_auction'
    | 'stake_capped'
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
```

The event carries **raw facts only**. No `notification_id`, no `priority`, no `relevance_hours` — those are generated by the consumer brain (`bonds-notification` lib) in marinade-notifications.

### A.7 `/bonds-event-v1` Endpoint Not Yet Implemented

The marinade-notifications `/bonds-event-v1` POST endpoint does not exist yet. That's fine for this phase:

- The eventing module will attempt to POST and the request will fail (404 or connection refused)
- The retry logic kicks in (4 attempts, exponential backoff)
- After retry exhaustion, the event is logged as `status: failed` in `emitted_bond_events`
- The Buildkite step does NOT fail — it logs a warning and continues
- When the endpoint is implemented later, the events will start flowing through

This means we can develop and deploy the eventing module independently. It will produce a useful event log in the DB even before the notification pipeline is ready.

### A.8 Database Migration

New migration `migrations/0006-add-emitted-bond-events.sql`:

```sql
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

This table is append-only. Each hourly run appends new rows. No upsert, no update.

The DB writer (`persist-events.ts`) uses the same PostgreSQL connection approach as the existing `store-bonds` CLI: `tokio-postgres` with `--postgres-url` and `--postgres-ssl-root-cert`. Since this is a TS module, we'll use `pg` (node-postgres) instead, with the same connection parameters.

### A.9 Buildkite Pipeline Update

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
- Runs after store-bonds so the API has fresh data
- Uses the same `POSTGRES_URL` and SSL cert as store-bonds

### A.10 Testing

**Framework:** Jest (matches the rest of the TS packages in this repo). Add `jest.config.ts` to the package.

#### Unit Tests

**`fetch-data.spec.ts`**

- Mock HTTP responses from bonds API, validators API, scoring API
- Verify correct URL construction with bond_type parameter
- Verify data parsing and error handling (API returns 500, returns malformed data)
- Verify timeout handling

**`simulate-auction.spec.ts`**

- Provide pre-computed input data (bonds + validators + scores)
- Verify `bondGoodForNEpochs` calculation matches expected values
- Test edge cases: bond with 0 effective amount, validator with 0 stake, no bonds at all
- Compare against known PSR dashboard results if available (regression anchor)

**`evaluate-conditions.spec.ts`**

- Given simulated auction results, verify correct events are generated:
  - Bond with bondGoodForNEpochs=1 → `bond_underfunded` event emitted
  - Bond with bondGoodForNEpochs=15 → no event
  - Validator not winning auction → `out_of_auction` event
  - Validator winning but stake capped → `stake_capped` event
- Verify each event has: valid `message_id` (UUID), `created_at` (ISO 8601), non-empty `data.message`, expected fields in `data.details`
- Verify no events emitted when all bonds are healthy

**`emit-events.spec.ts`**

- Mock HTTP POST endpoint
- Test successful delivery: POST returns 200 → result is `{ status: 'sent' }`
- Test retry: first 2 POSTs fail (503), third succeeds → result is `{ status: 'sent' }`, verify 3 calls with increasing delays
- Test retry exhaustion: all POSTs fail → result is `{ status: 'failed', error: '...' }`, verify exactly `RETRY_MAX_ATTEMPTS` calls
- Test DRY_RUN mode: no HTTP calls made, events logged to stdout

**`persist-events.spec.ts`**

- Mock `pg.Client` (or use a lightweight in-memory approach)
- Verify INSERT query shape and parameters
- Verify all event fields are persisted correctly
- Verify `status` and `error` are written correctly for sent/failed events

#### Integration Test

**`integration.spec.ts`**

- Mock all external HTTP endpoints (bonds API, validators API, scoring API, notifications API)
- Run the full flow: fetch → simulate → evaluate → emit → persist
- Verify end-to-end: given a set of bonds where some are underfunded, the correct events are emitted to the notification mock and persisted to the DB mock
- Verify the module handles partial failures gracefully (some events POST successfully, some fail)

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

The key insight: **who can subscribe on behalf of a bond?** The same authorities who can configure the bond:

1. **Bond authority** — the `authority` pubkey stored in the Bond account
2. **Validator identity** — the `node_pubkey` from the vote account (validator's identity keypair)

(The bond token holder path via `--with-token` is out of scope for subscriptions in v1.)

This matches `check_bond_authority` in `programs/validator-bonds/src/checks.rs:107-118`. The subscription signing replicates this logic off-chain.

### B.3 Message Signing

The CLI currently has **no message signing infrastructure** — only transaction signing via the `Wallet` interface (`signTransaction`, `signAllTransactions`). We need to add off-chain message signing.

**Approach:** Use `tweetnacl` (already a transitive dependency via `@solana/web3.js`) for ed25519 message signing.

New utility in `packages/validator-bonds-cli-core/src/signMessage.ts`:

```typescript
import nacl from 'tweetnacl'
import { Keypair } from '@solana/web3.js'

/**
 * Structured message for subscription signing.
 * Format: "marinade-bonds:<action>:<notification_type>:<channel>:<vote_account>:<timestamp>"
 * The structured format prevents signature reuse across different actions/channels.
 */
export function buildSubscriptionMessage(params: {
  action: 'subscribe' | 'unsubscribe'
  notificationType: string
  channel: string
  voteAccount: string
  timestamp: number
}): Uint8Array {
  const text = `marinade-bonds:${params.action}:${params.notificationType}:${params.channel}:${params.voteAccount}:${params.timestamp}`
  return new TextEncoder().encode(text)
}

export function signMessage(message: Uint8Array, keypair: Keypair): Uint8Array {
  return nacl.sign.detached(message, keypair.secretKey)
}
```

**Ledger support:** The Solana Ledger app supports `signMessage` (off-chain signing). If the existing `parseWallet` returns a Ledger wallet, we'll need to call its `signMessage` method. This depends on the Ledger adapter library — may need to add `@solana/wallet-adapter-ledger` or similar. **For v1, we support file keypair only and document Ledger as a future enhancement.**

### B.4 New Commands

Three new commands added to `packages/validator-bonds-cli-core/src/commands/manage/`:

#### `subscribe` command

```
validator-bonds subscribe <bond-or-vote> --channel <telegram|api> [--channel-address <address>]
```

| Option                    | Description                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `<bond-or-vote>`          | Bond account address or vote account address (resolved via existing `getBondFromAddress`)                      |
| `--channel`               | Notification channel: `telegram` or `api` (pull via notifications endpoint)                                    |
| `--channel-address`       | Channel-specific address (e.g., Telegram username/chat ID). Required for Telegram, not needed for API.         |
| `--authority`             | Keypair to sign the subscription message (bond authority or validator identity). Falls back to wallet keypair. |
| `--notifications-api-url` | Override notification service URL (for testing)                                                                |

**Flow:**

1. Resolve bond: `getBondFromAddress(bondOrVote)` → get bond pubkey, vote account, authority
2. Determine signing keypair: `--authority` flag or default wallet
3. Build structured message: `buildSubscriptionMessage({ action: 'subscribe', ... })`
4. Sign message with the keypair
5. POST to `{NOTIFICATIONS_API_URL}/subscriptions` with body:
   ```json
   {
     "user_id": "<vote_account>",
     "notification_type": "bonds",
     "channel": "telegram",
     "channel_address": "<address>",
     "signing_pubkey": "<authority_or_identity_pubkey>",
     "signature": "<base64_signature>",
     "message": "<base64_message>",
     "additional_data": {
       "config_address": "<bond_config_pubkey>",
       "vote_account": "<vote_account>",
       "bond_pubkey": "<bond_pubkey>"
     }
   }
   ```
6. Handle response:
   - For `telegram` channel: the API returns a deep link URL (`https://t.me/...?start=<token>`). Display it prominently.
   - For `api` channel: subscription is immediately active. Confirm.

#### `unsubscribe` command

```
validator-bonds unsubscribe <bond-or-vote> --channel <telegram|api>
```

Same signing flow as subscribe, but calls `DELETE /subscriptions` with the signed message containing `action: 'unsubscribe'`.

#### `show-notifications` command

```
validator-bonds show-notifications <bond-or-vote> [--priority <critical|warning|info>] [--limit <n>]
```

| Option                    | Description                             |
| ------------------------- | --------------------------------------- |
| `<bond-or-vote>`          | Bond or vote account address            |
| `--priority`              | Filter by priority level                |
| `--limit`                 | Max notifications to show (default: 10) |
| `--notifications-api-url` | Override URL                            |

**Flow:**

1. Resolve vote account from bond-or-vote
2. GET `{NOTIFICATIONS_API_URL}/notifications?user_id={vote_account}&type=bonds&priority={priority}&limit={limit}`
3. Display notifications in a formatted table/list (similar to `show-bond` output style)

**Authentication for show-notifications:** This endpoint may require Solana signature auth (same as subscriptions) or may be public with just the vote_account as filter. TBD based on marinade-notifications design. For now, implement with optional signature auth that can be enabled/disabled.

### B.5 File Structure

```
packages/validator-bonds-cli-core/src/
  signMessage.ts                           — NEW: message signing utility
  commands/manage/
    subscribe.ts                           — NEW: subscribe command
    unsubscribe.ts                         — NEW: unsubscribe command
  commands/
    showNotifications.ts                   — NEW: show-notifications command
```

The commands are defined in cli-core as `configure*()` + `manage*()`/`show*()` functions (matching the existing pattern). Each downstream CLI (SAM, institutional) wires them in via `installSubcommands()`.

### B.6 Integration with Downstream CLIs

Both `validator-bonds-cli` and `validator-bonds-cli-institutional` need to register the new commands:

```typescript
// In each CLI's installSubcommands():
import {
  configureSubscribe,
  configureUnsubscribe,
  configureShowNotifications,
} from '@marinade.finance/validator-bonds-cli-core'

configureSubscribe(program)
configureUnsubscribe(program)
configureShowNotifications(program)
```

### B.7 Subscription Verification (Server Side — Reference Only)

The marinade-notifications subscription API will use a **SubscriptionVerifier** plugin to validate that the signing pubkey is authorized for the claimed bond. The bonds verifier plugin (in `packages/bonds-notification/` or inline in marinade-notifications) will:

1. Receive: `signing_pubkey`, `additional_data: { config_address, vote_account, bond_pubkey }`
2. Read the bond account on-chain (derive PDA from `config_address + vote_account`, or fetch by `bond_pubkey`)
3. Check if `signing_pubkey == bond.authority` OR `signing_pubkey == vote_account.node_pubkey`
4. If valid: return `{ verifyAgainstPubkey: signing_pubkey, userId: vote_account }`
5. Subscription is stored keyed by `vote_account` — events are also keyed by `vote_account`, so delivery routing works

**This is implemented in marinade-notifications, not here.** But the CLI must send the right data for it to work.

### B.8 Testing

#### Unit Tests

**`signMessage.spec.ts`**

- Verify `buildSubscriptionMessage` produces correct structured text
- Verify `signMessage` produces a valid ed25519 signature that `nacl.sign.detached.verify` accepts
- Verify different parameters produce different messages (no collision)
- Verify timestamp is embedded (replay protection)

**`subscribe.spec.ts`**

- Mock `getBondFromAddress` to return a known bond with authority + vote account
- Mock HTTP POST to subscription API
- Verify the command constructs correct request body with all required fields
- Verify signature is base64 encoded
- Verify `additional_data` contains config_address, vote_account, bond_pubkey
- Test with bond authority keypair → signing_pubkey matches authority
- Test with validator identity keypair → signing_pubkey matches identity pubkey
- Test error: no keypair provided and wallet is pubkey-only → clear error message

**`unsubscribe.spec.ts`**

- Similar to subscribe tests but with `action: 'unsubscribe'` and `DELETE` method

**`showNotifications.spec.ts`**

- Mock HTTP GET to notifications API
- Verify correct query parameters (user_id, type, priority, limit)
- Verify output formatting for various notification payloads
- Test empty response → "No notifications" message
- Test API error → graceful error message

#### Integration Tests (with test-validator)

**`subscribe.spec.ts` (integration)**

- Follows the pattern from `announcements.spec.ts`: spawn the CLI as a child process, mock the subscription API with `TestHttpServer`
- Create a real bond on-chain (via `initConfigInstruction` + `initBondInstruction`)
- Run `subscribe` command with the bond authority keypair → verify POST request received by mock server has correct body
- Run `subscribe` command with validator identity keypair → verify POST request received
- Run `show-notifications` command → verify GET request and output formatting

#### CI

Add to existing TS lint-and-test workflow:

```yaml
- label: ':test_tube: CLI Core Subscription Tests'
  commands:
    - pnpm --filter @marinade.finance/validator-bonds-cli test
```

The integration tests require a running test-validator (same as existing CLI tests like `configureBond.spec.ts`).

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
  "dependencies": {
    "@marinade.finance/ds-sam-sdk": "latest",
    "pg": "^8.x",
    "pino": "^9.x",
    "pino-pretty": "^11.x"
  },
  "devDependencies": {
    "jest": "^29.x",
    "ts-jest": "^29.x",
    "@types/pg": "^8.x",
    "nock": "^14.x"
  }
}
```

### validator-bonds-cli-core additions

```json
{
  "dependencies": {
    "tweetnacl": "^1.x" // already a transitive dep via @solana/web3.js, but make explicit
  }
}
```

---

## Implementation Order

```
Step 1: Scaffold bonds-eventing package
  ├── package.json, tsconfig.json, jest config
  ├── types.ts (local BondsEventV1 definition)
  └── config.ts
  → verify: pnpm build succeeds

Step 2: Implement fetch-data.ts + tests
  ├── Fetch from bonds API, validators API, scoring API
  └── Unit tests with mocked HTTP
  → verify: tests pass with realistic mock data

Step 3: Implement simulate-auction.ts + tests
  ├── Import ds-sam-sdk, compute bondGoodForNEpochs
  └── Unit tests with known input/output pairs
  → verify: calculation matches PSR dashboard formula

Step 4: Implement evaluate-conditions.ts + tests
  ├── Condition checking logic
  ├── Event construction
  └── Unit tests
  → verify: correct events for known scenarios

Step 5: Implement emit-events.ts + tests
  ├── HTTP POST with retry
  └── Unit tests (mock server, retry scenarios)
  → verify: retry behavior, status tracking

Step 6: Implement persist-events.ts + migration + tests
  ├── migrations/0006-add-emitted-bond-events.sql
  ├── pg INSERT logic
  └── Unit tests
  → verify: correct SQL, all fields persisted

Step 7: Wire up index.ts (CLI entry point) + integration test
  ├── Orchestrate: fetch → simulate → evaluate → emit → persist
  └── Integration test with all externals mocked
  → verify: end-to-end flow works

Step 8: Update Buildkite pipeline
  ├── Add emit-bond-events step to collect-bonds.yml
  └── soft_fail configuration
  → verify: pipeline YAML is valid

Step 9: Implement CLI signMessage.ts + tests
  ├── buildSubscriptionMessage, signMessage utilities
  └── Unit tests
  → verify: signature creation and verification

Step 10: Implement subscribe command + tests
  ├── configureSubscribe, manageSubscribe
  ├── Unit tests with mocked API
  └── Integration test with TestHttpServer + test-validator
  → verify: correct POST body, signature, bond resolution

Step 11: Implement unsubscribe command + tests
  ├── configureUnsubscribe, manageUnsubscribe
  └── Tests (similar pattern to subscribe)
  → verify: correct DELETE request

Step 12: Implement show-notifications command + tests
  ├── configureShowNotifications, showNotifications
  └── Tests with mock notifications API
  → verify: correct GET params, output formatting

Step 13: Wire commands into downstream CLIs
  ├── validator-bonds-cli installSubcommands
  └── validator-bonds-cli-institutional installSubcommands
  → verify: commands appear in --help, basic smoke test
```

---

## Open Items (to resolve during implementation)

1. **ds-sam-sdk integration details** — need to verify exact import path and API for auction simulation. The PSR dashboard (`psr-dashboard/src/services/sam.ts`) is the reference implementation.

2. **Notifications API URL in production** — what URL will marinade-notifications be at? Needed for Buildkite env var and CLI default.

3. **JWT for notifications POST** — how is the JWT obtained? Is it a static service token or dynamic? Needed for the emit-events.ts auth header.

4. **show-notifications auth** — does the GET /notifications endpoint require Solana signature auth, or is it public (filtered by vote_account)? Affects the CLI implementation.

5. **Ledger support for message signing** — v1 supports file keypair only. Ledger `signMessage` requires wallet-adapter integration, which is a separate effort.

6. **Telegram channel subscription flow** — the deep link flow requires coordination with the Telegram bot service. For v1, the CLI subscribe command can POST to the subscription API and display whatever response comes back (deep link URL or direct confirmation).
