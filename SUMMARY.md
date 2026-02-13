# Bond Risk Notification System — Design Summary

## Implementation Status

| Layer     | Component                                          | Status                                           |
| --------- | -------------------------------------------------- | ------------------------------------------------ |
| Emitter   | `packages/bonds-eventing/`                         | ✅ Implemented                                   |
| Brain     | `packages/bonds-notification/`                     | ✅ Implemented                                   |
| Brain     | typescript-common migration + class-validator DTOs | ✅ Implemented                                   |
| Brain     | Cross-repo routing config type safety              | ✅ Implemented                                   |
| CLI       | `subscribe`, `unsubscribe`, `subscriptions`        | ✅ Implemented                                   |
| Buildkite | Emit Bond Events step                              | ✅ Implemented                                   |
| Schema    | `bonds-event-v1` codegen                           | ✅ Implemented (JSON Schema → generated package) |
| Server    | Ingress `POST /bonds-event-v1`                     | ✅ Implemented (marinade-notifications)          |
| Server    | Consumer pipeline (8-stage)                        | ✅ Implemented (marinade-notifications)          |
| Server    | Subscription API + Telegram                        | ✅ Implemented (marinade-notifications)          |
| Server    | Notifications Read API                             | ❌ Not yet                                       |
| CLI       | `show-notifications` command                       | ❌ Not yet                                       |

## Problem

Validators in the SAM auction get no proactive notification when their bond is at risk. If underfunded, they lose Marinade stake. Currently only internal Slack alerts and the PSR dashboard (pull-only) exist.

**Goal:** Notify validators via Telegram, PSR dashboard (pull), CLI (pull). Generalizable to other notification types.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ validator-bonds repo                                                    │
│                                                                         │
│  ┌──────────────┐    ┌──────────────────────────┐                      │
│  │bonds-collector│───>│  eventing module (TS) ✅  │                     │
│  │  (Rust CLI)   │    │  - delta-based (stateful)  │                     │
│  └──────────────┘    │  - runs after collect      │                     │
│                       │  - DsSamSDK auction sim    │                     │
│                       │  - emits delta events      │                     │
│                       │  - persists to PostgreSQL  │                     │
│                       │  - retries POST on failure │                     │
│                       └─────────┬──────────────────┘                    │
│                                 │ POST /bonds-event-v1                  │
│  ┌──────────────────────────┐   │  (with exp. backoff retry)            │
│  │ bonds-notification (lib) │   │                                       │
│  │  - YAML threshold config │   │  ← consumed by marinade-notif.       │
│  │  - priority/relevance    │   │    consumer (the "brain")             │
│  │  - notification_id gen   │   │                                       │
│  │  - business rules        │   │                                       │
│  │  - published to npm      │   │                                       │
│  └──────────────────────────┘   │                                       │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ marinade-notifications repo                                             │
│                                                                         │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐        │
│  │ ingress /bonds-event │──>│ PostgreSQL queue (inbox/archive)  │        │
│  │   - JWT auth         │   │   bonds_event_v1_inbox            │        │
│  │   - schema validate  │   │   bonds_event_v1_archive          │        │
│  └─────────────────────┘   │   bonds_event_v1_dlq              │        │
│                             └──────────────┬───────────────────┘        │
│                                            │                            │
│                                            ▼                            │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │ bonds-event consumer (delegates to Generic Pipeline)         │       │
│  │  1. loads bonds-notification lib (the "brain")               │       │
│  │  2. evaluates thresholds → skip or proceed                   │       │
│  │  3. generates deterministic notification_id (dedup key)      │       │
│  │  4. checks dedup table → skip if already delivered           │       │
│  │  5. loads routing config → determine channels for inner_type │       │
│  │  6. looks up subscriptions table → get channels per user     │       │
│  │  7. routes to delivery processors:                           │       │
│  │     ├─ Telegram (REST API) → sendMessage to chat_id          │       │
│  │     └─ API (DB save) → insert into notifications_outbox      │       │
│  │  8. records delivery in dedup table                          │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐        │
│  │ subscription API ✅  │   │ notifications read API            │        │
│  │  POST /subscriptions │   │  GET /notifications               │        │
│  │  DELETE /subscriptions│  │  - filter: type, user_id,         │        │
│  │  GET /subscriptions  │   │    priority, inner_type, recency  │        │
│  │  - Solana sig verify │   │                                    │        │
│  │  - bonds verifier    │   │                                    │        │
│  └─────────────────────┘   └──────────────────────────────────┘        │
│                                                                         │
│  ┌─────────────────────────────┐                                        │
│  │ ts-subscription-client ✅    │ ← SDK for CLI / external clients      │
│  │  SubscriptionClient class    │                                        │
│  │  message format helpers      │                                        │
│  └─────────────────────────────┘                                        │
│                                                                         │
│  notification-routing.yaml  ← defines default channels per             │
│                                inner_type, admin overrides              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## New Libraries (from validator-bonds repo)

### `@marinade.finance/bonds-notification` — The "brain" ✅

Business logic library deciding IF to notify, at what priority, and generating dedup keys. Consumed by the marinade-notifications consumer, NOT by the eventing module. Currently consumed via local file link (`link:../../validator-bonds/packages/bonds-notification`), not yet published to npm.

**Dependencies:** Uses `@marinade.finance/ts-common` (`loadFileSync`) and `@marinade.finance/cli-common` (`parseAndValidateYaml`) for config loading. YAML config is validated at load time via class-validator DTOs (`ThresholdConfigDto` and nested classes).

**`createBondsNotificationBrain()`** is **async** — loads and validates the YAML config once at construction, then evaluate/buildContent are sync.

**Inner type enum:** `BONDS_EVENT_INNER_TYPES` const array is the single source of truth for the `BondsEventInnerType` union type. Exported for runtime validation (e.g., routing config completeness tests in marinade-notifications).

**Threshold config** (YAML, packed inside the library — validated against `ThresholdConfigDto` at load time):

```yaml
evaluated_events:
  bond_underfunded_change:
    min_deficit_sol: 0.5
    priority_rules:
      - condition: 'currentEpochs < 2'
        priority: critical
      - condition: 'currentEpochs < 10'
        priority: warning
      - condition: 'currentEpochs >= 10'
        priority: info
        shouldNotify: false
    significant_change_pct: 20
    renotify_interval_hours: 24
    relevance_hours: 120
  auction_exited:
    priority: critical
    renotify_interval_hours: 24
    relevance_hours: 48
  cap_changed:
    notify_cap_types: ['BOND']
    notify_cap_types_priority: warning
    other_caps_priority: info
    other_caps_shouldNotify: false
    renotify_interval_hours: 24
    relevance_hours: 120
  bond_removed: ...
  announcement: { priority: critical, skip_dedup: true, relevance_hours: 48 }
passthrough_events:
  first_seen: { priority: info, relevance_hours: 24 }
  auction_entered: { priority: info, relevance_hours: 24 }
  bond_balance_change: { priority: info, relevance_hours: 24 }
  version_bump: { priority: info, relevance_hours: 24, skip_dedup: true }
```

**Brain interface:**

```typescript
interface BondsNotificationBrain {
  evaluate(event: BondsEventV1): EvaluationResult | null
  extractUserId(event: BondsEventV1): string
  buildContent(
    event: BondsEventV1,
    evaluation: EvaluationResult,
  ): NotificationContent
}

interface EvaluationResult {
  shouldNotify: boolean
  priority: 'critical' | 'warning' | 'info'
  relevanceHours: number
  notificationId: string | null // null = skip dedup
  routingKey: string
}

interface NotificationContent {
  title: string
  body: string
  dataPoints?: Array<{ label: string; value: string }>
}
```

The brain returns structured domain content. v1 delivers `body` as plain text to Telegram. The `dataPoints` field is available for future rich formatting when a `NotificationFormatter` service is introduced.

**Notification ID generation** (deterministic, encodes what changed AND when to re-notify):

- `bond_underfunded_change`: `sha256(vote_account + "underfunded" + amount_bucket + time_bucket)`
  - `amount_bucket` changes when deficit changes by >significant_change_pct (20%)
  - `time_bucket = floor(created_at / renotify_interval_hours)` — rolls over when re-notify interval elapses
- `auction_exited`: `sha256(vote_account + "auction_exited" + epoch + time_bucket)`
- `cap_changed`: `sha256(vote_account + "cap_changed" + cap_bucket + time_bucket)`

New notification_id = bypasses dedup automatically. All re-notification logic is in this library.

### `bonds-event-v1` — Event types ✅ Codegen pipeline

The `BondsEventV1` type is defined once in `marinade-notifications/message-types/schemas/bonds-event-v1.json` and auto-generated into a `bonds-event-v1` npm package (types + Ajv validator + Rust crate). All three consumers import from the generated package:

1. `packages/bonds-eventing/src/types.ts` — re-exports `BondsEventV1` and `BondsEventInnerType` from `bonds-event-v1`
2. `packages/bonds-notification/src/types.ts` — re-exports `BondsEventV1` and `BondsEventInnerType` from `bonds-event-v1`
3. `marinade-notifications/notification-service/` — imports `BondsEventV1` and `BondsEventV1Validator` from `bonds-event-v1` (workspace package)

**Workflow:** edit schema → `pnpm generate` → commit generated code → consumers get updated types. Both repos import from the generated package. Schema changes break tests in both repos → no silent drift.

---

## Event Schema (bonds-event-v1) — Updated

Schema lives in `marinade-notifications/message-types/schemas/bonds-event-v1.json` and drives the codegen pipeline. Defines the **payload** only — the `Message<T>` header envelope is handled by `ts-message`/`rust-message`. Fields like `notification_id`, `priority`, `relevance_hours` are NOT in the schema — they're generated by the consumer after evaluation.

> **Note:** The `inner_type` enum was expanded during implementation to reflect the delta-based design. The original condition-based types (`bond_underfunded`, `out_of_auction`, `stake_capped`) were replaced with transition-based delta types.

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
    "vote_account": { "type": "string" },
    "bond_type": { "type": "string", "enum": ["bidding", "institutional"] },
    "bond_pubkey": { "type": "string" },
    "epoch": { "type": "integer" },
    "requested_channels": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional: for admin announcements targeting specific channels"
    },
    "data": {
      "type": "object",
      "required": ["message", "details"],
      "properties": {
        "message": {
          "type": "string",
          "description": "Human-readable plain text summary"
        },
        "details": { "type": "object", "additionalProperties": true }
      }
    },
    "created_at": { "type": "string", "format": "date-time" }
  }
}
```

**Example `data` payload:**

```json
{
  "message": "Bond underfunded: 8.5 SOL deficit. Bond covers 0.5 epochs. Top up to stay in auction.",
  "details": {
    "bond_balance_sol": 1.5,
    "required_sol": 10.0,
    "deficit_sol": 8.5,
    "bond_good_for_n_epochs": 0.5,
    "marinade_activated_stake_sol": 50000,
    "expected_max_eff_bid_pmpe": 3.2,
    "epoch": 930
  }
}
```

The emitter generates `data.message` text. The consumer passes it through as-is to delivery channels.

**`bond_pubkey`** is derived (not null) from `(config_address, vote_account)` using `bondAddress()` from `@marinade.finance/validator-bonds-sdk`. The config address is resolved from `bond_type` using `MARINADE_CONFIG_ADDRESS` (bidding) or `MARINADE_INSTITUTIONAL_CONFIG_ADDRESS` (institutional).

**`bond_type`** enables per-type processing — consumers can filter or route events by bond type. Currently institutional bonds should not produce notifications but may in the future.

---

## Eventing Module (validator-bonds) ✅ Implemented

**Location:** `packages/bonds-eventing/`, runs as Buildkite step in `.buildkite/collect-bonds.yml` after Store Bonds (with `soft_fail` — never blocks the pipeline).

**Delta-based, not stateless.** Tracks previous state in `bond_event_state` table and emits events only when state changes. Does NOT depend on `bonds-notification`. Pure emitter of raw delta events.

**Flow (as implemented):**

1. Run `DsSamSDK.run()` — fetches all bond/validator/auction data from APIs and runs auction simulation
2. Load previous validator state from `bond_event_state` table (slonik)
3. Compare current `AuctionValidator[]` against previous state, emit delta events:
   - `first_seen` — new validator/bond detected
   - `bond_removed` — validator no longer present
   - `auction_entered` / `auction_exited` — auction status transitions
   - `cap_changed` — binding constraint type changed (BOND, COUNTRY, ASO, VALIDATOR, WANT, RISK)
   - `bond_underfunded_change` — `bondGoodForNEpochs` changed
   - `bond_balance_change` — lamport-level balance precision
4. POST each event to `marinade-notifications /bonds-event-v1` with exponential backoff retry (4xx except 429 not retried)
5. Write each event to `emitted_bond_events` table with `status: sent` or `failed`
6. Upsert current state to `bond_event_state` table for next run's comparison

**Tests:** 18 passing (12 delta evaluation + 6 emit/retry logic).

**Retry config for POST:**

```yaml
retry:
  base_delay_seconds: 30
  max_retries: 4 # 30s → 60s → 120s → 240s ≈ 7.5 min total
  backoff_multiplier: 2
  on_exhaustion: log_warning_and_continue
```

On exhaustion: discard event, don't fail the cron job.

---

## Bonds Consumer Pipeline (marinade-notifications) ✅

Hard-coded consumer following the existing staking-rewards pattern (implemented in commit `98d7fb2`). Each topic has its own consumer class with dedicated processing logic — no generic plugin framework.

### Brain interface (from `@marinade.finance/bonds-notification`)

```typescript
interface BondsNotificationBrain {
  evaluate(event: BondsEventV1): EvaluationResult | null
  extractUserId(event: BondsEventV1): string
  buildContent(
    event: BondsEventV1,
    evaluation: EvaluationResult,
  ): NotificationContent
}

interface NotificationContent {
  title: string // e.g. "Bond Underfunded"
  body: string // human-readable summary (used as plain text in v1)
  dataPoints?: DataPoint[] // structured key-value pairs (for future rich formatting)
}
```

### Processing stages (BondsEventV1Consumer)

```
 1. Dequeue from bonds_event_v1_inbox (polling + SKIP LOCKED)
 2. Validate payload via BondsEventV1Validator (generated package)
 3. brain.evaluate(event) → { shouldNotify, priority, notificationId, ... }
 4. If !shouldNotify → archive, done
 5. brain.extractUserId(event) → vote_account
 6. Dedup: EXISTS in notification_dedup WHERE notification_id = ?
    ├─ notificationId == null → skip dedup (announcements)
 7. If already delivered → archive, done
 8. Resolve targets: routing config ∩ SubscriptionsService.getActiveSubscriptions()
    ├─ force: true (announcements) → ALL bonds subscribers
 9. brain.buildContent() → deliver content.body as plain text to Telegram
10. Record in notification_dedup
11. Write to notifications_outbox (API channel — always, for pull access)
12. Archive message
```

### Delivery channels (v1)

- **Telegram:** `TelegramDeliveryService.sendMessage(chatId, content.body)` — plain text, no parse_mode
- **API:** Write to `notifications_outbox` table (pull via GET /notifications)
- **Future:** `NotificationFormatter` service for rich formatting (emojis, HTML, dataPoints)

---

## Dedup Mechanism

Simple existence check. All re-notification logic is in the brain (via notification_id hash).

- `notification_id` is the **sole dedup key** (no user_id, no time comparison)
- Consumer checks: `EXISTS in notification_dedup WHERE notification_id = $1`
  - Found → skip (already delivered)
  - Not found → deliver, then INSERT
- Brain encodes time_bucket in the hash → when re-notify interval elapses, hash changes → dedup passes
- Brain encodes amount_bucket → when situation changes significantly, hash changes → dedup passes

---

## Notification Routing Config

Hardcoded in `marinade-notifications/consumers/bonds-event-v1/routing-config.ts`. The `inner_types` keys are typed as `Record<BondsEventInnerType, InnerTypeRouting>` — adding a new inner_type to the brain without updating the routing config causes a compile-time error.

```typescript
const BONDS_ROUTING: NotificationRoutingConfig = {
  default_channels: ['api'],
  inner_types: {
    bond_underfunded_change: { channels: ['telegram', 'api'] },
    auction_exited: { channels: ['telegram', 'api'] },
    cap_changed: { channels: ['telegram', 'api'] },
    bond_removed: { channels: ['telegram', 'api'] },
    announcement: { channels: ['telegram', 'api'], force: true },
    first_seen: { channels: ['api'] },
    auction_entered: { channels: ['api'] },
    bond_balance_change: { channels: ['api'] },
    version_bump: { channels: ['api'] },
  },
}
```

**Type safety enforcement:** `BONDS_EVENT_INNER_TYPES` const array (exported from `bonds-notification`) is the single source of truth. The routing config keys are typed against `BondsEventInnerType` (compile-time) and validated by a completeness test (runtime). Adding a new inner_type without updating the routing config fails both the build and the test.

Events can include optional `requested_channels` (for admin announcements). Consumer routing config is authoritative.

---

## Subscription Module ✅ Implemented (CLI + Server + SDK)

**Server-side (✅ implemented in `marinade-notifications`):**

- `POST /subscriptions` — subscribe with Solana off-chain message signature verification
- `DELETE /subscriptions` — unsubscribe (specific address or all of type)
- `GET /subscriptions` — list active subscriptions (authenticated via `x-solana-signature` + `x-solana-message` headers)
- `POST /telegram/webhook` — Telegram bot webhook handler (`/start` activation, kicked events)
- `BondsSubscriptionVerifier` — loads bond on-chain, verifies signer is bond authority or validator identity
- `solana-auth.ts` — Solana off-chain message verification using `@solana/offchain-messages`
- E2E + unit test coverage for all subscription and verifier flows

**Subscription SDK (`ts-subscription-client`) (✅ implemented in `marinade-notifications`):**

- `SubscriptionClient` class — `subscribe()`, `unsubscribe()`, `listSubscriptions()`
- Message format helpers — `subscribeMessage()`, `unsubscribeMessage()`, `listSubscriptionsMessage()`
- `NetworkError` class for HTTP/connection error handling
- Unit tests (mocked fetch) + E2E tests (mock HTTP server)
- Published as `@marinade.finance/ts-subscription-client`

**CLI commands (✅ implemented in `validator-bonds-cli` only, NOT in `validator-bonds-cli-institutional`):**

- `subscribe <bond-or-vote> --type <telegram|email> --address <destination>` — subscribe to notifications
- `unsubscribe <bond-or-vote> --type <telegram|email> [--address <destination>]` — unsubscribe (specific address or all of type)
- `subscriptions <bond-or-vote> [-f <format>]` — list active subscriptions

All commands use Solana off-chain message signing (`@marinade.finance/ledger-utils`) with the validator-bonds program ID as application domain. Supports both Ledger hardware wallets and file-based keypairs.

**CLI → SDK refactor (✅ done):** CLI commands use `createSubscriptionClient()` from `ts-subscription-client` SDK — `client.subscribe()`, `client.unsubscribe()`, `client.listSubscriptions()` and message format helpers. `NetworkError` from SDK is caught and wrapped into `CliCommandError`.

**Verification plugin per type** (`SubscriptionVerifier` interface):

- For bonds: caller sends bond authority pubkey + `config_address` → plugin loads bond on-chain, verifies authority matches, returns `userId: vote_account`
- Fallback: verify signature against incoming pubkey, use as user_id

**Subscription table (✅ implemented):** Mutable `subscriptions` table (active state, one row per subscription key) + immutable `subscriptions_log` (audit trail). Direct lookups on active table — no `DISTINCT ON`. Replay protection via unique index on log table `message_ts`.

**Telegram deep link flow:**

1. CLI calls subscription API with pubkey + Solana signature
2. API generates opaque random linking token (UUID, stored in `telegram_activations` table)
3. Returns deep link: `https://t.me/<BotName>?start=<token>`
4. User clicks → bot receives `/start <token>` → verifies token → saves `chat_id` → subscription active

---

## Notifications Read API ❌ (not yet implemented)

`GET /notifications?user_id={pubkey}&type=bonds&priority=critical&inner_type=bond_underfunded_change&limit=50`

Returns non-expired, non-deactivated notifications from `notifications_outbox` table (filters `WHERE deactivated_at IS NULL AND expires_at > NOW()`). Auth: Solana signature or JWT. Consumed by CLI and PSR dashboard.

This API is part of the marinade-notifications service. All bond events land in `notifications_outbox` regardless of subscriptions (API channel is "always on"), so the dashboard shows aggregated data to all validators.

**Note:** The CLI `show-notifications` command for reading delivered notifications is not yet implemented. The current `subscriptions` command lists active subscriptions only.

---

## Message Flows

### Automated Events (hourly) — ✅ Full pipeline implemented

1. Buildkite cron → bonds-collector loads on-chain data
2. Eventing module runs `DsSamSDK.run()` → full auction simulation with all validators
3. Loads previous state from `bond_event_state` table
4. Compares current vs previous per validator — emits delta events only for **changes** (entered/exited auction, balance change, cap change, etc.)
5. POSTs each delta event to marinade-notifications `POST /bonds-event-v1` with exponential backoff retry
6. Writes events to `emitted_bond_events` table (`sent`/`failed`), upserts `bond_event_state`
7. Consumer (8-stage pipeline): validate → brain.evaluate() → dedup (optimistic INSERT) → resolve targets (routing ∩ subscriptions) → brain.buildContent() → deliver (telegram + outbox) → archive

### Admin Notifications

1. Admin POSTs to `/bonds-event-v1` with `inner_type: "announcement"` and optional `requested_channels`
2. Brain recognizes admin type → always notify, high priority
3. Routing config `force: true` → delivers to all subscribers

**Deactivation:** Announcements (and any notification) can be soft-deactivated without deleting rows:

- `notifications_outbox` table has a `deactivated_at` timestamp column (nullable, default NULL)
- Admin calls `PATCH /notifications/{id}/deactivate` → sets `deactivated_at = NOW()`
- Read API filters `WHERE deactivated_at IS NULL` — deactivated entries stop appearing in dashboard/CLI
- Full audit trail preserved (row stays in DB, delivery history intact)

---

## Staking-rewards Migration Path (optional, not v1)

The existing staking-rewards consumer is tightly coupled to Intercom + Partners. When changes are needed, it can be refactored to share infrastructure with bonds (dedup table, outbox, subscription routing). The bonds consumer serves as the reference implementation — no generic plugin abstraction needed until then.

---

## CLI Announcements Migration Plan

The current `cli_announcements` system (pull-based static banners in validator-bonds-api) will be replaced by the marinade-notifications Read API once the full pipeline is operational.

### Current system (to be deprecated)

- **DB table:** `cli_announcements` — admin-managed static messages with group versioning, filters by operation/account/CLI type
- **API:** `GET /v1/announcements` on validator-bonds-api — CLI fetches banners after command execution
- **DB table:** `cli_usage` — analytics tracking of CLI command executions
- **Code:** `api/src/handlers/cli_announcements.rs`, `packages/validator-bonds-cli-core/src/announcements.ts`

### Migration steps (single cutover)

Old CLI versions have graceful fallback — if the announcements API is unavailable, no banners are shown. This allows a clean cutover without dual-read:

1. **Update CLI:** Replace old announcements fetch (`GET /v1/announcements` from validator-bonds-api) with new `GET /notifications` from marinade-notifications Read API. The `show-notifications` CLI command replaces the banner display.
2. **Remove old API:** Delete `cli_announcements` handler from validator-bonds-api. Old CLI versions gracefully degrade (1.5s timeout → no announcements shown).
3. **Admins use new pipeline:** Post announcements via `POST /bonds-event-v1` with `inner_type: "announcement"`. Use `PATCH /notifications/{id}/deactivate` to retract.
4. **Cleanup:** Drop `cli_announcements` and `cli_usage` tables. Remove old announcements code from CLI (`packages/validator-bonds-cli-core/src/announcements.ts`).

---

## Testing Strategy

**1. Event type contract (codegen pipeline)**

- `BondsEventV1` types are generated from `bonds-event-v1.json` schema via the marinade-notifications codegen pipeline
- All three consumers (emitter, brain, notification-service) import from the generated `bonds-event-v1` package
- Schema changes break builds in both repos → no silent drift

**2. Emitter tests (validator-bonds)**

- Jest unit tests, mocked API responses
- `evaluate-deltas.spec.ts` — 12 tests for all delta detection paths
- `emit-events.spec.ts` — 6 tests for HTTP POST, retry logic, concurrency
- Verify: correct conditions produce events, message_id/created_at format, data.details has expected fields per inner_type
- Runs in existing CI

**3. Brain tests (validator-bonds)**

- `evaluate.spec.ts` — all evaluation paths, priority rules, threshold logic
- `content.spec.ts` — message formatting for each event type
- `notification-id.spec.ts` — dedup ID generation, time/amount bucket math
- `brain.spec.ts` — integration: full evaluate + buildContent flow (async brain creation)
- YAML config validated against class-validator DTOs at load time

**4. Consumer tests (marinade-notifications)**

- Unit: pipeline stages in isolation (mock plugin, test dedup logic, routing config, delivery dispatch)
- `routing-config.spec.ts` — routing config covers all `BONDS_EVENT_INNER_TYPES`, no extra keys, all have channels
- Uses `BondsEventV1Validator` from the generated `bonds-event-v1` package (Ajv-based)
- Runs in existing GitHub Actions CI

**5. Subscription tests (marinade-notifications)**

- `subscriptions.e2e.ts` — full subscribe/unsubscribe/list flows with Solana signature verification
- `bonds-verifier.e2e.ts` — bonds subscription verifier with on-chain bond verification
- `bonds-subscription-verifier.spec.ts` — unit tests for bonds verifier logic
- `ts-subscription-client` — unit tests (mocked fetch) + E2E tests (mock HTTP server) + message format tests
