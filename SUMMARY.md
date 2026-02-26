# Bond Risk Notification System — Design Summary

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
│  │bonds-collector│───>│  eventing module (TS)     │                     │
│  │  (Rust CLI)   │    │  - stateless              │                     │
│  └──────────────┘    │  - runs after collect      │                     │
│                       │  - fetches auction data    │                     │
│                       │  - emits raw events        │                     │
│                       │  - saves event artifacts   │                     │
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
│  │ subscription API     │   │ notifications read API            │        │
│  │  POST /subscriptions │   │  GET /notifications               │        │
│  │  DELETE /subscriptions│  │  - filter: type, user_id,         │        │
│  │  - Solana sig verify │   │    priority, inner_type, recency  │        │
│  └─────────────────────┘   └──────────────────────────────────┘        │
│                                                                         │
│  notification-routing.yaml  ← defines default channels per             │
│                                inner_type, admin overrides              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## New Libraries (published to npm from validator-bonds repo)

### `@marinade.finance/bonds-notification` — The "brain"

Business logic library deciding IF to notify, at what priority, and generating dedup keys. Consumed by the marinade-notifications consumer, NOT by the eventing module.

**Threshold config** (YAML, packed inside the library):

```yaml
thresholds:
  bond_underfunded:
    min_deficit_sol: 0.5
    priority_rules:
      - condition: 'bondGoodForNEpochs < 2'
        priority: critical
      - condition: 'bondGoodForNEpochs < 10'
        priority: warning
    significant_change_pct: 10
    renotify_interval_hours: 24
    relevance_hours: 120

  out_of_auction:
    priority: critical
    renotify_interval_hours: 24
    relevance_hours: 48

  stake_capped:
    min_cap_reduction_pct: 5
    priority: warning
    renotify_interval_hours: 24
    relevance_hours: 120
```

**`evaluate()` function** returns: `{ shouldNotify, priority, relevanceHours, notificationId }` or null.

**Notification ID generation** (deterministic, encodes what changed AND when to re-notify):

- `bond_underfunded`: `sha256(bond_pubkey + "underfunded" + amount_bucket + time_bucket)`
  - `amount_bucket` changes when deficit changes by >significant_change_pct
  - `time_bucket = floor(created_at / renotify_interval_hours)` — rolls over when re-notify interval elapses
- `out_of_auction`: `sha256(bond_pubkey + "out_of_auction" + epoch + time_bucket)`
- `stake_capped`: `sha256(bond_pubkey + "stake_capped" + cap_bucket + time_bucket)`

New notification_id = bypasses dedup automatically. All re-notification logic is in this library.

### `@marinade.finance/bonds-event-testing` — Contract enforcement

Test fixtures and schema validator shared between both repos. Contains factory functions for valid/invalid events, AJV schema validator, assertion helpers.

---

## Event Schema (bonds-event-v1)

Defines what the **emitter** sends. Fields like `notification_id`, `priority`, `relevance_hours` are NOT in the schema — they're generated by the consumer after evaluation.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "bonds-event-v1",
  "title": "BondsEventV1",
  "type": "object",
  "required": ["type", "inner_type", "vote_account", "data", "created_at"],
  "properties": {
    "type": { "const": "bonds" },
    "inner_type": {
      "enum": [
        "bond_underfunded",
        "out_of_auction",
        "stake_capped",
        "announcement",
        "version_bump"
      ]
    },
    "vote_account": { "type": "string" },
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

---

## Eventing Module (validator-bonds)

**Location:** `packages/bonds-eventing/`, runs as Buildkite cron step after bonds-collector (hourly).

**Stateless.** Does NOT depend on `bonds-notification`. Pure emitter of raw events.

**Flow:**

1. Fetch bond data from validator-bonds-api, validator/auction data from APIs
2. Run ds-sam-sdk auction simulation (same as PSR dashboard)
3. For each bonded validator, compute `bondGoodForNEpochs` and auction status
4. For each condition met, construct raw event with `message_id` (UUID) and `created_at`
5. POST to marinade-notifications with retry
6. Write each event to `emitted_bond_events` table (PostgreSQL) with `status: sent` or `failed`

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

## Generic Notification Pipeline (marinade-notifications)

Pluggable framework — each notification type registers a plugin implementing `NotificationPlugin`. The pipeline handles dedup, routing, subscription lookup, and delivery. Stages are skippable via plugin return values.

### Plugin interface

```typescript
interface EvaluationResult {
  shouldNotify: boolean
  priority: 'critical' | 'warning' | 'info'
  relevanceHours: number
  notificationId: string | null // null = skip dedup
}

interface NotificationPlugin {
  readonly type: string
  evaluate(event: unknown): EvaluationResult | null
  extractUserId(event: unknown): string
  resolveDeliveryTargets?(
    userId: string,
    event: unknown,
  ): Promise<DeliveryTarget[] | null>
  formatMessage?(
    event: unknown,
    channel: string,
    evaluation: EvaluationResult,
  ): string
}

interface DeliveryTarget {
  channel: string // 'telegram', 'api', 'intercom', 'partner-email'
  address: string // chat_id, email, intercom_user_id, '' for api
  metadata?: Record<string, unknown>
}
```

### Pipeline stages

```
 1. Dequeue from topic inbox                              SHARED
 2. Validate payload against topic schema                 SHARED
 3. plugin.evaluate(event)                                PLUGIN
    ├─ beforeEvaluate / afterEvaluate                     HOOK
 4. If !shouldNotify → archive                            SHARED
 5. plugin.extractUserId(event)                           PLUGIN
 6. Dedup: EXISTS check in notification_dedup table       SHARED
    ├─ notificationId == null → SKIP dedup
 7. If already delivered → archive                        SHARED
 8. Resolve delivery targets:
    ├─ plugin.resolveDeliveryTargets()                    PLUGIN
    ├─ returns null → routing config + subscription table SHARED
 9. Deliver to each target via channel registry           SHARED
    ├─ plugin.formatMessage()                             PLUGIN
10. Record in dedup table                                 SHARED
11. Archive message                                       SHARED
```

**Stages are skippable:**

- `evaluate()` returns `shouldNotify: true` always → no filtering (staking-rewards behavior)
- `notificationId: null` → stages 6-7 skipped
- `resolveDeliveryTargets()` returns targets → routing config + subscription table skipped
- `resolveDeliveryTargets()` returns null → falls through to shared infrastructure

### Type hooks

Per-type `before`/`after` hooks live in marinade-notifications code (not in the plugin lib). Escape hatch for tweaks without modifying the plugin library.

```typescript
interface TypeHooks {
  beforeEvaluate?(event: unknown): unknown
  afterEvaluate?(
    event: unknown,
    result: EvaluationResult | null,
  ): EvaluationResult | null
  beforeDedup?(notificationId: string, userId: string): { skip?: boolean }
  afterResolveTargets?(targets: DeliveryTarget[]): DeliveryTarget[]
  afterDelivery?(event: unknown, targets: DeliveryTarget[]): void
}
```

### Delivery channel registry

Existing channels (Intercom, Partner Email) wrapped as `DeliveryChannel` alongside new ones:

```typescript
interface DeliveryChannel {
  readonly name: string
  deliver(
    target: DeliveryTarget,
    message: string,
    event: unknown,
  ): Promise<void>
}

// Channel registry:
//   'intercom'       → wraps existing IntercomService
//   'partner-email'  → wraps existing PartnersService + SmtpService
//   'telegram'       → new TelegramService (REST API)
//   'api'            → notifications_outbox insert (pull channel)
```

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

YAML file in marinade-notifications defining default channels per inner_type:

```yaml
bonds:
  default_channels: [api]
  inner_types:
    bond_underfunded:
      channels: [telegram, api]
    out_of_auction:
      channels: [telegram, api]
    stake_capped:
      channels: [telegram, api]
    announcement:
      channels: [telegram, api]
      force: true # send to ALL subscribers
    version_bump:
      channels: [api] # pull-only
```

Events can include optional `requested_channels` (for admin announcements). Consumer routing config is authoritative.

---

## Subscription Module

**API endpoints:** `POST /subscriptions`, `DELETE /subscriptions` — Solana signature verification.

**Verification plugin per type** (`SubscriptionVerifier` interface):

- For bonds: caller sends bond authority pubkey + `config_address` → plugin loads bond on-chain, verifies authority matches, returns `userId: vote_account`
- Fallback: verify signature against incoming pubkey, use as user_id

**Subscription table:** insert-only with latest row semantics (no upsert). Supports `source: 'self-service'` and `source: 'managed'` (for potential BigQuery import later).

**Telegram deep link flow:**

1. CLI calls subscription API with pubkey + Solana signature
2. API generates opaque random linking token (16 bytes base64url, 10 min TTL, single-use)
3. Returns deep link: `https://t.me/<BotName>?start=<token>`
4. User clicks → bot receives `/start <token>` → verifies token → saves `chat_id` → subscription active

---

## Notifications Read API

`GET /notifications?user_id={pubkey}&type=bonds&priority=critical&inner_type=bond_underfunded&limit=50`

Returns non-expired notifications from `notifications_outbox` table. Auth: Solana signature or JWT. Consumed by CLI and PSR dashboard.

---

## Message Flows

### Automated Events (hourly)

1. Buildkite cron → bonds-collector loads on-chain data
2. Eventing module fetches auction data, runs ds-sam-sdk simulation
3. For each condition met (underfunded, out of auction, stake capped), emits raw event with `message_id` (UUID) + `created_at`
4. POSTs to marinade-notifications with exponential backoff retry
5. Writes event to `emitted_bond_events` table (`sent`/`failed`)
6. Consumer: brain evaluates → generates notification_id → dedup check → routing → subscription → delivery

### Admin Notifications

1. Admin POSTs to `/bonds-event-v1` with `inner_type: "announcement"` and optional `requested_channels`
2. Brain recognizes admin type → always notify, high priority
3. Routing config `force: true` → delivers to all subscribers

---

## Staking-rewards Migration Path (optional, not v1)

The existing staking-rewards consumer is tightly coupled to Intercom + Partners. It can be migrated to the pluggable pipeline as an inline plugin:

- `evaluate()`: always notify, `notificationId: null` (skip dedup)
- `resolveDeliveryTargets()`: absorbs current Partners-vs-Intercom decision logic (BigQuery whitelist check → partner email, fallback → Intercom user lookup)
- Existing consumer can run alongside during transition

---

## Testing Strategy

**1. Shared contract library (`@marinade.finance/bonds-event-testing`)**

- Published from validator-bonds to npm
- Contains: JSON Schema validator, factory functions for valid/invalid test events, assertion helpers
- Both repos import it — single source of truth for event format
- Schema change workflow: update test lib → publish → bump in marinade-notifications → run tests → breaks = incompatible

**2. Emitter tests (validator-bonds)**

- Jest unit tests, mocked API responses
- Verify: correct conditions produce events, events pass schema validation, message_id/created_at format, data.details has expected fields per inner_type
- Retry/DB persistence tests with mocked HTTP
- Runs in existing GitHub Actions CI

**3. Consumer tests (marinade-notifications)**

- Unit: pipeline stages in isolation (mock plugin, test dedup logic, routing config, delivery dispatch)
- E2E: TestContainers PostgreSQL, full ingress → consumer → delivery flow with mocked channels
- Schema contract: import bonds-event-testing fixtures, POST to ingress, verify accept/reject
- Runs in existing GitHub Actions CI
