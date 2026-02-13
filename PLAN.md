# Bond Risk Notification System — Full Context & Plan

> **Purpose of this file:** Load this into a new session to restore full project context.
> Last updated: 2026-02-13.
> Detailed design analysis also at: `/home/chalda/marinade/claude-summary/2026-02-13_bond-risk-notification-system-design.md`

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [How SAM Auction & Bonds Work](#2-how-sam-auction--bonds-work)
3. [This Repository (validator-bonds)](#3-this-repository-validator-bonds)
4. [marinade-notifications Service](#4-marinade-notifications-service)
5. [PSR Dashboard](#5-psr-dashboard)
6. [Institutional Staking Checker (Reference)](#6-institutional-staking-checker-reference)
7. [Team Discussion Summary](#7-team-discussion-summary)
8. [Proposed Architecture — 3 Components](#8-proposed-architecture--3-components)
9. [Open Questions](#9-open-questions)

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

Path: `/home/chalda/tmp/validator-bonds`

### Repository Structure

```
programs/validator-bonds/    — Anchor on-chain contract (Rust)
packages/
  validator-bonds-sdk/       — TypeScript SDK
  validator-bonds-cli/       — TypeScript CLI (npm: @marinade.finance/validator-bonds-cli)
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
- Endpoints: `/bonds`, `/protected-events`, `/docs`
- Backed by PostgreSQL, populated by bonds-collector

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

## 4. marinade-notifications Service

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

### REST API

- `POST /staking-rewards-report-status-v1` — submit notification (JWT auth)
- `GET /health` — health check
- `GET /metrics` — Prometheus metrics
- `GET /docs` — Swagger (dev only)

### Message Envelope

```typescript
interface Message<T> {
  header: {
    producer_id: string
    message_id: string
    created_at: number
    received_at?: number
    topic?: string
  }
  payload: T
}
```

### Current Payload (staking-rewards-report-status-v1)

```typescript
{ withdraw: string, mtime: number, status: ReportStatusV1, error: string, to_slot: number, to_block_time: number }
```

Status enum: Missing | Requested | Processing | Ready | VerificationSkipped | Verifying | Verified | Error | VerificationFailed

### 3rd Party Integrations

- **Intercom API** — user lookup + event tracking (Bearer token)
- **BigQuery** — partner whitelist + email templates (Google Cloud SDK)
- **Staking Rewards API** — CSV report data
- **SMTP (Mailgun)** — email delivery (nodemailer, TLS/STARTTLS)
- **PostgreSQL** — message queue (Slonik)
- **Elastic APM** — distributed tracing (prod)
- **Prometheus** — metrics (prom-client)

### Key Configuration (env vars)

```
POSTGRES_URL, INTERCOM_API_TOKEN, API_SECRET, ALLOWED_USERS
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
EMAIL_FROM=Marinade Finance <reports@marinade.finance>
BIGQUERY_PROJECT_ID=data-store-406413
CONSUMER_POLL_INTERVAL_MS=1000, CONSUMER_RETRY_MINUTES=1, CONSUMER_MAX_RETRIES=6
```

### Queue Tables (per topic)

- `{topic}_inbox` — unprocessed messages
- `{topic}_archive` — successfully delivered (with trace metadata)
- `{topic}_dlq` — failed after max retries

### Schema System

- JSON Schema Draft 2020-12 per topic version
- Generates TypeScript + Rust code (committed to git)
- Client-side + gateway-side validation (Ajv for TS, jsonschema for Rust)

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

### APIs Consumed

- `https://validators-api.marinade.finance/validators` — validator data with epoch stats
- `https://validator-bonds-api.marinade.finance/bonds` — bond records
- `https://validator-bonds-api.marinade.finance/protected-events` — settlement events
- `https://scoring.marinade.finance/api/v1/scores/sam` — bid penalties and scores
- `https://validators-api.marinade.finance/rewards` — MEV/inflation rewards by epoch
- **ds-sam-sdk** (local dependency) — runs auction calculations and constraint evaluation client-side

### Bond Health Calculation

- Uses `bondBalanceRequiredForXEpochs()` from ds-sam-sdk
- Green/yellow/red status based on effective_amount vs required amount
- Bond effective_amount = funded_amount - cumulative_payouts

### Key Files

```
src/pages/sam.tsx — SAM dashboard page
src/pages/validator-bonds.tsx — Bonds page
src/services/sam.ts — Auction logic and constraint formatting
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

### Unresolved from Discussion

- Whether to extend marinade-notifications or build new
- Exact Telegram bot setup (`@sam_mnde_bot` mentioned but unclear if created)
- How to handle ds-sam library version updates across multiple consumers

---

## 8. Proposed Architecture — 3 Components

### Component A: Bond Risk Monitor (Detection)

**Standalone checker service** that runs periodically (hourly, after bonds-collector):

1. Queries Validator Bonds API for current bond states
2. Compares with previous state (stored in DB)
3. Detects threshold crossings and state changes
4. Emits notification messages to the notification service

**Events to detect:**

| Event                               | Severity | Trigger                                   |
| ----------------------------------- | -------- | ----------------------------------------- |
| Bond health degraded (green→yellow) | Warning  | effective_amount < required_for_12_epochs |
| Bond health critical (yellow→red)   | Critical | effective_amount < required_for_4_epochs  |
| Settlement charged                  | Info     | New settlement created against bond       |
| Large settlement charge             | Warning  | Settlement > X% of bond balance           |
| Withdrawal request created          | Info     | Someone initiated withdrawal              |
| Bond nearly depleted                | Critical | effective_amount below minimum threshold  |
| Auction position lost               | Warning  | SAM target dropped to 0                   |

**Why standalone (not embedded in bonds-collector):**

- Single responsibility: bonds-collector collects data, monitor evaluates risk
- Can be written in TypeScript to reuse ds-sam-sdk for threshold calculations
- Needs own state tracking DB table regardless
- Can run as buildkite step after collect-bonds or as independent cron

**State tracking options:**

- PostgreSQL table in notification service DB
- Dedup via message_id = hash(vote_account + epoch + event_type)

### Component B: Notification Delivery

**Hybrid approach:** extend marinade-notifications with new topic + new consumers.

**What to add:**

1. New schema: `bond-risk-notification-v1`
   ```json
   {
     "header": { "producer_id": "bond-risk-monitor", "message_id": "uuid", "created_at": 1234 },
     "payload": {
       "vote_account": "...",
       "bond_pubkey": "...",
       "event_type": "bond_health_degraded | bond_health_critical | settlement_charged | ...",
       "severity": "info | warning | critical",
       "epoch": 123,
       "details": { ... }
     }
   }
   ```
2. **Telegram consumer** (new) — Telegram Bot API `sendMessage` to subscribed chat_ids
3. **Simplified email consumer** (new) — direct SMTP, Mustache templates baked in service, no BigQuery whitelist
4. **Pull API endpoint** (new) — `GET /bond-notifications?vote_account=X&since=<timestamp>` for PSR dashboard + CLI

**Alternative:** Build a new lightweight notification service if marinade-notifications is in maintenance mode. Core queue logic is ~200 lines of PG queries.

### Component C: Subscription Manager

**CLI-only subscription flow:**

```bash
validator-bonds-cli subscribe-notifications --vote-account <VA> --channel email --address user@example.com
validator-bonds-cli subscribe-notifications --vote-account <VA> --channel telegram
validator-bonds-cli list-subscriptions --vote-account <VA>
validator-bonds-cli unsubscribe-notifications --vote-account <VA> --channel email --address user@example.com
```

**Storage:** `subscriptions` table in notification service PostgreSQL:

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  vote_account TEXT NOT NULL,
  channel TEXT NOT NULL,          -- 'email' | 'telegram'
  address TEXT NOT NULL,          -- email address or telegram chat_id
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vote_account, channel, address)
);
```

**Auth:** Email verification (confirmation link/code). Telegram: phone number = natural anti-spam. No private key signing needed.

**REST endpoints on notification service:**

- `POST /subscriptions` — create subscription
- `DELETE /subscriptions` — remove subscription
- `POST /subscriptions/verify` — verify email/telegram

### Data Flow

```
                                   ┌─────────────────────┐
                                   │   bonds-collector    │
                                   │   (hourly cron)      │
                                   └──────────┬──────────┘
                                              │ stores data
                                              ▼
                                   ┌─────────────────────┐
                                   │  Validator Bonds API │
                                   │  (PostgreSQL + REST) │
                                   └──────────┬──────────┘
                                              │ queries
                                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Bond Risk Monitor (new)                        │
│  - Queries bonds API hourly                                      │
│  - Compares with previous state (stored in DB)                   │
│  - Detects threshold crossings, settlements, etc.                │
│  - Emits notification messages                                   │
└──────────────────────┬───────────────────────────────────────────┘
                       │ POST /bond-risk-notification-v1
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│               Notification Service (extended or new)              │
│                                                                   │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐   │
│  │ REST API │───▶│  PG Queue    │───▶│ Consumers             │   │
│  │ (ingest) │    │ (inbox/dlq)  │    │  ├─ Telegram consumer │   │
│  └──────────┘    └──────────────┘    │  └─ Email consumer    │   │
│                                      └───────────────────────┘   │
│  ┌──────────────────────────┐                                     │
│  │ Pull API (new)           │◀──── PSR Dashboard + CLI            │
│  │ GET /bond-notifications  │                                     │
│  └──────────────────────────┘                                     │
│                                                                   │
│  ┌──────────────────────────┐                                     │
│  │ Subscriptions API (new)  │◀──── CLI subscribe/unsubscribe      │
│  └──────────────────────────┘                                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. Open Questions

1. **marinade-notifications maintenance status** — extend or build new? The Intercom/BigQuery coupling is heavy. If team won't touch it, new lightweight service is faster.

2. **ds-sam-sdk as library** — can the bond risk monitor import ds-sam-sdk to calculate required bond thresholds? Or use bonds API existing health indicators?

3. **PSR dashboard notification UI** — is there existing notification/announcement component? Or entirely new?

4. **v1 scope** — all 4 channels at once, or start with checker + Telegram (simplest push) and iterate?

5. **CLI show-bond integration** — does `show-bond` already surface risk info we can build on?

6. **Telegram bot `@sam_mnde_bot`** — already created? Who manages the token?

7. **Where does the checker run?** — buildkite (like bonds-collector), separate deployment, or within notification service?

8. **Bond risk thresholds** — what exactly defines green/yellow/red? Need to check ds-sam-sdk's `bondBalanceRequiredForXEpochs()` implementation.

---

## Related File Paths (for quick reference)

| What                          | Path                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| This repo (validator-bonds)   | `/home/chalda/tmp/validator-bonds`                                                                       |
| marinade-notifications        | `/home/chalda/marinade/marinade-notifications`                                                           |
| PSR dashboard                 | `/home/chalda/marinade/psr-dashboard`                                                                    |
| Design analysis doc           | `/home/chalda/marinade/claude-summary/2026-02-13_bond-risk-notification-system-design.md`                |
| Institutional staking checker | `https://github.com/marinade-finance/institutional-staking/blob/main/.buildkite/check-bonds.yml`         |
| ds-sam auction lib            | `https://github.com/marinade-finance/ds-sam`                                                             |
| ds-sam pipeline + config      | `https://github.com/marinade-finance/ds-sam-pipeline`                                                    |
| Blog post (SAM auction)       | `https://marinade.finance/blog/more-control-better-yields-introducing-dynamic-commission-for-validators` |
| Bonds API                     | `https://validator-bonds-api.marinade.finance/docs`                                                      |
| Validators API                | `https://validators-api.marinade.finance/validators`                                                     |
| Scoring API                   | `https://scoring.marinade.finance/api/v1/scores/sam`                                                     |
| GCS settlement data           | `https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet`                      |
