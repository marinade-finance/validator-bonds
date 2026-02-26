# Implementation Plan — BondsSubscriptionVerifier Plugin

> **Status: IMPLEMENTED** (Steps 4–7 completed; Step 8 E2E test pending)

This document details the implementation of the `BondsSubscriptionVerifier` plugin that integrates into the `marinade-notifications` subscription module. The verifier validates that an incoming signing pubkey is authorized to subscribe on behalf of a given bond (identified by vote account).

---

## Context & Problem

When a validator calls `validator-bonds subscribe <bond-or-vote>`, the CLI sends a subscription request to `marinade-notifications` with:

```json
{
  "pubkey": "<signing_pubkey_base58>",
  "notification_type": "bonds",
  "channel": "telegram",
  "channel_address": "@myhandle",
  "signature": "<ed25519_sig_base58>",
  "message": "Subscribe bonds telegram 1709123456",
  "additional_data": {
    "config_address": "<bond_config_pubkey>",
    "vote_account": "<vote_account_pubkey>",
    "bond_pubkey": "<bond_pda_pubkey>"
  }
}
```

The `pubkey` (signing key) could be **either**:

1. **Bond authority** — the `authority` field stored in the on-chain Bond account
2. **Validator identity** — the `node_pubkey` stored in the on-chain Vote account (at byte offset 4)

This matches the on-chain `check_bond_authority()` logic in `programs/validator-bonds/src/checks.rs:108-118`:

```rust
pub fn check_bond_authority(authority: &Pubkey, bond_account: &Bond, vote_account: &UncheckedAccount) -> bool {
    if authority == &bond_account.authority.key() {
        true
    } else {
        check_vote_account_validator_identity(vote_account, authority).is_ok_and(|_| true)
    }
}
```

The verifier must replicate this dual-path authorization off-chain.

---

## Where It Lives

The verifier lives in `marinade-notifications` repo, **not** in `validator-bonds`. It implements the existing `SubscriptionVerifier` interface:

```typescript
// notification-service/subscriptions/subscription-verifier.interface.ts (already exists)
export interface VerificationResult {
  verifyAgainstPubkey: string // pubkey to verify the Solana signature against
  userId: string // user identifier for subscription storage
}

export interface SubscriptionVerifier {
  // Optional per-type signing domain (already implemented in uncommitted changes)
  readonly signingDomain?: string

  verifySubscription(
    incomingPubkey: string,
    notificationType: string,
    additionalData: Record<string, unknown>,
  ): Promise<VerificationResult | null> // null = rejection
}
```

---

## Data Flow

```
CLI subscribe command
  │
  │  POST /subscriptions { pubkey, notification_type: "bonds", additional_data: {...} }
  ▼
SubscriptionsController.subscribe()
  │
  │  1. Lookup verifier: verifiers["bonds"] → BondsSubscriptionVerifier
  │
  ▼
BondsSubscriptionVerifier.verifySubscription(pubkey, "bonds", additional_data)
  │
  │  2. Parse additional_data → { config_address, vote_account, bond_pubkey }
  │  3. Derive expected bond PDA from (config_address, vote_account)
  │  4. Verify derived PDA == additional_data.bond_pubkey (integrity check)
  │  5. Fetch bond account on-chain → extract bond.authority (offset 72)
  │  6. Fetch vote account on-chain → extract node_pubkey (offset 4)
  │  7. Check: pubkey == bond.authority OR pubkey == node_pubkey
  │
  │  If match → return { verifyAgainstPubkey: pubkey, userId: vote_account }
  │  If no match → return null (403 Forbidden)
  ▼
SubscriptionsController (continues)
  │
  │  8. Verify Solana off-chain message signature against verifyAgainstPubkey
  │  9. Validate timestamp freshness
  │ 10. Insert subscription with userId = vote_account
  ▼
Done — subscription stored keyed by vote_account
```

**Key design decision:** `userId = vote_account`. Events are emitted per vote_account by the eventing module, so delivery routing works naturally. Multiple authorities (bond authority + validator identity) can manage the same subscription because the subscription is keyed by vote_account, not by signer.

---

## On-Chain Account Layouts

### Bond Account (Anchor)

```
Offset  Size  Field
─────── ───── ─────────────────────
0       8     Anchor discriminator
8       32    config: Pubkey
40      32    vote_account: Pubkey
72      32    authority: Pubkey        ← needed for verification
104     8     cpmpe: u64
112     1     bump: u8
113     8     max_stake_wanted: u64
121     134   reserved: [u8; 134]
```

**Authority is at byte offset 72** (8 + 32 + 32).

### Vote Account (Solana native)

```
Offset  Size  Field
─────── ───── ─────────────────────
0       4     version: u32
4       32    node_pubkey: Pubkey     ← needed for verification (validator identity)
36      32    authorized_withdrawer: Pubkey
68      ...   (rest of vote state)
```

**Validator identity (node_pubkey) is at byte offset 4.**

### Bond PDA Derivation

Seeds: `[BOND_SEED, config.toBytes(), voteAccount.toBytes()]`

Where `BOND_SEED` is the constant from the validator-bonds IDL:

```typescript
// From validator-bonds IDL constant "BOND_SEED"
const BOND_SEED = new Uint8Array([
  98, 111, 110, 100, 95, 97, 99, 99, 111, 117, 110, 116,
])
// = "bond_account" as bytes
```

Program ID: `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`

---

## Implementation Details

### File Structure

```
marinade-notifications/notification-service/
  subscriptions/
    bonds-subscription-verifier.ts    ← NEW: verifier implementation
    bonds-subscription-verifier.spec.ts ← NEW: unit tests
  configuration/
    config.service.ts                 ← ADD: SOLANA_RPC_URL config
  app.module.ts                       ← MODIFY: register verifier
```

### 1. Config Addition (`config.service.ts`) — DONE

Added Solana RPC URL to the existing ConfigService:

```typescript
public readonly solanaRpcUrl: string = getEnvVar(
  'SOLANA_RPC_URL',
  'https://api.mainnet-beta.solana.com',
)
```

Also added to `.env.example`:

```
# Solana RPC URL for on-chain account lookups (bonds subscription verification)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### 2. Verifier Implementation (`bonds-subscription-verifier.ts`) — DONE

The actual implementation differs from the original plan in several ways. Key changes are noted below.

**Imports — uses codama SDK + @solana/kit v6:**

```typescript
import {
  BOND_DISCRIMINATOR,
  fetchMaybeBond,
  VALIDATOR_BONDS_PROGRAM_ADDRESS,
} from '@marinade.finance/validator-bonds-codama'
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from '@solana/addresses'
import { getBase58Decoder } from '@solana/codecs-strings'
import { createSolanaRpc, fetchEncodedAccount } from '@solana/kit'
```

> **Change from plan:** Uses `@marinade.finance/validator-bonds-codama` (v3.1.0) for typed bond account access (`fetchMaybeBond`) and constants (`VALIDATOR_BONDS_PROGRAM_ADDRESS`, `BOND_DISCRIMINATOR`). No manual byte extraction for bond fields.

**Constants:**

```typescript
const BOND_SEED = new TextEncoder().encode('bond_account')
const MARINADE_CONFIG_ADDRESS = 'vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU'
const VOTE_PROGRAM_ID = 'Vote111111111111111111111111111111111111111'

const VOTE_NODE_PUBKEY_OFFSET = 4
const PUBKEY_LENGTH = 32

// Bond account field offsets (after 8-byte discriminator)
const BOND_CONFIG_OFFSET = 8
const BOND_VOTE_ACCOUNT_OFFSET = 40
const BOND_AUTHORITY_OFFSET = 72
```

> **Change from plan:** MARINADE_CONFIG_ADDRESS corrected to `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU` (was `4wQkiWr7RYk7xjVFMQrjwS5zVGJB5BEiARdHd5ipYbv` in original plan). BOND_SEED uses `TextEncoder` instead of raw byte array. Uses `VALIDATOR_BONDS_PROGRAM_ADDRESS` from codama instead of hardcoded string.

**POST/DELETE path — uses codama `fetchMaybeBond` + `fetchEncodedAccount`:**

```typescript
private async verifyWithAdditionalData(
  rpc: SolanaRpc,
  incomingPubkey: string,
  data: BondsAdditionalData,
): Promise<VerificationResult | null> {
  // 1. Derive bond PDA — integrity check
  const derivedBond = await deriveBondAddress(data.config_address, data.vote_account)
  if (derivedBond !== data.bond_pubkey) return null

  // 2. Fetch bond account via codama SDK (typed access, no manual offset)
  const maybeBond = await fetchMaybeBond(rpc, address(data.bond_pubkey))
  if (!maybeBond.exists) return null

  // 3. Fetch validator identity from vote account
  const identity = await fetchValidatorIdentity(rpc, data.vote_account)
  if (!identity) return null

  // 4. Dual-path auth check (mirrors on-chain check_bond_authority)
  const bondAuthority = String(maybeBond.data.authority)
  if (incomingPubkey === bondAuthority || incomingPubkey === identity) {
    return { verifyAgainstPubkey: incomingPubkey, userId: data.vote_account }
  }
  return null
}
```

> **Change from plan:** Bond authority accessed via `maybeBond.data.authority` (typed codama access) instead of manual byte extraction at offset 72. Vote account fetched via `fetchEncodedAccount` with identity extracted via `getAddressDecoder().decode()` instead of `getBase58Decoder().decode()`. Fetches are sequential (bond first, then vote) instead of parallel `Promise.all`.

**GET path — reverse lookup with class methods:**

```typescript
private async verifyByReverseLookup(rpc, incomingPubkey): Promise<VerificationResult | null> {
  // Step 1: Is pubkey a vote account with a bond?
  const voteResult = await this.checkAsVoteAccount(rpc, incomingPubkey)
  if (voteResult) return voteResult

  // Step 2: Is pubkey a bond authority?
  const authorityResult = await this.checkAsBondAuthority(incomingPubkey)
  if (authorityResult) return authorityResult

  // Step 3: Is pubkey a validator identity?
  const identityResult = await this.checkAsValidatorIdentity(rpc, incomingPubkey)
  if (identityResult) return identityResult

  return null
}
```

> **Change from plan:** Each step is a class method instead of module-level functions. Step 1 uses `fetchEncodedAccount` + `fetchMaybeBond` instead of raw `getAccountInfo`. Step 2 uses **3 memcmp filters** (discriminator + config + authority) instead of 2 (discriminator + authority), narrowing results to Marinade bonds only. Step 3 iterates vote accounts and checks bond existence for each (handles multiple vote accounts per identity).

**getProgramAccounts — raw fetch instead of typed @solana/kit RPC:**

```typescript
private async rpcGetProgramAccounts(
  programId: string,
  filters: Array<{ memcmp: { offset: number; bytes: string; encoding: string } }>,
): Promise<Array<{ pubkey: string; data: Uint8Array }>> {
  const response = await fetch(this.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getProgramAccounts',
      params: [programId, { encoding: 'base64', filters }],
    }),
  })
  // ... parse and return
}
```

> **Change from plan:** Uses raw `fetch` for `getProgramAccounts` instead of `@solana/kit` typed RPC. The @solana/kit v6 `getProgramAccounts` types proved too complex for our use case (BigInt offsets, strict generics). Raw fetch is simpler and equally functional.

**Module-level helpers:**

```typescript
// fetchValidatorIdentity: fetches vote account via fetchEncodedAccount,
// extracts identity via getAddressDecoder().decode() at offset 4
async function fetchValidatorIdentity(
  rpc,
  voteAccountAddress,
): Promise<string | null>

// deriveBondAddress: PDA derivation using VALIDATOR_BONDS_PROGRAM_ADDRESS from codama
async function deriveBondAddress(configAddress, voteAccount): Promise<string>
```

> **Change from plan:** `extractPubkey` helper replaced by `getAddressDecoder().decode()` (proper Solana address decoding). `findBondsByAuthority` and `findVoteAccountByIdentity` replaced by class methods using raw `fetch`.

### 3. Registration in `app.module.ts` — DONE

```typescript
import { BondsSubscriptionVerifier } from './subscriptions/bonds-subscription-verifier'
import type { SubscriptionVerifier } from './subscriptions/subscription-verifier.interface'

// Module imports uses a builder function:
;(SubscriptionsModule.forRoot(buildSubscriptionVerifiers()),
  // Builder function with passthrough mode for development/testing:
  function buildSubscriptionVerifiers(): Record<string, SubscriptionVerifier> {
    if (process.env.SUBSCRIPTION_VERIFIER_MODE === 'passthrough') {
      return {
        bonds: {
          async verifySubscription(incomingPubkey) {
            return {
              verifyAgainstPubkey: incomingPubkey,
              userId: incomingPubkey,
            }
          },
        },
      }
    }
    return {
      bonds: new BondsSubscriptionVerifier(
        process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      ),
    }
  })
```

> **Change from plan:** Uses a `buildSubscriptionVerifiers()` factory function that supports a `SUBSCRIPTION_VERIFIER_MODE=passthrough` mode for dev/testing (bypasses on-chain verification). RPC URL read from `process.env` directly (Option A from plan). The constructor takes `rpcUrl` as a parameter rather than reading env internally — this keeps the class testable.

---

## Verification Logic — Detailed Walkthrough

### Step-by-step for a subscribe request with bond authority:

1. Validator runs: `validator-bonds subscribe <vote_account> --type telegram --address @handle --authority /path/to/bond-authority.json`
2. CLI resolves bond from vote account → gets bond_pubkey, config_address, authority
3. CLI signs off-chain message with authority keypair
4. CLI POSTs to `/subscriptions` with `pubkey = authority_pubkey`
5. Controller calls `verifier.verifySubscription("authority_pubkey", "bonds", { config_address, vote_account, bond_pubkey })`
6. Verifier derives PDA, fetches bond account, extracts bond.authority at offset 72
7. `"authority_pubkey" === bond.authority` → **match**
8. Returns `{ verifyAgainstPubkey: "authority_pubkey", userId: "vote_account" }`
9. Controller verifies ed25519 signature → valid
10. Subscription stored with `user_id = vote_account`

### Step-by-step for a subscribe request with validator identity:

1. Validator runs: `validator-bonds subscribe <vote_account> --type telegram --address @handle --authority /path/to/validator-identity.json`
2. CLI resolves bond → same additional_data
3. CLI signs with validator identity keypair
4. CLI POSTs with `pubkey = identity_pubkey`
5. Verifier fetches vote account, extracts node_pubkey at offset 4
6. `"identity_pubkey" === node_pubkey` → **match**
7. Returns `{ verifyAgainstPubkey: "identity_pubkey", userId: "vote_account" }`
8. Same outcome — subscription keyed by vote_account

### Rejection case:

- If `pubkey` doesn't match either bond.authority or vote account node_pubkey → verifier returns `null` → controller responds 403 Forbidden

---

## GET /subscriptions — List Query (already solved in controller)

The uncommitted changes to `subscriptions.controller.ts` already solve the GET auth problem via `resolveListAuth()`:

```
GET /subscriptions?pubkey=<signing_pubkey>&notification_type=bonds
  Headers: x-solana-signature, x-solana-message
```

When `notification_type` is provided, the controller calls `verifier.verifySubscription(pubkey, notificationType, {})` to resolve `userId`. The signature is verified against `result.verifyAgainstPubkey` and subscriptions are queried by `result.userId`.

**Key detail:** The verifier receives **empty `additionalData`** on the GET path. This means the verifier cannot use the POST flow (derive PDA from config + vote_account). Instead, it must do a **reverse lookup** on-chain: given only the signing pubkey, discover what bond(s) it is associated with and return the corresponding vote_account as userId.

### Reverse Lookup Strategy (empty additionalData)

When `additionalData` is empty (or missing `config_address`/`vote_account`/`bond_pubkey`), the verifier determines what the pubkey represents by querying on-chain data in order:

```
Given: pubkey (the signer)
Goal:  find the associated vote_account → return as userId

Step 1: Is pubkey a vote account?
  ├── getAccountInfo(pubkey) → check if owner == Vote program
  ├── If yes → pubkey IS the vote_account
  │   ├── Derive bond PDA from (MARINADE_CONFIG, pubkey)
  │   ├── getAccountInfo(bondPDA) → verify bond exists
  │   └── Return { verifyAgainstPubkey: pubkey, userId: pubkey }
  └── If no → continue

Step 2: Is pubkey a bond authority?
  ├── getProgramAccounts(validatorBondsProgram, memcmp: [
  │     { offset: 0, bytes: BOND_DISCRIMINATOR },       // filter to Bond accounts
  │     { offset: 8, bytes: MARINADE_CONFIG_ADDRESS },   // filter to Marinade config
  │     { offset: 72, bytes: pubkey }                    // authority field
  │   ])
  ├── If found → extract vote_account from bond data (offset 40)
  └── Return { verifyAgainstPubkey: pubkey, userId: vote_account }

Step 3: Is pubkey a validator identity?
  ├── getProgramAccounts(VoteProgram, memcmp: [
  │     { offset: 4, bytes: pubkey }                  // node_pubkey field
  │   ])
  ├── If found → that account IS the vote_account
  │   ├── Derive bond PDA from (MARINADE_CONFIG, vote_account_address)
  │   ├── getAccountInfo(bondPDA) → verify bond exists
  │   └── Return { verifyAgainstPubkey: pubkey, userId: vote_account_address }
  └── If not found → return null (reject)
```

**Performance notes:**

- Step 1 is one `getAccountInfo` call — fast
- Step 2 uses `getProgramAccounts` on the validator-bonds program (~1000 accounts) with three memcmp filters (discriminator + Marinade config + authority) — very efficient, narrows to Marinade bonds only
- Step 3 uses `getProgramAccounts` on the Vote program with memcmp at offset 4 — more accounts but RPC handles it well with the filter
- Steps execute sequentially with early return, so the common case (bond authority) hits step 2 and returns

**Multiple bonds:** A single authority could manage bonds under different configs. For GET, we return the **first match**. If the user manages multiple bonds, they can subscribe for each one individually via POST (which has full additionalData).

**Default config:** For step 1 (vote account → derive bond PDA), we use `MARINADE_CONFIG_ADDRESS` as the default config. This covers the common case. If institutional config is needed, the user provides additionalData explicitly.

### Constants Needed for Reverse Lookup

```typescript
// Default Marinade config (used for bond PDA derivation when config not provided)
const MARINADE_CONFIG_ADDRESS = 'vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU'

// Bond account Anchor discriminator — imported from codama SDK
import { BOND_DISCRIMINATOR } from '@marinade.finance/validator-bonds-codama'
// = Uint8Array([224, 128, 48, 251, 182, 246, 111, 196])

// Byte offsets for bond account fields
const BOND_CONFIG_OFFSET = 8 // after 8-byte discriminator
const BOND_VOTE_ACCOUNT_OFFSET = 40 // 8 + 32 (config)
const BOND_AUTHORITY_OFFSET = 72 // 8 + 32 (config) + 32 (vote_account)
```

---

## Dependencies — DONE

### New/updated dependencies for marinade-notifications

```json
{
  "@marinade.finance/validator-bonds-codama": "^3.1.0",
  "@marinade.finance/web3js-kit": "^4.2.1",
  "@solana/kit": "^6.1.0"
}
```

- **`@marinade.finance/validator-bonds-codama`** (v3.1.0) — codama-generated client for validator-bonds program. Provides `fetchMaybeBond`, `VALIDATOR_BONDS_PROGRAM_ADDRESS`, `BOND_DISCRIMINATOR` with typed access to bond account fields. This was the most significant change from the original plan — using codama SDK eliminates manual byte extraction for bond accounts.
- **`@solana/kit`** (v6.1.0, not v2.1.0 as originally planned) — provides `createSolanaRpc`, `fetchEncodedAccount`. The repo already had `@solana/addresses`, `@solana/keys`, `@solana/codecs-strings`, `@solana/offchain-messages` at v6.1.0.
- **`@marinade.finance/web3js-kit`** (v4.2.1) — updated to match @solana/kit v6.

### No new dependencies for validator-bonds

The CLI side is already covered by the existing plan (IMPLEMENTATION_PLAN.md Part B) — it sends the correct `additional_data` in the subscription request.

---

## Already Implemented in marinade-notifications (uncommitted)

The following infrastructure changes already exist as uncommitted work in the `marinade-notifications` repo and do **not** need to be done again:

1. **Solana off-chain message signing** (`solana-auth.ts`) — `formatSolanaOffchainMessage()` and updated `verifySolanaSignature()` with `applicationDomain` parameter. Uses `@solana/offchain-messages`.

2. **Per-verifier `signingDomain`** (`subscription-verifier.interface.ts`) — optional field on the interface. Controller reads `verifier.signingDomain ?? OFFCHAIN_MESSAGE_DOMAIN` for signature verification.

3. **Message prefix validation** (`subscriptions.controller.ts`) — enforces `"Subscribe "` on POST, `"Unsubscribe "` on DELETE, `"ListSubscriptions "` on GET. Prevents cross-endpoint signature replay.

4. **GET verifier-based auth** (`subscriptions.controller.ts` → `resolveListAuth()`) — when `notification_type` is provided on GET, the controller routes through the verifier with empty `additionalData`. The verifier maps `pubkey → userId`, and subscriptions are queried by the resolved `userId`.

5. **`@solana/offchain-messages@^6.1.0`** dependency added to `package.json`.

6. **E2E tests updated** — all `signMessage()` calls pass `signerPubkeyBase58` for the off-chain format. New tests: prefix validation, verifier-based GET resolution, verifier rejection on GET.

---

## Error Handling

| Condition                                                                     | Verifier Return | HTTP Response             |
| ----------------------------------------------------------------------------- | --------------- | ------------------------- |
| Missing `config_address`, `vote_account`, or `bond_pubkey` in additional_data | `null`          | 403 Forbidden             |
| Derived bond PDA ≠ provided bond_pubkey                                       | `null`          | 403 Forbidden             |
| Bond account not found on-chain                                               | `null`          | 403 Forbidden             |
| Vote account not found on-chain                                               | `null`          | 403 Forbidden             |
| Vote account not owned by Vote program                                        | `null`          | 403 Forbidden             |
| Signing pubkey ≠ bond authority AND ≠ validator identity                      | `null`          | 403 Forbidden             |
| Solana RPC error (timeout, rate limit)                                        | Throws (500)    | 500 Internal Server Error |

**RPC resilience:** The verifier should use the `@Retry` pattern for RPC calls. A single RPC failure should not permanently block subscription. The retry should be short (2 attempts, 1s backoff) since this is a synchronous request path.

---

## Testing — DONE (19 unit tests)

### Unit Tests (`bonds-subscription-verifier.spec.ts`)

The test file uses `jest.mock` for all Solana dependencies and `jest.spyOn(global, 'fetch')` for `getProgramAccounts` calls.

**Mock strategy:**

- `@marinade.finance/validator-bonds-codama` — mocks `fetchMaybeBond`, `VALIDATOR_BONDS_PROGRAM_ADDRESS`, `BOND_DISCRIMINATOR`
- `@solana/kit` — mocks `createSolanaRpc` (returns `'mock-rpc'`), `fetchEncodedAccount`
- `@solana/addresses` — mocks `address`, `getProgramDerivedAddress`, `getAddressEncoder`, `getAddressDecoder`
- `@solana/codecs-strings` — mocks `getBase58Decoder`
- `global.fetch` — mocked via `jest.spyOn` for `rpcGetProgramAccounts` calls

#### POST path (8 tests)

1. **authorize bond authority** — pubkey matches `maybeBond.data.authority`
2. **authorize validator identity** — pubkey matches identity extracted from vote account
3. **reject unauthorized pubkey** — pubkey matches neither
4. **reject PDA mismatch** — derived PDA ≠ provided `bond_pubkey` (no RPC calls made)
5. **reject bond not found** — `fetchMaybeBond` returns `{ exists: false }`
6. **reject vote account not found** — `fetchEncodedAccount` returns `{ exists: false }`
7. **reject wrong vote account owner** — `programAddress` ≠ Vote program
8. **reject vote account data too short** — data length < 36 bytes

#### GET path / reverse lookup (6 tests)

9. **resolve as vote account with bond** — `fetchEncodedAccount` returns Vote-owned account, `fetchMaybeBond` confirms bond exists
10. **null when vote account exists but bond does not** — falls through all steps
11. **resolve as bond authority** — `getProgramAccounts` returns bond with vote_account at offset 40
12. **resolve as validator identity** — identity → vote account → bond exists
13. **null when no association found** — all lookups empty
14. **null when identity found but bond doesn't exist** — identity matches vote account but `fetchMaybeBond` returns `{ exists: false }`

#### Other tests (5 tests)

15. **signingDomain = validator-bonds program ID** — verifies `verifier.signingDomain`
16. **userId invariant** — both authority and identity paths return `userId = vote_account`
17. **empty additionalData → reverse lookup** — falls back to reverse lookup
18. **partial additionalData → reverse lookup** — missing fields triggers reverse lookup
19. **RPC error propagation** — `getProgramAccounts` error throws

### Test Helpers

```typescript
// Encodes address string as UTF-8 into 32-byte buffer (test-only encoding)
function fakeAddressBytes(addr: string): Uint8Array

// Builds vote account data with identity at offset 4
function makeVoteAccountData(identity: string): Uint8Array

// Builds bond account data with voteAccount at offset 40
function makeBondAccountData(voteAccount: string): Uint8Array

// Wraps result in a mock Response object for fetch spy
function makeFetchResponse(result: unknown): Response
```

### E2E Test

Extend the existing `subscriptions.e2e.ts` test suite:

- Register `BondsSubscriptionVerifier` with a local Solana test validator (or mocked RPC)
- Create a bond account on local test validator with known authority
- Subscribe with bond authority keypair → verify success
- Subscribe with validator identity keypair → verify success
- Subscribe with random keypair → verify 403
- Verify subscription userId = vote_account in both success cases

---

## Implementation Steps

```
Step 1: ✅ DONE — Off-chain message signing in solana-auth.ts
Step 2: ✅ DONE — signingDomain on SubscriptionVerifier interface
Step 3: ✅ DONE — GET verifier-based auth via resolveListAuth()

Step 4: ✅ DONE — Add SOLANA_RPC_URL to ConfigService + .env.example

Step 5: ✅ DONE — Add dependencies
  ├── @marinade.finance/validator-bonds-codama: ^3.1.0
  ├── @marinade.finance/web3js-kit: ^4.2.1
  └── @solana/kit: ^6.1.0

Step 6: ✅ DONE — Implement BondsSubscriptionVerifier
  ├── bonds-subscription-verifier.ts (299 lines)
  ├── POST/DELETE path: PDA derivation → fetchMaybeBond (codama) → fetchEncodedAccount → dual-path auth
  ├── GET path: reverse lookup via class methods (checkAsVoteAccount → checkAsBondAuthority → checkAsValidatorIdentity)
  ├── Raw fetch for getProgramAccounts (avoids @solana/kit type complexity)
  └── 19 unit tests pass (bonds-subscription-verifier.spec.ts, 476 lines)

Step 7: ✅ DONE — Register verifier in app.module.ts
  ├── buildSubscriptionVerifiers() factory with passthrough mode
  └── bonds: new BondsSubscriptionVerifier(process.env.SOLANA_RPC_URL || fallback)

Step 8: TODO — E2E test with mocked RPC
  ├── Extend subscriptions.e2e.ts
  ├── Mock Solana RPC responses for bond/vote accounts
  ├── Test POST with bond authority → subscription stored with userId=vote_account
  ├── Test POST with validator identity → same userId=vote_account
  ├── Test GET with bond authority → resolves to vote_account via reverse lookup
  ├── Test POST with random key → 403
  └── verify: full subscribe/unsubscribe/list flow works with bonds verifier
```

---

## Open Questions

1. **RPC URL for production** — Should the verifier use the same Solana RPC as other Marinade services, or a dedicated endpoint? Rate limiting and reliability are important since this runs in the subscription request path. The reverse lookup (GET path) makes 1–3 RPC calls per request.

2. **Caching bond/vote account data** — The reverse lookup on GET makes up to 3 RPC calls (getAccountInfo + getProgramAccounts + getProgramAccounts). A short TTL cache (5 min) on bond authority → vote_account mappings would reduce RPC load. Bond authority changes are rare. v1 skips caching; add if RPC load becomes an issue.

3. **Multiple bonds per authority** — The reverse lookup returns the first bond found. If a single authority manages multiple bonds (different configs), only one vote_account is returned for GET. This is acceptable for v1 since most validators have one bond. The reverse lookup step 2 now filters by MARINADE_CONFIG_ADDRESS, scoping results to Marinade bonds only.

## Resolved Questions

- **~~GET /subscriptions auth~~** — Resolved. `resolveListAuth()` routes GET through the verifier with empty additionalData. The reverse lookup strategy handles this.

- **~~Message replay attacks~~** — Resolved. Message prefix validation (`Subscribe`/`Unsubscribe`/`ListSubscriptions`) prevents cross-endpoint signature reuse.

- **~~Per-type signing domain~~** — Resolved. The `signingDomain` field on `SubscriptionVerifier` interface allows each notification type to specify its own off-chain message domain.

- **~~`@solana/kit` vs individual packages~~** — Resolved. Uses `@solana/kit` v6.1.0 (umbrella package). For `getProgramAccounts` specifically, raw `fetch` is used instead of the typed RPC client to avoid @solana/kit v6 type complexity.

- **~~Codama SDK vs raw byte extraction~~** — Resolved. Uses `@marinade.finance/validator-bonds-codama` v3.1.0 for typed bond account access. Bond fields accessed via `maybeBond.data.authority` etc. Only vote account identity still uses manual byte extraction (Vote program has no codama client).
