# Implementation Plan: Subscription SDK (`ts-subscription-client`)

## Goal

Extract HTTP subscription logic from `validator-bonds-cli-core` into a reusable SDK package in `marinade-notifications`, following the existing `ts-message-client` pattern. The CLI will then consume this SDK instead of making raw `fetch` calls.

## Current State

**In `validator-bonds-cli-core/src/commands/manage/`:**

- `subscribe.ts` — builds POST /subscriptions request body, calls fetch, handles response
- `unsubscribe.ts` — builds DELETE /subscriptions request body, calls fetch, handles response
- `subscriptions.ts` — builds GET /subscriptions with query params + auth headers, calls fetch, handles response
- `fetchNotificationsApi()` — shared fetch wrapper that converts connection errors to `CliCommandError`

**In `marinade-notifications`:**

- `ts-message-client` — existing SDK for publishing messages (Producer pattern)
- No SDK exists for the subscription management API

## What the SDK Handles vs What Stays in the CLI

### SDK (`ts-subscription-client`) — HTTP transport + types

- Type definitions for request/response shapes
- HTTP calls to POST/DELETE/GET `/subscriptions`
- Response parsing and error wrapping (using `NetworkError` pattern from `ts-message-client`)
- Message format construction (`Subscribe <type> <channel> <ts>`, `Unsubscribe ...`, `ListSubscriptions ...`)

### CLI (`validator-bonds`) — domain logic + signing

- Bond account resolution (vote account lookup, config)
- Wallet/Ledger signing (`signForSubscription`)
- Commander option parsing
- CLI-specific logging and output formatting
- `additional_data` construction (config_address, vote_account, bond_pubkey)

## Implementation Steps

### Step 1: Create `ts-subscription-client` package in `marinade-notifications`

**Location:** `/home/chalda/marinade/marinade-notifications/ts-subscription-client/`

**Files to create:**

#### `package.json`

```json
{
  "name": "@marinade.finance/ts-subscription-client",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc --build",
    "test": "jest",
    "clean": "rm -rf dist tsconfig.tsbuildinfo"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

No external dependencies — uses native `fetch`. Does NOT depend on `ts-message` (subscription API is separate from the message publishing flow).

#### `tsconfig.json`

Follow `ts-message-client/tsconfig.json` pattern — target ES2020, strict mode, declaration output.

#### `types.ts` — Request/response types + error class

```typescript
/** Configuration for the subscription client */
export interface SubscriptionClientConfig {
  base_url: string // e.g. "https://notifications-api.marinade.finance"
  timeout_ms?: number // default: 10_000
}

/** POST /subscriptions request */
export interface SubscribeRequest {
  pubkey: string
  notification_type: string
  channel: string
  channel_address: string
  signature: string
  message: string
  additional_data?: Record<string, unknown>
}

/** DELETE /subscriptions request */
export interface UnsubscribeRequest {
  pubkey: string
  notification_type: string
  channel: string
  channel_address?: string
  signature: string
  message: string
  additional_data?: Record<string, unknown>
}

/** GET /subscriptions auth */
export interface ListSubscriptionsAuth {
  signature: string // x-solana-signature header
  message: string // x-solana-message header
}

/** GET /subscriptions query */
export interface ListSubscriptionsQuery {
  pubkey: string
  notification_type?: string
  vote_account?: string
}

/** POST /subscriptions response */
export interface SubscribeResponse {
  user_id: string
  notification_type: string
  channel: string
  channel_address: string
  created_at: string
  deep_link?: string
  telegram_status?: string
}

/** DELETE /subscriptions response */
export interface UnsubscribeResponse {
  deleted: boolean
}

/** GET /subscriptions response item */
export interface Subscription {
  user_id: string
  notification_type: string
  channel: string
  channel_address: string
  created_at: string
}

/** Reuse NetworkError pattern from ts-message-client */
export class NetworkError extends Error {
  name = 'NetworkError'
  constructor(
    message: string,
    public readonly status?: number,
    public readonly response?: unknown,
  ) {
    super(message)
  }
}
```

#### `client.ts` — SubscriptionClient class

```typescript
export class SubscriptionClient {
  constructor(config: SubscriptionClientConfig)

  async subscribe(request: SubscribeRequest): Promise<SubscribeResponse>
  async unsubscribe(request: UnsubscribeRequest): Promise<UnsubscribeResponse>
  async listSubscriptions(
    query: ListSubscriptionsQuery,
    auth: ListSubscriptionsAuth,
  ): Promise<Subscription[]>
}
```

Implementation details:

- Each method calls the corresponding HTTP endpoint
- Uses `AbortController` for timeout (matching `ts-message-client` pattern)
- On non-ok response: reads body text, throws `NetworkError` with status and body
- On network failure: throws `NetworkError` with connection error message

#### `message.ts` — Message format helpers

```typescript
/** Builds the signed message string for subscribe operations */
export function subscribeMessage(
  notificationType: string,
  channel: string,
  timestampSeconds: number,
): string {
  return `Subscribe ${notificationType} ${channel} ${timestampSeconds}`
}

/** Builds the signed message string for unsubscribe operations */
export function unsubscribeMessage(
  notificationType: string,
  channel: string,
  timestampSeconds: number,
): string {
  return `Unsubscribe ${notificationType} ${channel} ${timestampSeconds}`
}

/** Builds the signed message string for listing subscriptions */
export function listSubscriptionsMessage(
  pubkey: string,
  timestampSeconds: number,
): string {
  return `ListSubscriptions ${pubkey} ${timestampSeconds}`
}
```

These helpers ensure the message format stays in sync with what the server expects. Currently the CLI hardcodes these strings — moving them to the SDK means the contract is defined once, next to the API.

#### `index.ts` — Public exports

```typescript
export { SubscriptionClient } from './client'
export { subscribeMessage, unsubscribeMessage, listSubscriptionsMessage } from './message'
export type { ... } from './types'
export { NetworkError } from './types'

export function createSubscriptionClient(
  config: SubscriptionClientConfig
): SubscriptionClient {
  return new SubscriptionClient(config)
}
```

#### `__tests__/client.test.ts` — Unit tests (mock fetch)

Follow `ts-message-client/__tests__/producer.test.ts` pattern with mocked `fetch`:

- Test each method (subscribe, unsubscribe, listSubscriptions)
- Test HTTP error handling (non-ok responses → NetworkError with status + body)
- Test network failure handling (connection refused → NetworkError)
- Test timeout handling (AbortController)
- Test request construction (correct URL, method, headers, body)

#### `__tests__/client.e2e.ts` — E2E tests (mock HTTP server)

Spin up a local HTTP server (same approach as `validator-bonds` `subscriptions.spec.ts`) to test real HTTP round-trips:

- **subscribe:** POST request arrives with correct body shape, returns typed response including `deep_link`
- **unsubscribe:** DELETE request arrives with correct body, with and without `channel_address`
- **listSubscriptions:** GET request has correct query params and auth headers (`x-solana-signature`, `x-solana-message`)
- **error propagation:** server returns 400/401/403/404 → client throws `NetworkError` with correct status and body
- **connection refused:** client throws `NetworkError` when server is unreachable

#### `__tests__/message.test.ts` — Message format tests

- `subscribeMessage('bonds', 'telegram', 1710000000)` → `'Subscribe bonds telegram 1710000000'`
- `unsubscribeMessage('bonds', 'email', 1710000000)` → `'Unsubscribe bonds email 1710000000'`
- `listSubscriptionsMessage('GrxB8U...', 1710000000)` → `'ListSubscriptions GrxB8U... 1710000000'`

### Step 2: Register in workspace

**`pnpm-workspace.yaml`** — add `ts-subscription-client` entry:

```yaml
packages:
  - notification-service/
  - ts-message-client
  - ts-subscription-client # <-- add
  - ts-message
  - message-types
  - message-types/typescript/*
```

### Step 3: Build and verify in `marinade-notifications`

```bash
cd /home/chalda/marinade/marinade-notifications
pnpm install
pnpm -F @marinade.finance/ts-subscription-client build
pnpm -F @marinade.finance/ts-subscription-client test
```

### Step 4: Consume SDK in `validator-bonds`

**Add dependency** in `packages/validator-bonds-cli-core/package.json`:

```json
"@marinade.finance/ts-subscription-client": "workspace:*"
```

Note: Both repos need to be in the same pnpm workspace, OR the SDK needs to be published to npm. Check current setup — if `validator-bonds` already consumes `marinade-notifications` packages via workspace, use that. Otherwise, the SDK would need to be published (change `private: false`) or linked.

> **Decision needed:** How does `validator-bonds` consume packages from `marinade-notifications`? If they're separate workspaces, the SDK either needs npm publishing or a `pnpm link` / path-based dependency approach.

### Step 5: Refactor CLI commands to use SDK

#### `subscribe.ts` changes:

- Import `SubscriptionClient`, `subscribeMessage` from SDK
- Replace inline message construction with `subscribeMessage('bonds', type, timestamp)`
- Replace `fetchNotificationsApi()` + manual body/error handling with `client.subscribe(request)`
- Keep: bond resolution, signing, authority validation, logging, deep_link handling

**Before (simplified):**

```typescript
const messageText = `Subscribe bonds ${type} ${timestamp}`
const signature = await signForSubscription(signingWallet, messageText)
const body = { pubkey, notification_type: 'bonds', channel: type, ... }
const response = await fetchNotificationsApi(url, { method: 'POST', body: JSON.stringify(body) })
if (!response.ok) { throw ... }
const result = await response.json()
```

**After (simplified):**

```typescript
const messageText = subscribeMessage('bonds', type, timestamp)
const signature = await signForSubscription(signingWallet, messageText)
const client = createSubscriptionClient({ base_url: notificationsApiUrl })
const result = await client.subscribe({
  pubkey, notification_type: 'bonds', channel: type,
  channel_address: channelAddress, signature: signatureBase58,
  message: messageText, additional_data: { ... },
})
```

#### `unsubscribe.ts` changes:

- Same pattern — use `unsubscribeMessage()` + `client.unsubscribe()`
- Remove manual fetch/error handling

#### `subscriptions.ts` changes:

- Use `listSubscriptionsMessage()` + `client.listSubscriptions()`
- Remove manual URL params construction and header building

#### Remove `fetchNotificationsApi()`

- After all three commands use the SDK, delete `fetchNotificationsApi()` from `subscribe.ts`
- Remove the `NOTIFICATIONS_API_URL_ENV` and `NOTIFICATIONS_API_URL_DEFAULT` constants only if they can be defined in the SDK or kept in the CLI (they're CLI config, so they stay in the CLI)

### Step 6: Error handling adaptation

The SDK throws `NetworkError`. The CLI currently throws `CliCommandError`. Options:

**Option A (recommended):** Catch `NetworkError` in each CLI command and wrap into `CliCommandError`:

```typescript
try {
  const result = await client.subscribe(request)
} catch (e) {
  if (e instanceof NetworkError) {
    throw new CliCommandError({
      valueName: 'subscribe',
      value: e.status ? `HTTP ${e.status}` : 'connection error',
      msg: `Subscription failed: ${e.message}`,
    })
  }
  throw e
}
```

**Option B:** Let `NetworkError` propagate — less CLI-friendly error messages.

### Step 7: Update tests

The existing test in `subscriptions.spec.ts` uses a mock HTTP server. The test should still work after refactoring since the SDK makes the same HTTP calls. Verify:

- Mock server still receives correct requests
- CLI output remains unchanged
- Error scenarios still produce expected CLI errors

### Step 8: Run `pnpm fix` if available

Check both repos for `pnpm fix` script and run after all changes.

## File Change Summary

### New files (in `marinade-notifications`):

| File                                               | Purpose                      |
| -------------------------------------------------- | ---------------------------- |
| `ts-subscription-client/package.json`              | Package definition           |
| `ts-subscription-client/tsconfig.json`             | TypeScript config            |
| `ts-subscription-client/jest.config.js`            | Test config                  |
| `ts-subscription-client/index.ts`                  | Public exports               |
| `ts-subscription-client/client.ts`                 | SubscriptionClient class     |
| `ts-subscription-client/types.ts`                  | Types + NetworkError         |
| `ts-subscription-client/message.ts`                | Message format helpers       |
| `ts-subscription-client/__tests__/client.test.ts`  | Unit tests (mocked fetch)    |
| `ts-subscription-client/__tests__/client.e2e.ts`   | E2E tests (mock HTTP server) |
| `ts-subscription-client/__tests__/message.test.ts` | Message format tests         |

### Modified files (in `marinade-notifications`):

| File                  | Change                       |
| --------------------- | ---------------------------- |
| `pnpm-workspace.yaml` | Add `ts-subscription-client` |

### Modified files (in `validator-bonds`):

| File                                                                     | Change                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `packages/validator-bonds-cli-core/package.json`                         | Add SDK dependency                                               |
| `packages/validator-bonds-cli-core/src/commands/manage/subscribe.ts`     | Use SDK client + message helpers, remove `fetchNotificationsApi` |
| `packages/validator-bonds-cli-core/src/commands/manage/unsubscribe.ts`   | Use SDK client + message helpers                                 |
| `packages/validator-bonds-cli-core/src/commands/manage/subscriptions.ts` | Use SDK client + message helpers                                 |

## Publishing & Cross-repo Consumption

The SDK package (`@marinade.finance/ts-subscription-client`) must be **published to npm** (`private: false`). During development, `pnpm link` is used for local testing across repos.

**Development workflow:**

1. Develop and test SDK in `marinade-notifications` with unit + e2e tests
2. Link locally into `validator-bonds` for integration testing: `pnpm link /home/chalda/marinade/marinade-notifications/ts-subscription-client`
3. Once stable, publish SDK to npm
4. Replace link with versioned dependency in `validator-bonds`

**package.json adjustment:**

```json
{
  "private": false,
  "publishConfig": {
    "access": "public"
  }
}
```

## Open Questions

1. **`signForSubscription` location:** Currently in CLI. Could move to the SDK as an optional signing utility, but it depends on `@marinade.finance/ledger-utils` and `@solana/web3.js` which are heavy deps. Recommendation: keep signing in the CLI.

2. **Message format ownership:** The SDK defines the message format strings. If the server changes the expected format, only the SDK needs updating. Is this the right ownership boundary? (I believe yes — the SDK is the client contract for the server API.)
