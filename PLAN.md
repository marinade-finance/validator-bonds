# Bond Risk Notification System — Full Context & Plan

> **Purpose of this file:** Load this into a new session to restore full project context.
> Last updated: 2026-02-23.
> Detailed design analysis also at: `/home/chalda/marinade/claude-summary/2026-02-13_bond-risk-notification-system-design.md`

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [How SAM Auction & Bonds Work](#2-how-sam-auction--bonds-work)
3. [This Repository (validator-bonds)](#3-this-repository-validator-bonds)
4. [marinade-notifications Service (Reference)](#4-marinade-notifications-service-reference)
5. [PSR Dashboard](#5-psr-dashboard)
6. [Institutional Staking Checker (Reference)](#6-institutional-staking-checker-reference)
7. [Team Discussion Summary](#7-team-discussion-summary)
8. [Agreed Architecture](#8-agreed-architecture)
9. [Work Items](#9-work-items)
10. [Open Design Questions](#10-open-design-questions)

---

## 1. Problem Statement

Validators in the SAM auction need proactive notification when their bond is at risk (underfunded relative to auction charges). If underfunded, they stop receiving Marinade stake.

**Current state:** No proactive notification to validators. Only:

- Internal Slack alerts via institutional-staking buildkite cron checker
- PSR dashboard shows bond health (green/yellow/red) — but only if validator visits

**Goal:** Notify validators through 4 channels: email, Telegram, PSR dashboard (pull), CLI (pull). This system should be generalizable to other notification types later.

---

## 2. How SAM Auction & Bonds Work

Source: https://marinade.finance/blog/more-control-better-yields-introducing-dynamic-commission-for-validators

### Auction Basics

- Validators create a **bond** (pre-funded vault on-chain) via validator-bonds CLI
- Bond is managed by on-chain **validator bonds program** (`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`)
- Bond funds are stored as stake accounts delegated to the validator's vote account (still earns rewards)
- Validators configure bidding: **static bid (CPMPE)** = lamports per 1000 SOL/epoch, and/or **dynamic commission** = lower commission rates specifically for Marinade stake (inflation, MEV, block rewards commissions)
- Marinade runs a **last-price auction** at each epoch start, ranking validators by yield potential
- The **effective bid** (actual charge) = lowest winning yield; higher bidders pay this lower rate, not their full bid

### Bond Funding Requirements

- Bond must cover projected charges for next **12 epochs** (configurable in ds-sam-pipeline auction-config.json `maxMarinadeTvlSharePerValidatorDec`)
- Safe starting point: **1 SOL per 2000 SOL** wanted from Marinade
- If bond underfunded: no new stake delegated, Marinade may start undelegating

### Charging Lifecycle

- Auction calculated at epoch X → bond charged at epoch X+1 (for epoch X results)
- Settlements from charges are **claimable for ~4 epochs**, unclaimed funds return to bond
- Bond charges come from: auction bidding costs + PSR penalties (protected staking rewards — compensation for validator downtime/commission issues)

### Staking Products (context)

- **Liquid Staking** — SOL → mSOL token, rewards increase mSOL/SOL price
- **Native Staking (Max Yield)** — stake accounts owned by user, Marinade only has delegate authority
- **Marinade Select** — KYB-ed validators only, same mechanics as native
- **Marinade Recipes** — earn rewards in other tokens
- Only Liquid + Native Max Yield participate in DS SAM auction

### Key External Repos

- **ds-sam** — auction calculation library: `https://github.com/marinade-finance/ds-sam`
- **ds-sam-pipeline** — epoch processing + auction config: `https://github.com/marinade-finance/ds-sam-pipeline`
- **delegation-strategy-2** — delegation data from previous epochs

---

## 3. This Repository (validator-bonds)

Path: `/home/chalda/marinade/validator-bonds`

### Repository Structure

```
programs/validator-bonds/    — Anchor on-chain contract (Rust)
packages/
  validator-bonds-sdk/       — TypeScript SDK
  validator-bonds-cli/       — TypeScript CLI (npm: @marinade.finance/validator-bonds-cli)
  validator-bonds-cli-core/  — Shared CLI core (announcements, banners, commands)
  validator-bonds-cli-institutional/ — Institutional CLI variant
api/                         — Rust OpenAPI service (https://validator-bonds-api.marinade.finance/docs)
bonds-collector/             — Rust CLI: loads on-chain bond data → YAML → PostgreSQL
settlement-distributions/    — CLIs for generating Settlement + Merkle Tree JSON data
settlement-pipelines/        — Rust CLI binaries for off-chain pipeline management
merkle-tree/                 — Generic Rust merkle tree library
migrations/                  — SQL schemas
scripts/                     — Pipeline and integration scripts
.buildkite/                  — CI/CD pipeline definitions
```

### bonds-collector (key data source for notifications)

- Location: `bonds-collector/src/`
- Runs as **hourly buildkite cron** (`.buildkite/collect-bonds.yml`)
- Single command: `collect-bonds` with `--bond-type bidding|institutional`
- Collects per bond: pubkey, vote_account, authority, cpmpe, max_stake_wanted, epoch, funded_amount, effective_amount, remaining_withdraw_request_amount, remaining_settlement_claim_amount, block_commission_bps, inflation_commission_bps, mev_commission_bps
- Outputs YAML → stored to PostgreSQL via `validator-bonds-api-cli store-bonds`

### Validator Bonds API

- Location: `api/`
- REST at `https://validator-bonds-api.marinade.finance`
- Endpoints: `/v1/bonds`, `/v1/protected-events`, `/v1/announcements`, `/docs`
- Backed by PostgreSQL, populated by bonds-collector
- DB connection: `--postgres-url` CLI arg (from `POSTGRES_URL` Buildkite secret env var) + `--postgres-ssl-root-cert` (public AWS RDS cert `https://truststore.pki.rds.amazonaws.com/eu-west-1/eu-west-1-bundle.pem`)
- Uses `tokio-postgres` with OpenSSL TLS, no AWS Param Store / Secrets Manager

### Existing CLI Announcements System

The CLI already has a production-grade announcement system. This is important context for the notification design.

**DB schema** (`migrations/0005-add-cli-announcements.sql`):

- `cli_announcements` table: `group_id` (latest group wins via `MAX(group_id)`), `group_order`, `title`, `text`, `enabled`, filtering by `operation_filter` (prefix match), `account_filter`, `type_filter` (sam/institutional)
- `cli_usage` table: fire-and-forget analytics recording account, operation, cli_version, cli_type

**API endpoint** (`api/src/handlers/cli_announcements.rs`):

- `GET /v1/announcements?account=&operation=&cli_version=&type=`
- Returns filtered announcements from latest group, records CLI usage (non-blocking)

**CLI integration** (`packages/validator-bonds-cli-core/src/`):

- `announcements.ts` — non-blocking background fetch in `preAction` hook (module-level promise caching)
- `banner.ts` — Unicode box rendering with ANSI color support, terminal-width responsive
- `commands/mainCommand.ts` — `preAction` starts fetch, `postAction` renders banners
- 1.5s timeout, silent failures, debug logs only
- Both SAM and Institutional CLI variants have announcements enabled
- API URL overridable via `ANNOUNCEMENTS_API_URL` env var or `--announcements-api-url` CLI flag

**Key design decisions in existing system:**

- Latest `group_id` only — roll out new announcements without cluttering old
- Prefix filtering — "configure" matches "configure-bond", "configure-config"
- Non-blocking — never delays CLI command execution
- Graceful degradation — CLI works fine if API unreachable

**Currently managed via direct SQL** — no admin UI exists.

### Settlement Pipeline Stages (buildkite)

1. **prepare-bid-distribution / prepare-bid-psr-distribution** — generate settlement JSON data
2. **init-settlements** — create Settlement accounts on-chain (by pubkey `bnwBM3RBrvnVmEJJAWEGXe81wtkzGvb9MMWjXcu99KR`)
3. **fund-settlements** — fund Settlement accounts from bond stake accounts
4. **claim-settlements** — distribute SOL to affected stakers (cron job)
5. **close-settlements** — reset/close expired Settlement accounts
6. **verify-settlements** — validate on-chain data vs GCS artifacts

### Settlement Pipeline Binaries (`settlement-pipelines/src/bin/`)

- `init_settlement.rs`, `fund_settlement.rs`, `claim_settlement.rs`, `close_settlement.rs`
- `list_claimable_epoch.rs`, `list_settlement.rs`, `verify_settlement.rs`, `merge_stakes.rs`

### Existing Reporting Framework (`settlement-pipelines/src/reporting.rs`)

- `PrintReportable` / `ReportSerializable` traits
- JSON reports: command, timestamp, status (success + error/warning/retryable counts), errors[], warnings[]
- Error severities: Warning, Error, RetryableError, Info
- Artifacts: `report.{command}.{attempt}.json`, `cumulative-report.{command}.json` → uploaded to GCS
- Existing **Slack notifications** per bond type

### On-Chain Events (Anchor, `programs/validator-bonds/src/events/`)

Bond: InitBond, ConfigureBond, FundBond, MintBond
Settlement: InitSettlement, FundSettlement, CloseSettlement, CancelSettlement, ClaimSettlementV2
Withdrawal: InitWithdrawRequest, ClaimWithdrawRequest, CancelWithdrawRequest
Stake: MergeStake, ResetStake, WithdrawStake

### CLI Commands (validator-bonds-cli)

Bond: init-bond, configure-bond, fund-bond, fund-bond-sol, show-bond, mint-bond, bond-address
Withdrawal: init-withdraw-request, claim-withdraw-request, cancel-withdraw-request
Settlement: close-settlement, reset-stake, show-settlement
Config: init-config, configure-config, show-config
Utility: show-event

### Scheduling

- `scheduler-bidding.yml` — triggers bidding flow at epoch boundary
- `scheduler-institutional.yml` — triggers institutional flow
- `collect-bonds.yml` — hourly bond data collection
- Concurrency gates prevent race conditions between pipeline stages

---

## 4. marinade-notifications Service (Reference)

> **Note:** This service will NOT be extended for bond notifications. Documented here as reference for the push channel design (email, Telegram) which will be built later.

Path: `/home/chalda/marinade/marinade-notifications`

### Architecture Overview

```
Producer → message-client → REST API → PostgreSQL Queue → Consumer → Delivery Channels
                                                               ↓
                                                        Intercom + Partner Email (SMTP)
```

### What It Does Now

- Handles **staking-rewards-report-status-v1** notifications (single topic)
- Receives messages via REST POST with JWT auth
- Validates against JSON Schema (Draft 2020-12)
- Queues to PostgreSQL (inbox/archive/DLQ per topic)
- Consumers process with exponential backoff retry (1min base, 6 retries, ~63 min to DLQ)

### Current Delivery Channels

1. **Intercom** — searches users by wallet prefix (`custom_attributes.walletID`), sends data events with idempotency
2. **Partner Email** — BigQuery-backed whitelist → SMTP (Mailgun, port 587) with Mustache templates and CSV attachments

### What It LACKS for Bond Notifications

- No Telegram integration
- No direct/simple email (current path goes through BigQuery whitelist)
- No pull API endpoint (GET outstanding notifications)
- No subscription management
- Only 1 topic (staking-rewards), tightly coupled to Intercom user model

### Key Files

```
/README.md, /SPEC.md, /ARCHITECTURE.md
/notification-service/.env.example
/notification-service/main.ts (NestJS bootstrap)
/notification-service/app.module.ts
/message-types/schemas/staking-rewards-report-status-v1.json
```

---

## 5. PSR Dashboard

Path: `/home/chalda/marinade/psr-dashboard`

### What It Shows

- **SAM Dashboard (/)** — validator target stake, commissions, winning/projected APY, constraints, bond health (green/yellow/red), effective bids, simulation mode
- **Validator Bonds (/bonds)** — all bonds with effective amounts, protected stake calculations
- **Protected Events (/protected-events)** — historical settlements/bond draws, event reasons (commission increase, low uptime, downtime), EPR loss, event status (DRYRUN/ESTIMATE/FACT)

### Current Announcement System (hardcoded)

The dashboard has a **hardcoded banner** system that needs to be refactored:

- **Data source:** `getBannerData()` function in `src/services/banner.tsx` — returns a static announcement object
- **Component:** `<Banner>` component in `src/components/banner/banner.tsx`
- **Current announcement:** "Validator Stake Cap Increasing — Step 1 Live at Epoch 924" (MIP-19 related)
- **Usage:** All three pages (sam.tsx, validator-bonds.tsx, protected-events.tsx) render `<Banner {...getBannerData()} />`
- **No API calls, no database** — purely hardcoded, requires code deploy to change

### APIs Consumed

- `https://validators-api.marinade.finance/validators` — validator data with epoch stats
- `https://validator-bonds-api.marinade.finance/bonds` — bond records
- `https://validator-bonds-api.marinade.finance/protected-events` — settlement events
- `https://scoring.marinade.finance/api/v1/scores/sam` — bid penalties and scores
- `https://validators-api.marinade.finance/rewards` — MEV/inflation rewards by epoch
- **ds-sam-sdk** (local dependency) — runs auction calculations and constraint evaluation client-side

### Bond Health Calculation

- Uses `bondBalanceRequiredForXEpochs()` from ds-sam-sdk
- Green: bond balance > 2 epochs of bidding costs
- Yellow: bond balance > 1 epoch but <= 2 epochs
- Red: bond balance <= 1 epoch
- Implemented in `bondColorState()` function in `src/services/sam.ts` (lines 342-373)
- Only displayed on the SAM page, not on the validator bonds page

### Key Files

```
src/pages/sam.tsx — SAM dashboard page
src/pages/validator-bonds.tsx — Bonds page
src/pages/protected-events.tsx — Protected events page
src/services/sam.ts — Auction logic, bond health colors
src/services/banner.tsx — Hardcoded banner data (TO BE REFACTORED)
src/components/banner/banner.tsx — Banner component
src/components/banner/banner.module.css — Banner styling (dark theme)
src/services/validator-with-bond.ts — Bond/validator data merging
src/services/protected-events.ts — Events parsing
```

---

## 6. Institutional Staking Checker (Reference)

Source: `https://github.com/marinade-finance/institutional-staking/blob/main/.buildkite/check-bonds.yml`

- Buildkite cron, runs hourly
- Checks bonds API for problems
- Reports to Slack
- **Deficit:** No state tracking — re-reports same issues daily. No change detection.

---

## 7. Team Discussion Summary

Source: Slack conversation between two developers (originally in Czech, summarized here).

### Key Decisions Made

- **Subscriptions only through CLI** — validators already need CLI for bond management
- **4 delivery channels:** email (push), Telegram (push), PSR dashboard (pull), CLI (pull)
- **Data is public** — no private key signing needed for subscriptions
- **Anti-spam:** email verification sufficient; Telegram requires phone number naturally
- **"Read" status is per delivery channel/address**, not per vote account — mitigates impersonation concern
- **No backend for PSR dashboard** — auction calculation stays client-side (ds-sam-sdk)
- **Auction reputation abandoned** — too complicated, never used in stake calculations

### Key Insights from Discussion

- bonds-collector is the **single source of truth** for bond data (hourly)
- It doesn't matter where bond changes happen (charge vs recharge); what matters is where notifications are collected
- A simple checker (like institutional-staking) that tracks state changes is sufficient; full messaging bus is overkill for now
- For PSR dashboard: pull-based = new channel; show unread notifications by vote account on visit
- For CLI: show notifications on any bond command mentioning a vote account; no login tracking; time-based cutoff for old messages
- ds-sam is public, so notification logic could potentially live there for community contributions

---

## 8. Agreed Architecture

### Core Principle: Announcements vs Notifications

Two **separate concepts**, same database, same API:

| Concept           | Source                        | Nature                           | Storage                        | Endpoint                           |
| ----------------- | ----------------------------- | -------------------------------- | ------------------------------ | ---------------------------------- |
| **Announcements** | Manual (admin app)            | General, global info             | `cli_announcements` (existing) | `GET /v1/announcements` (existing) |
| **Notifications** | Automated (Bond Risk Monitor) | Per-validator, chain-data-driven | `notifications` (new table)    | `GET /v1/notifications` (new)      |

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Validator Bonds PostgreSQL                          │
│                                                                        │
│  cli_announcements (existing)         notifications (new)              │
│  ├─ manual, via admin app             ├─ automated, via monitor        │
│  ├─ group_id, filters                 ├─ lifecycle (transient/stateful)│
│  └─ served by GET /v1/announcements   └─ served by GET /v1/notific... │
└───────────┬────────────────────────────────────────┬───────────────────┘
            │                                        │
   writes ↑ │ reads ↓                       writes ↑ │ reads ↓
            │                                        │
┌───────────┴───┐  ┌────────────────────┐  ┌─────────┴──────────┐
│  Admin App    │  │ Validator Bonds API│  │ Bond Risk Monitor  │
│  (React, VPN) │  │ (Rust, existing)   │  │ (TS, Buildkite)    │
│  CRUD via API │  │ serves both        │  │ step after bonds-  │
└───────────────┘  │ endpoints          │  │ collector, writes  │
                   └──────┬─────────────┘  │ to DB directly     │
                          │                └────────────────────┘
              ┌───────────┴───────────┐
              │                       │
     ┌────────┴────────┐    ┌────────┴────────┐
     │ CLI             │    │ PSR Dashboard   │
     │ GET /announce.. │    │ GET /announce.. │
     │ GET /notific..  │    │ GET /notific..  │
     │ (parallel)      │    │ (replaces       │
     └─────────────────┘    │  hardcoded)     │
                            └─────────────────┘
```

### Consumer Flow

Both CLI and PSR dashboard call **two separate endpoints** in parallel:

```
CLI (preAction/postAction hooks):
  1. GET /v1/announcements?type=sam&operation=X&account=Y  (existing, unchanged)
  2. GET /v1/notifications?vote_account=Y                   (new, parallel)
  → Render: announcements first, then notifications

PSR Dashboard (on page load):
  1. GET /v1/announcements?type=sam                         (replaces hardcoded getBannerData())
  2. GET /v1/notifications?vote_account=Y                   (when user views a validator)
  → Render: banner from announcements, then notification alerts per validator
```

### Component A: Bond Risk Monitor (Detection + Writing)

**TypeScript module** in this repo. TS is required to reuse `@marinade.finance/ds-sam-sdk` — the single source of truth for auction threshold calculations.

**Runs as:** Buildkite step after bonds-collector in `collect-bonds.yml`. Parameterized by `--bond-type bidding|institutional` (same pattern as bonds-collector). v1 runs only for `bidding`; code must be prepared for institutional extension.

**What it does on each run:**

1. Runs `DsSamSDK.runFinalOnly()` (same as PSR dashboard) to get full auction result with `AuctionValidator[]` objects — this provides `marinadeSamTargetSol`, `bondBalanceSol`, `revShare.bondObligationPmpe`, `revShare.totalPmpe`, and `bondObligationSafetyMult` from config
2. Reads current epoch from bonds DB (`SELECT MAX(epoch) FROM bonds WHERE bond_type = 'bidding'`) — bonds-collector fetches epoch via `rpc_client.get_epoch_info()` and stores it per bond record
3. Queries existing active notifications from `notifications` table
4. Queries protected-events API for settlement data (BQ table `psr_settlements` contains ALL settlement types: Bidding, ProtectedEvent, BidTooLowPenalty, BlacklistPenalty, InstitutionalPayout — not just PSR despite the table name)
   NOTE: this should be changed to call the validator bonds API instead of the direct call of BQ Query
5. Queries bonds API for current `remaining_witdraw_request_amount` per bond (one WithdrawRequest PDA per bond, so changes between runs reliably indicate new withdrawal creation)
6. For each validator, compares current state with existing notifications:
   - **Creates** new notifications when conditions are detected (INSERT)
   - **Updates** existing stateful notifications when severity changes (UPDATE severity, message, details, updated_at)
   - **Resolves** stateful notifications when condition clears (SET `resolved_at = NOW()`)
7. Dedup key: `(vote_account, bond_pubkey, event_type)` — one active notification per bond per event type. This supports validators with multiple bonds (bidding + institutional) without interference.

**Event type configuration:** Parameterizable on monitor startup (not a DB table). Maps event_type → { lifecycle, default_severity, expires_after_epochs }.

**Events to detect:**

| Event                 | Severity         | Lifecycle            | Data Source                      | Trigger                                                            |
| --------------------- | ---------------- | -------------------- | -------------------------------- | ------------------------------------------------------------------ |
| bond_health_warning   | warning/critical | stateful (mutable)   | ds-sam-sdk auction result        | YELLOW: balance < 2-epoch requirement; RED: balance < 1-epoch req. |
| auction_position_lost | warning          | stateful             | ds-sam-sdk auction result        | `marinadeSamTargetSol === 0`                                       |
| settlement_charged    | info             | transient (1 epoch)  | Protected-events API (BQ cache)  | New settlement for this validator in current epoch                 |
| large_settlement      | warning          | transient (2 epochs) | Protected-events API + bond data | Settlement amount > X% of bond balance (default 20%, configurable) |
| withdrawal_created    | info             | transient (3 epochs) | Bonds API diff between runs      | `remaining_witdraw_request_amount` increased from previous run     |

**`bond_health_warning` state machine** — single event type with mutable severity (not two separate types):

| Current Health | Active notification? | Action                                               |
| -------------- | -------------------- | ---------------------------------------------------- |
| GREEN          | No                   | Nothing                                              |
| GREEN          | Yes                  | Resolve (`resolved_at = NOW()`)                      |
| YELLOW         | No                   | Create with `severity = warning`                     |
| YELLOW         | Yes, warning         | Nothing (already notified)                           |
| YELLOW         | Yes, critical        | Update severity → warning, update message + details  |
| RED            | No                   | Create with `severity = critical`                    |
| RED            | Yes, critical        | Nothing (already notified)                           |
| RED            | Yes, warning         | Update severity → critical, update message + details |

Rationale for single type: pull-based consumers care about current state, not transition history. One notification per problem avoids overlapping/conflicting notifications for the same underlying issue.

**Withdrawal detection:** If `remaining_witdraw_request_amount > 0` AND no active/non-expired `withdrawal_created` notification exists for this bond → create one. Since it's transient (3 epochs), it won't re-fire until the old one expires.

**Idempotency:** Each notification create/update/resolve is wrapped in a DB transaction. If the monitor crashes mid-run, some validators may not get processed — they'll be picked up on the next hourly run. The unique dedup index (`idx_notifications_dedup`) prevents duplicate inserts if the monitor re-runs. No partial/corrupt notification state is possible.

**Writes directly to PostgreSQL** (same DB as bonds API, same connection pattern: `POSTGRES_URL` env var + RDS SSL cert).

### Component B: Notifications Table + API Endpoint

**New DB table** (`notifications`):

```sql
CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    vote_account TEXT NOT NULL,
    bond_pubkey TEXT,
    event_type TEXT NOT NULL,          -- 'bond_health_warning', 'settlement_charged', etc.
    severity TEXT NOT NULL,            -- 'info', 'warning', 'critical'
    lifecycle TEXT NOT NULL,           -- 'transient' | 'stateful'
    message TEXT NOT NULL,             -- human-readable message (written by monitor)
    epoch INTEGER NOT NULL,            -- epoch when created
    expires_epoch INTEGER,             -- for transient: auto-expire after this epoch
    resolved_at TIMESTAMPTZ,           -- for stateful: NULL = active, set when resolved
    details JSONB,                     -- event-specific structured payload (PostgreSQL binary JSON — stored as binary internally, read/written as regular JSON)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()  -- tracks severity/message changes for stateful notifications
);

CREATE INDEX idx_notifications_vote_account ON notifications (vote_account);
CREATE INDEX idx_notifications_active ON notifications (vote_account, event_type) WHERE resolved_at IS NULL AND (expires_epoch IS NULL OR expires_epoch >= 0);
CREATE UNIQUE INDEX idx_notifications_dedup ON notifications (vote_account, bond_pubkey, event_type) WHERE resolved_at IS NULL;
```

The `details` JSONB field stores structured data per event type. Consumers can use `message` for simple display or `details` for richer rendering (e.g., dashboard formatting numbers with links). Examples:

- `bond_health_warning`: `{ "effective_amount_sol": 2.3, "required_one_epoch_sol": 5.1, "required_two_epochs_sol": 10.2, "target_stake_sol": 50000, "health_color": "red" }`
- `settlement_charged`: `{ "amount_sol": 0.5, "reason": "Bidding", "epoch": 950 }`
- `auction_position_lost`: `{ "previous_target_stake_sol": 50000 }`
- `withdrawal_created`: `{ "requested_amount_sol": 10.0, "remaining_amount_sol": 10.0 }`

**New API endpoint** in Validator Bonds API (Rust):

- `GET /v1/notifications?vote_account=X&since_epoch=N&severity=...&include_resolved=true&limit_per_validator=N`
- Returns: active stateful notifications (`resolved_at IS NULL`) + non-expired transient (`expires_epoch >= current_epoch`)
- `include_resolved=true`: also returns recently resolved stateful notifications (for "bond health restored" messages)
- `limit_per_validator=N`: cap notifications per validator, ordered by severity DESC (critical → warning → info) then `created_at DESC` — uses `ROW_NUMBER() OVER (PARTITION BY vote_account ORDER BY ...)` window function
- Response includes current `epoch` in envelope so consumers don't need a separate call

**API response schema:**

```json
{
  "notifications": [
    {
      "id": 42,
      "vote_account": "Vote111...",
      "bond_pubkey": "Bond222...",
      "event_type": "bond_health_warning",
      "severity": "critical",
      "lifecycle": "stateful",
      "message": "Bond balance covers less than 1 epoch of auction charges. Top up to avoid losing stake.",
      "details": {
        "effective_amount_sol": 2.3,
        "required_one_epoch_sol": 5.1,
        "health_color": "red"
      },
      "epoch": 950,
      "resolved_at": null,
      "created_at": "2026-02-20T12:00:00Z",
      "updated_at": "2026-02-20T18:00:00Z"
    }
  ],
  "epoch": 950
}
```

**Notification lifecycle types:**

| Lifecycle     | Behavior                                                                                         | Example                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **transient** | Auto-expires after `expires_epoch`. Fire-and-forget.                                             | settlement_charged (1 epoch), withdrawal_created (3 epochs)                          |
| **stateful**  | Persists until condition resolves. Monitor sets `resolved_at`. Severity can be updated in-place. | bond_health_warning (until bond topped up), auction_position_lost (until target > 0) |

### Component C: Announcements Admin CRUD

**New API endpoints** in Validator Bonds API (Rust), protected by API key:

- `POST /v1/announcements` — create announcement
- `PUT /v1/announcements/:id` — update announcement
- `DELETE /v1/announcements/:id` — delete announcement
- `GET /v1/announcements` stays public (CLI/dashboard need unauthenticated access)

**Auth:** Static API key via `ADMIN_API_KEY` env var. Mutation endpoints require `Authorization: Bearer <key>`. Defense in depth: VPN + API key.

### Component D: Admin React App

**Simple React app** for managing announcements (CRUD, enable/disable, view current state).

**Features:**

- Table view of all announcements (grouped by group_id)
- Enable/disable toggle
- Create/edit/delete announcements
- Shows which announcements are currently visible (latest group, enabled)

**Deployment:** Container behind internal ALB, restricted to VPN via security group. GitHub Actions builds and pushes container. DB connection via `POSTGRES_URL` env var (same pattern as API). Consult devops for specific infra (ECS/EKS, ALB, security groups).

### Component E: PSR Dashboard Refactor

Replace hardcoded `getBannerData()` in `src/services/banner.tsx` with API-driven data:

**Announcements (global banner):**

- Replace `getBannerData()` with `GET /v1/announcements?type=sam` on page load
- Render as top-of-page banner (same visual style as current hardcoded banner)
- Applies to all three pages (SAM, Validator Bonds, Protected Events)

**Per-validator notifications (table integration):**

- Call `GET /v1/notifications?vote_account=X` for validators displayed in the table
- Expand the existing bond health color column with notification context:
  - Bond health color (green/yellow/red) continues to be computed client-side from ds-sam-sdk (existing logic)
  - Add tooltip to health column showing `message` text from notifications (explains WHY the health is degraded)
  - For non-health notifications (settlement_charged, withdrawal_created), add a small icon/badge in the validator row to signal activity
- Use `limit_per_validator` param to bound API response size

### Component F: CLI Enhancement

Add parallel fetch of `/v1/notifications` alongside existing `/v1/announcements`:

1. In `preAction` hook: start both fetches in background (same non-blocking pattern)
2. In `postAction` hook: render announcements (existing), then notifications (new)

**Backwards compatibility:** The notification fetch MUST follow the same graceful degradation pattern as the existing announcements fetch — silent failure on 404/timeout/network error, debug logs only. This ensures the new CLI works against older API servers that don't have `/v1/notifications` yet (e.g., during rolling deployments).

### Push Channels (Future — v2)

Email and Telegram delivery are **out of scope for v1 pull channels** but the architecture supports them:

- Subscription management via CLI commands (`subscribe-notifications`, etc.)
- `subscriptions` table in same PostgreSQL
- Separate consumer processes that poll `notifications` table and deliver to subscribed channels
- Could be added to this repo or to a separate service

---

## 9. Work Items

| #   | Item                                    | Scope                              | Notes                                                                       |
| --- | --------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| 1   | DB migration: `notifications` table     | validator-bonds repo               | New migration file                                                          |
| 2   | API: `GET /v1/notifications` endpoint   | api/ (Rust)                        | Query with vote_account, since_epoch, severity filters                      |
| 3   | API: CRUD endpoints for announcements   | api/ (Rust)                        | POST/PUT/DELETE, API key auth via `ADMIN_API_KEY`                           |
| 4   | Bond Risk Monitor                       | New TS package in repo             | Runs as Buildkite step after bonds-collector, writes to notifications table |
| 5   | CLI enhancement: fetch notifications    | packages/validator-bonds-cli-core/ | Parallel fetch + render after announcements                                 |
| 6   | PSR dashboard: replace hardcoded banner | psr-dashboard repo                 | Call `/v1/announcements` instead of `getBannerData()`                       |
| 7   | PSR dashboard: show notifications       | psr-dashboard repo                 | Call `/v1/notifications` per validator                                      |
| 8   | Admin React app                         | New repo or subdirectory           | CRUD UI for announcements, VPN-only deployment                              |
| 9   | Buildkite pipeline update               | `.buildkite/collect-bonds.yml`     | Add monitor step after bonds-collector                                      |

---

## 10. Open Design Questions

### Resolved Questions

| Question                                    | Decision                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend marinade-notifications or build new? | Neither — notifications live in validator-bonds API (same DB, same service)                                                                                                                                                                                                                                                  |
| Where does the checker run?                 | Buildkite step after bonds-collector                                                                                                                                                                                                                                                                                         |
| Pull channels — same or different API?      | Same Validator Bonds API, two separate endpoints                                                                                                                                                                                                                                                                             |
| Notification lifecycle                      | Per-type config: transient (time-based expiry) or stateful (resolved when condition clears)                                                                                                                                                                                                                                  |
| Admin auth                                  | Static API key + VPN restriction                                                                                                                                                                                                                                                                                             |
| Checker language                            | TypeScript — required to reuse ds-sam-sdk (single source of truth for auction calculations)                                                                                                                                                                                                                                  |
| Type config storage                         | Parameterizable on monitor startup, not DB table                                                                                                                                                                                                                                                                             |
| Monitor data source for bond health         | Full `DsSamSDK.runFinalOnly()` — same calculation as PSR dashboard. Needs `AuctionValidator[]` with `marinadeSamTargetSol`, `bondBalanceSol`, `revShare.bondObligationPmpe`, `revShare.totalPmpe`. The formula: `required = stakeSol * ((bondObligationPmpe / 1000 * bondObligationSafetyMult) * epochs + totalPmpe / 1000)` |
| Monitor data source for settlements         | Protected-events API (cached from BQ table `psr_settlements` which contains ALL settlement types — Bidding, ProtectedEvent, BidTooLowPenalty, BlacklistPenalty, InstitutionalPayout — not just PSR despite the name)                                                                                                         |
| Monitor data source for withdrawals         | Diff `remaining_witdraw_request_amount` between bonds-collector runs. Reliable because there is one WithdrawRequest PDA per bond — if the amount increased, a withdrawal was created                                                                                                                                         |
| Current epoch source                        | Bonds-collector stores epoch per bond record via `rpc_client.get_epoch_info()`. Monitor reads `SELECT MAX(epoch) FROM bonds WHERE bond_type = 'bidding'` — no separate RPC call needed                                                                                                                                       |
| Bond health event model (Q3)                | Single `bond_health_warning` event type with mutable severity (not two separate types). Severity updated in-place when health changes. See state machine in Component A                                                                                                                                                      |
| Dedup key                                   | `(vote_account, bond_pubkey, event_type)` — supports multiple bonds per validator without interference                                                                                                                                                                                                                       |
| Notification message formatting (Q4)        | Monitor writes both `message` (human-readable text) and `details` (structured JSONB). CLI uses `message` for simple display. Dashboard can use `details` for richer rendering. No message logic duplication in consumers                                                                                                     |
| API response bounding (Q5)                  | `limit_per_validator=N` query parameter. Ordered by severity DESC then `created_at DESC`. Uses `ROW_NUMBER() OVER (PARTITION BY vote_account ...)`                                                                                                                                                                           |
| Resolved notifications display (Q6)         | Available via `&include_resolved=true` query param, not in default response. All fields including `resolved_at` and `epoch` are always returned for active notifications                                                                                                                                                     |
| ds-sam-sdk API surface (Q8)                 | Confirmed: `DsSamSDK` constructor takes config from `loadSamConfig()`, `runFinalOnly()` returns `AuctionResult` with `AuctionValidator[]`. `bondBalanceRequiredForXEpochs(stakeSol, validator, epochs, bondObligationSafetyMult)` imported from sdk. Dashboard uses `@marinade.finance/ds-sam-sdk` package                   |
| Bond type support                           | v1 monitors bidding bonds only. Code is parameterized by `--bond-type bidding\|institutional` (same pattern as bonds-collector). Shared infrastructure (table, API, CLI, dashboard) works for both from day one. Only detection logic is bond-type-specific                                                                  |
| CLI backwards compatibility                 | Notification fetch follows same graceful degradation as announcements — silent on 404/timeout, debug logs only. New CLI works against old API servers                                                                                                                                                                        |
| CLI notification rendering (Q1)             | Grouped Unicode box titled "Notifications (N)" with severity-colored prefixes (`[CRITICAL]`, `[WARNING]`, `[INFO]`). Uses `message` field from API. Rendered after announcement box                                                                                                                                          |
| PSR dashboard notification UX (Q2)          | Global announcements replace hardcoded banner. Per-validator notifications shown as icon/badge in table row + tooltip with `message` in bond health column                                                                                                                                                                   |
| `large_settlement` threshold                | Configurable, default 20% of bond balance                                                                                                                                                                                                                                                                                    |
| Monitor idempotency                         | Each notification create/update/resolve in a DB transaction. Unique dedup index prevents duplicates on re-run. Crash mid-run → unprocessed validators picked up next hourly run                                                                                                                                              |
| v1 phasing (Q10)                            | v1a: DB + API + Monitor + CLI. v1b: Dashboard. v1c: Admin app. v2: Push channels. Within v1a: migration → API → monitor → CLI → Buildkite                                                                                                                                                                                    |

### v1a Implementation Order

Dependencies flow top-down — each step unblocks the next:

1. DB migration (notifications table) — unblocks everything
2. API endpoint (`GET /v1/notifications`) — can test with manual DB inserts
3. Bond Risk Monitor — now writes real data
4. CLI enhancement — consumes the API
5. Buildkite pipeline update — wires the monitor into collect-bonds

### Open Questions — Blocked on External Input

**Q7: Admin app deployment specifics — consult devops**

The admin React app needs:

- Container deployment (ECS/EKS?)
- Internal ALB with VPN-only security group
- GitHub Actions CI/CD pipeline
- `POSTGRES_URL` env var injection

Questions for devops:

- What's the standard pattern for internal-only web apps at Marinade?
- Is there an existing VPN-restricted ALB or ingress to reuse?
- Preferred container registry (ECR?)
- How are env vars/secrets injected in the target environment?

**Q9: Telegram bot setup (v2)**

- Is `@sam_mnde_bot` already created?
- Who manages the bot token?
- This is v2 (push channels) but token creation has lead time.

---

## Related File Paths (for quick reference)

| What                               | Path                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| This repo (validator-bonds)        | `/home/chalda/marinade/validator-bonds`                                                                  |
| marinade-notifications (reference) | `/home/chalda/marinade/marinade-notifications`                                                           |
| PSR dashboard                      | `/home/chalda/marinade/psr-dashboard`                                                                    |
| Design analysis doc                | `/home/chalda/marinade/claude-summary/2026-02-13_bond-risk-notification-system-design.md`                |
| Institutional staking checker      | `https://github.com/marinade-finance/institutional-staking/blob/main/.buildkite/check-bonds.yml`         |
| ds-sam auction lib                 | `https://github.com/marinade-finance/ds-sam`                                                             |
| ds-sam pipeline + config           | `https://github.com/marinade-finance/ds-sam-pipeline`                                                    |
| Blog post (SAM auction)            | `https://marinade.finance/blog/more-control-better-yields-introducing-dynamic-commission-for-validators` |
| Bonds API                          | `https://validator-bonds-api.marinade.finance/docs`                                                      |
| Validators API                     | `https://validators-api.marinade.finance/validators`                                                     |
| Scoring API                        | `https://scoring.marinade.finance/api/v1/scores/sam`                                                     |
| GCS settlement data                | `https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet`                      |

### Key Files — CLI Announcements System

| Component               | Location                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| DB Schema               | `migrations/0005-add-cli-announcements.sql`                                   |
| API Handler             | `api/src/handlers/cli_announcements.rs`                                       |
| API Repository          | `api/src/repositories/cli_announcement.rs`                                    |
| API Bootstrap           | `api/src/bin/api.rs`                                                          |
| CLI Fetch Logic         | `packages/validator-bonds-cli-core/src/announcements.ts`                      |
| CLI Render Logic        | `packages/validator-bonds-cli-core/src/banner.ts`                             |
| CLI Integration         | `packages/validator-bonds-cli-core/src/commands/mainCommand.ts`               |
| SAM CLI Entry           | `packages/validator-bonds-cli/src/index.ts`                                   |
| Institutional CLI Entry | `packages/validator-bonds-cli-institutional/src/index.ts`                     |
| Tests                   | `packages/validator-bonds-cli/__tests__/test-validator/announcements.spec.ts` |

### Key Files — PSR Dashboard

| Component               | Location                                            |
| ----------------------- | --------------------------------------------------- |
| Hardcoded banner data   | `psr-dashboard/src/services/banner.tsx`             |
| Banner component        | `psr-dashboard/src/components/banner/banner.tsx`    |
| Bond health calculation | `psr-dashboard/src/services/sam.ts` (lines 342-373) |
| SAM page                | `psr-dashboard/src/pages/sam.tsx`                   |
| Validator bonds page    | `psr-dashboard/src/pages/validator-bonds.tsx`       |
| Protected events page   | `psr-dashboard/src/pages/protected-events.tsx`      |
