# Bond Risk Notification System — Full Context & Plan

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
- **telegram-bot** — `/home/chalda/marinade/telegram-bot` (branch `feature-bonds`) — NestJS Telegram bot service with deep-link subscription flow and `POST /send` delivery endpoint for bonds notifications

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

### What Has Been Added for Bond Notifications (branch `notifications-processing`)

- ✅ **Telegram delivery** — via telegram-bot service's `POST /send` endpoint (not direct Bot API)
- ✅ **bonds-event-v1 topic** — full ingress → queue → consumer → delivery pipeline
- ✅ **Subscription module** — REST API with Solana ed25519 auth + SAM auction verifier
- ✅ **Dedup system** — `notification_dedup` table with brain-generated deterministic IDs
- ✅ **API outbox** — `notifications_outbox` for pull-based clients
- ✅ **Routing config** — per-inner_type channel rules (typed from `BONDS_EVENT_INNER_TYPES`)
- ❌ **Notifications read API** — `GET /notifications` not yet implemented
- ❌ **Telegram delivery telemetry** — metrics/monitoring not yet implemented (see MUST_HAVE_FUTURE.md)
- ❌ **Email channel for bonds** — not implemented (only telegram + API in v1)

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

**Metric:** `bondGoodForNEpochs` — how many epochs a validator's bond can sustain current bidding costs.

**Formula** (ds-sam-sdk `constraints.ts`, updated Feb 2026):

```
protectedStakeSol = max(0, marinadeActivatedStakeSol - unprotectedStakeSol)
bondBalanceForBids = max(0, bondBalanceSol - (onchainDistributedPmpe / 1000) * protectedStakeSol)
bondGoodForNEpochs = bondBalanceForBids / ((expectedMaxEffBidPmpe / 1000) * marinadeActivatedStakeSol)
```

Where:

- `bondBalanceSol` = validator's bond balance
- `onchainDistributedPmpe` = cost of on-chain distributed rewards per mille per epoch
- `expectedMaxEffBidPmpe` = conservative estimate of highest bid cost per 1000 SOL
- `marinadeActivatedStakeSol` = total Marinade stake delegated to validator
- `unprotectedStakeSol` = portion of stake not protected by bond (from auction config)

**Color thresholds** (psr-dashboard `sam.ts`):

- **GREEN** (>10 epochs): Bond healthy, covers at least 2 epochs of bids
- **YELLOW** (2–10 epochs): Sufficient for ~1 epoch, top up recommended
- **RED** (<2 epochs): Critical — bond limits maximum stake, top up immediately

**Recent fix** (ds-sam-sdk commit `23040f1`, Feb 13 2026): Added missing `* marinadeActivatedStakeSol` divisor — previously the calculation didn't properly scale with stake amount. PSR dashboard updated to ds-sam-sdk 0.0.44 (commit `4857ff9`, Feb 16 2026).

**Related metric:** `bondSamHealth` — ratio indicating how much of the validator's stake is sufficiently protected, includes hysteresis to prevent system flapping.

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

### KEYPOINTS FOR DESING

- the pipeline .buildkite/collect-bonds.yml runs once per hour and loads updates from chain. Into this pipeline there should be added a new step
  that will be create an event that will be published to 'marinade-notification' (/home/chalda/marinade/marinade-notifications)
  ** the new step will consist of a new module in typescript running after the bonds collector. This **new eventing module\*\* processing should be stateless and will only checks some consideration what are events to emit, those will be
  - the auction bid was increased and you are out of auction (running the DS SAM SDK run simulation, similarly as in PSR dashboard)
  - the bond is not big enough to handle the auction and thus stake is capped (data from chain)
  - the validator was unstaked, has got some more stake (a new API that will be introduced into native staking and ds-scoring, not fully prepared now)
  - think if there is some other events
    \*\* check in details how the 'marinade-notification' is done. the SPEC, README, CLAUDE and ARCHITECTURE files should talk on how to add new notification tenant, currently there is only rewards but bonds should be add there.
    we will need to generate (there -there is prepared handling for it) a schema of bonds messages etc., think about it, this can be still open question but schema should be generic
- the marinade-notification has to be updated in way to be able to consume the bonds events
- the marinade-notification should be linking another new validator bonds TS bonds notification library **bonds notification** that will on input being capable to decide (here we should probably use the common schema)
  the **eventing module** will create a message and push it to marinade notifications
  the marinade notification will consume this schema and with the linked **bonds notification** module it will decide if the event processes through threshold. I think the **bonds notification** will have some YAML configuration file,
  that will be packed inside the library and with new library version it can be change. This yaml wil define the threshold of saying like this is needed to be notified (like bonds missing 0.1 sol is still fine but bond missing 100 sol
  to cover demand for stake is critical). So the **bonds notification** should decide some business rules when notify, what priority has got that, how long the notification is relevant (maybe it is one shot, maybe it is relevant for 5 days).
  it should decide how often the notification should be retried when shown - with that we need to have some "ID" (checksum) of the notification event.
  Like a bond is missing SOL is an event. That is emitted once and then if still missing we can configure to be emitted once a day.
  When a bond is missing suddenly more SOLs (but again delta should be significant like 10% of the amount or something) then we want to emit the event immediatelly again.
  As the **eventing module** is stateless it is pushing events without knowledge if that was notified or not. That **bonds notification** is the brain of decision.
  The eventing moduel has to be capable (based on bond id, amount, sols, epoch, time...) define a notification id. It will be a dedup key used by notification service later.
- I think the notification has some generic data items like: created, id, type (e.g. bonds), inner_type (specific for bons, like "notification", "generic announcement", "version bump"....), json data
  ** the json data should be again defined as some schema (to be possible to be loaded by rust as well),
  and some loading data stuff within the **bons notification\*\*
- Notification service should be now capable to dedup notifications (here is some table with state saved). It receives data through API about a notification. It founds it is a **bond type**.
  It directs it to bonds processing "pipeline". There is loaded the **bonds notification** library that is the brain decision maker and generates event id if decided to be notified.
  It pushes that to notification service and it has to manage delivery.
  Currently there is probaly no direct email service but there needs to be done some - on delivery we will talk in a bit.
  Here it is necessary that the next pipeline step loads information from **subscription** table and based on that it pushes the delivery process.
  There has to be ensured delivery (when channel confirms then it does not redeliver, when id is pushed the same and already delivered then not process again...)
  \*\* verify how the delivery is done in marinade notifications and work based on that
- marinade notification will implement a **subscription module**
  ** it will be an API accepting subscription
  ** based on the type it will validate that subscription is valid and then it will insert subscription to table. the key of the subscription is probably some user id.
  ** I currently imagine a single table with "user id" and then subscription "addresses" that defines what module it subscribe to - ie. tlg handle, email address...; this could be a a naive so feel free to elaborate. But as v1 it has to be really simple
  ** as a start I need a subscription module for keypair of Solana. The user will send a signed message (I don't know how but I believe the solana SDK in TS knows it) and there is checked that incoming
  pubkey (which will be now the user id) matches. then the row is pushed.
  ** we need to have chance to push a new data and delete subscription
  ** we don't want upsert, we want to insert with data update and then later loads only the "latest row"
- the "last" part is the notification emitting service - when subscribed the event is emitted, deduplicated (in the pipeline mentioned above) - then we go to notification processor.
  ** Here it is again the **bonds notification** the brain of the decision about notification business logic, to decide what type of notification is permitted to emitted for that particular message.
  ** we have two types of processor in v1:
  **_ tlg - not sure if it's possible to send with rest then it should be just tlg message with rest (simple, no bot in v1)
  _** API (db table save) - there will be a new API endpoint here in notification-service that will permit to read all notifications. It should be filterable by type (here it is bond) and by user id (here it will be pubkey for bonds) and then latest up to 2 days or similar, and then by priority (e.g. only critical notifications), and inner_type possibly
- there are two generic usecases I have in mind now:
  a) data coming from **eventing module** after bond collector is run. we know it's some delta of state, **bons notification** decides if reasonable to notify
  b) admin wants to notify - we publish notification through the 'marinade notification' with some specific 'inner_type'. at least I think about it in this generic manner. maybe some "admin" api could be better practice, but I'm not sure here.

---

## 7. Agreed Architecture

Based on KEYPOINTS above — formalized component diagram:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ validator-bonds repo                                                    │
│                                                                         │
│  ┌──────────────┐    ┌──────────────────────────┐                      │
│  │bonds-collector│───>│  eventing module (TS)     │                     │
│  │  (Rust CLI)   │    │  - delta-based (stateful) │                     │
│  └──────────────┘    │  - runs after collect      │                     │
│                       │  - fetches auction data    │                     │
│                       │  - compares vs prev state  │                     │
│                       │  - emits delta events      │                     │
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
│  │ bonds-event consumer                                         │       │
│  │  1. loads bonds-notification lib (the "brain")               │       │
│  │  2. evaluates thresholds → skip or proceed                   │       │
│  │  3. generates deterministic notification_id (dedup key)      │       │
│  │  4. checks dedup table → skip if recently delivered          │       │
│  │  5. loads routing config → determine channels for inner_type │       │
│  │  6. looks up subscriptions table → get channels per user     │       │
│  │  7. routes to delivery processors:                           │       │
│  │     ├─ Telegram (REST API) → sendMessage to chat_id          │       │
│  │     └─ API (DB save) → insert into notifications_outbox      │       │
│  │  8. updates dedup table on successful delivery               │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐        │
│  │ subscription API     │   │ notifications read API            │        │
│  │  POST /subscriptions │   │  GET /notifications               │        │
│  │  DELETE /subscriptions│  │  - filter: type, user_id,         │        │
│  │  GET /subscriptions  │   │    priority, inner_type, recency  │        │
│  │  - Solana sig verify │   │                                   │        │
│  │  ✅ IMPLEMENTED      │   │                                   │        │
│  └─────────────────────┘   └──────────────────────────────────┘        │
│                                                                         │
│  notification-routing.yaml  ← defines default channels per             │
│                                inner_type, admin overrides              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Message Flow — Automated Events

1. Buildkite cron runs `collect-bonds.yml` (hourly)
2. bonds-collector loads on-chain data → PostgreSQL
3. **eventing module** starts (new step, same pipeline)
4. Fetches validator/auction data (validators-api, scoring API, ds-sam-sdk simulation)
5. For each validator with a bond, checks conditions:
   - Is bond underfunded relative to auction demand? (`bondGoodForNEpochs` < threshold)
   - Is the validator out of the auction? (bid too low vs current clearing price)
   - Is stake capped due to insufficient bond?
6. For each condition met, emits a raw event with `message_id` (UUID) and `created_at` timestamp, no deterministic notification_id at this stage
7. POSTs each event to `marinade-notifications /bonds-event-v1` endpoint with exponential backoff retry (30s base, up to ~8 min, then discard)
8. Writes each emitted event to `emitted_bond_events` table in validator-bonds-api PostgreSQL with `status: sent` or `status: failed` (for data review)
9. Consumer processes:
   a. bonds-notification lib evaluates thresholds → skip or proceed
   b. If proceed: generates deterministic `notification_id` (dedup key) based on event data
   c. Dedup check against `bonds_notification_dedup` table → skip if recently delivered
   d. Loads routing config → determines which channels apply for this inner_type
   e. Subscription lookup → get user's subscribed channels
   f. Routes to delivery processors (Telegram, API outbox)
   g. Updates dedup table on successful delivery

### Message Flow — Admin Notifications

1. Admin POSTs to `marinade-notifications /bonds-event-v1` with `inner_type: "announcement"` (or similar)
2. Event payload may include optional `requested_channels` to target specific channels
3. Consumer processes: bonds-notification lib recognizes admin type → always notify, high priority
4. Routing config may define `force: true` for announcements → delivers to all subscribers regardless of channel preference
5. Delivers to all subscribers (or filtered by target criteria in payload)

---

## 8. Implementation Plan

### 8.1 bonds-notification Library

**Location:** `packages/bonds-notification/` in validator-bonds repo (published to npm as `@marinade.finance/bonds-notification`)

**Purpose:** Business logic "brain" — decides IF to notify, at what priority, and how often. Consumed by the marinade-notifications consumer (NOT by the eventing module — the eventing module only emits raw events).

**Contents:**

- `config.yaml` — threshold configuration, packed inside the library
- `evaluate.ts` — main function: takes raw event + config → returns `{shouldNotify, priority, relevanceDuration, notificationId}` or null. Called by the consumer in marinade-notifications, NOT by the eventing module.
- `types.ts` — shared TypeScript types for bond events (generated from JSON Schema)
- `schema/bonds-event-v1.json` — JSON Schema for the event payload (shared with marinade-notifications codegen)

**YAML config example:**

```yaml
# NOTE: The actual implemented config is in packages/bonds-notification/src/config/thresholds.yaml
# Inner types use delta-based names (e.g., bond_underfunded_change, auction_exited, cap_changed)
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
    other_caps_shouldNotify: false
    renotify_interval_hours: 24
    relevance_hours: 120

  bond_removed:
    priority: critical
    renotify_interval_hours: 24
    relevance_hours: 48

  announcement:
    priority: critical
    skip_dedup: true
    relevance_hours: 48

passthrough_events:
  first_seen:
    priority: info
    relevance_hours: 24
  auction_entered:
    priority: info
    relevance_hours: 24
  bond_balance_change:
    priority: info
    relevance_hours: 24
  version_bump:
    priority: info
    relevance_hours: 24
    skip_dedup: true
```

**Notification ID generation** (deterministic, for dedup — generated by the consumer, NOT at emission time):

The `evaluate()` function generates a deterministic `notification_id` when it decides to notify. This happens in the marinade-notifications consumer, not in the eventing module. At emission time, the eventing module only attaches a `message_id` (UUID for transport dedup) and `created_at` timestamp.

The notification_id encodes **what changed** and **when to re-notify** directly in the hash. The consumer dedup is a simple existence check — all re-notification logic lives here in the brain.

- `bond_underfunded_change`: `sha256(vote_account + "underfunded" + amount_bucket + time_bucket)`
  - `amount_bucket = computeAmountBucket(deficitSol, significant_change_pct)` — logarithmic scale, changes when deficit changes by >significant_change_pct%
  - `time_bucket = floor(created_at_ms / (renotify_interval_hours * 3600000))` — changes when re-notify interval elapses
- `auction_exited`: `sha256(vote_account + "auction_exited" + epoch + time_bucket)`
- `cap_changed`: `sha256(vote_account + "cap_changed" + currentCap + time_bucket)`
- `bond_removed`: `sha256(vote_account + "bond_removed" + epoch + time_bucket)`
- `first_seen`, `auction_entered`, `bond_balance_change`: `sha256(vote_account + category + epoch + time_bucket)` — dedup by epoch
- `announcement`, `version_bump`: `notificationId = null` (skip dedup, every delivery is unique)

The notification_id changes when either (a) the situation changes significantly, or (b) the re-notify time window rolls over. Both produce a new id that bypasses dedup.

### 8.2 Event Schema (bonds-event-v1)

**JSON Schema** — placed in `message-types/schemas/bonds-event-v1.json` in marinade-notifications. Run `pnpm generate` to auto-generate both TypeScript types (with AJV validator) and Rust structs (via `cargo typify`).

**Note on field ownership:** The event schema defines what the **emitter** sends. Fields like `notification_id`, `priority`, and `relevance_hours` are NOT part of the emitted event — they are generated by the consumer (via `bonds-notification` lib) after evaluating the event. The emitter sends raw facts; the consumer decides what to do with them.

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
    "vote_account": {
      "type": "string",
      "description": "Validator vote account pubkey"
    },
    "bond_pubkey": { "type": "string", "description": "Bond account pubkey" },
    "epoch": { "type": "integer" },
    "requested_channels": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional: emitter can suggest specific channels (mainly for admin announcements). Consumer routing config is authoritative."
    },
    "data": {
      "type": "object",
      "description": "Notification payload with message and details",
      "required": ["message", "details"],
      "properties": {
        "message": {
          "type": "string",
          "description": "Human-readable plain text summary"
        },
        "details": {
          "type": "object",
          "description": "All raw data points used to construct the message. Enables message reconstruction and programmatic use.",
          "additionalProperties": true
        }
      }
    },
    "created_at": { "type": "string", "format": "date-time" }
  }
}
```

**Fields generated by consumer (NOT in event schema, produced by `bonds-notification.evaluate()`):**

- `notification_id` — deterministic dedup key
- `priority` — `critical` / `warning` / `info`
- `relevance_hours` — how long the notification stays relevant

**Generated outputs** (by `pnpm generate` in `message-types/`):

- `message-types/typescript/bonds-event-v1/src/index.ts` — TS types + AJV validator
- `message-types/rust/bonds_event_v1/src/lib.rs` — Rust serde structs

### 8.3 Eventing Module (validator-bonds)

**Location:** `packages/bonds-eventing/` in validator-bonds repo

**Runs as:** Node.js script in Buildkite, new step in `collect-bonds.yml` after bonds-collector

**Dependencies:**

- `@marinade.finance/ds-sam-sdk` — for auction simulation (same as PSR dashboard)
- `ts-message-client` from marinade-notifications — for posting to notification service

**Note:** The eventing module does NOT depend on `bonds-notification`. It is a pure emitter of raw events. All business logic evaluation (thresholds, priority, notification_id) happens in the consumer side at marinade-notifications.

**Flow:**

1. Fetch current bond data from validator-bonds-api (`/v1/bonds`)
2. Fetch validator/auction data (validators-api, scoring API)
3. Run ds-sam-sdk auction simulation (same approach as PSR dashboard)
4. For each bonded validator, compute `bondGoodForNEpochs` and auction status
5. For each condition met, construct a raw event with `message_id` (UUID), `created_at` (timestamp), `data.message` (human-readable text), and all relevant data points in `data.details`
6. POST each event to `marinade-notifications /bonds-event-v1` endpoint with retry (see retry config below)
7. Write each emitted event to `emitted_bond_events` table in validator-bonds-api PostgreSQL with `status: sent` or `status: failed`

**Delta-based design:** The eventing module tracks previous state in `bond_event_state` table and emits events only when state changes (see IMPLEMENTATION_PLAN Part A.2 for details). The emitter is stateful for delta detection but does NOT make notification decisions — all dedup, threshold, and priority logic lives in the consumer (via `bonds-notification` lib). The `emitted_bond_events` table is an append-only audit log.

**Event persistence:** All emitted events are written to the `emitted_bond_events` PostgreSQL table (same DB as bonds-collector / validator-bonds-api). Each row records the full event payload and delivery status (`sent` / `failed`). This is for data review only — no API on top of it.

**Retry config for POST to marinade-notifications:**

When the notification service is unavailable, the eventing module retries with exponential backoff:

```yaml
retry:
  base_delay_seconds: 30
  max_retries: 4 # 30s → 60s → 120s → 240s ≈ 7.5 min total
  backoff_multiplier: 2
  on_exhaustion: log_warning_and_continue # discard event, don't fail the cron job
```

This is separate from `ts-message-client`'s internal retry (3 retries, 2s base — too short for service outages). The eventing module wraps the POST call with this longer retry for service-level unavailability. On exhaustion, the event is logged as a warning and discarded — the cron job must finish so the next hourly run can try again.

### 8.4 New Topic in marinade-notifications (bonds-event-v1) — ✅ IMPLEMENTED

> **Implementation note:** The actual consumer is a hard-coded `BondsEventV1Consumer` class (same pattern as staking-rewards consumer), NOT the generic `NotificationPlugin` pipeline described in Section 8.5. The generic pipeline abstraction was deferred — bonds uses direct wiring to the brain library. Section 8.5 describes the **planned future** architecture, not what is implemented today.

Following the existing per-topic pattern:

**Files to create:**

**Pipeline framework files** (shared, created once):

1. `notification-service/pipeline/notification-plugin.interface.ts` — `NotificationPlugin`, `EvaluationResult` interfaces
2. `notification-service/pipeline/type-hooks.ts` — `TypeHooks` interface + per-type hook registry
3. `notification-service/pipeline/plugin-registry.ts` — maps type string → plugin instance
4. `notification-service/pipeline/notification-pipeline.service.ts` — generic pipeline orchestrator (stages 1-11)
5. `notification-service/pipeline/pipeline.module.ts` — NestJS module
6. `notification-service/migrations/03-notification-dedup.sql` — shared dedup table

**Per-topic files** (bonds-event-v1):

1. `message-types/schemas/bonds-event-v1.json` — JSON Schema (from 8.2)
2. `message-types/typescript/bonds-event-v1/src/index.ts` — generated types + validator
3. `notification-service/migrations/04-bonds-event-v1.sql` — inbox/archive/DLQ tables
4. `notification-service/ingress/bonds-event-v1/controller.ts` — POST endpoint
5. `notification-service/ingress/bonds-event-v1/service.ts` — enqueue logic
6. `notification-service/ingress/bonds-event-v1/module.ts` — module registration
7. `notification-service/consumers/bonds-event-v1/consumer.ts` — thin wrapper: dequeues from bonds inbox, delegates to `NotificationPipeline`
8. `notification-service/consumers/bonds-event-v1/module.ts` — consumer module

**Register in:**

- `notification-service/app.module.ts` — add pipeline module, ingress + consumer modules
- `notification-service/queues/queues.service.ts` — add to `TOPIC_TABLE_MAP`
- `notification-service/pipeline/plugin-registry.ts` — register `BondsNotificationPlugin`

**Consumer logic** — uses the generic notification pipeline (see Section 8.5):

The bonds-event consumer is a thin wrapper. It dequeues from the bonds inbox, then feeds each message into the generic `NotificationPipeline` with the `bonds` plugin registered. All stages below are shared infrastructure — the plugin only provides the type-specific logic.

### 8.5 Generic Notification Pipeline (marinade-notifications)

The consumer pipeline is a **pluggable framework** defined in marinade-notifications. Each notification type (bonds, future staking-rewards-v2, etc.) registers a plugin that implements the same interface. The shared infrastructure handles dedup, routing, subscription lookup, and delivery.

**Plugin interface** (defined in marinade-notifications, implemented by external libraries or inline code):

```typescript
// notification-service/pipeline/notification-plugin.interface.ts

interface EvaluationResult {
  shouldNotify: boolean
  priority: 'critical' | 'warning' | 'info'
  relevanceHours: number
  notificationId: string | null // deterministic dedup key, null = skip dedup stage
  // No renotifyIntervalHours — re-notification is encoded in the notificationId itself
  // (time_bucket in the hash changes when re-notify interval elapses)
}

interface NotificationPlugin {
  /** Which notification type this plugin handles */
  readonly type: string // 'bonds', 'staking-rewards', etc.

  /** Stage 1: Evaluate if event should become a notification.
   *  Returns null to silently drop, or EvaluationResult.
   *  For types with no threshold logic, return shouldNotify: true always. */
  evaluate(event: unknown): EvaluationResult | null

  /** Stage 2: Extract the user identifier from the event.
   *  e.g., vote_account for bonds, withdraw_authority for staking-rewards. */
  extractUserId(event: unknown): string

  /** Stage 3 (optional): Resolve delivery targets for the user.
   *  Default: uses shared subscription table + routing config.
   *  Override: plugin provides its own target resolution (e.g., Intercom wallet lookup, BigQuery whitelist).
   *  Return null to fall through to default subscription-based resolution. */
  resolveDeliveryTargets?(
    userId: string,
    event: unknown,
  ): Promise<DeliveryTarget[] | null>

  /** Stage 4 (optional): Format the notification message for a given channel.
   *  Default: uses event's data.message or raw payload.
   *  Override: plugin can customize per channel (e.g., Intercom event name mapping). */
  formatMessage?(
    event: unknown,
    channel: string,
    evaluation: EvaluationResult,
  ): string
}

/** A resolved delivery target — who to send to, via which channel */
interface DeliveryTarget {
  channel: string // 'telegram', 'api', 'intercom', 'partner-email', etc.
  address: string // chat_id, email, intercom_user_id, '' for api outbox
  metadata?: Record<string, unknown> // channel-specific data (e.g., template name, attachments)
}
```

**Plugin registration** (in marinade-notifications code, wiring implementation to interface):

```typescript
// notification-service/pipeline/plugin-registry.ts

// Each plugin library is imported and registered here.
// Plugins can be external (npm packages) or inline (code in marinade-notifications).
const PLUGIN_REGISTRY: Record<string, NotificationPlugin> = {
  bonds: new BondsNotificationPlugin(), // from @marinade.finance/bonds-notification
  // 'staking-rewards': new StakingRewardsPlugin(),  // inline in marinade-notifications
}
```

**Pipeline stages** (shared infrastructure, all stages optional via plugin return values):

```
┌──────────────────────────────────────────────────────────────────┐
│ Generic Notification Pipeline                                     │
│                                                                    │
│  1. Dequeue message from topic inbox                    SHARED     │
│  2. Validate payload against topic schema               SHARED     │
│                                                                    │
│  3. plugin.evaluate(event)                              PLUGIN     │
│     ├─ beforeEvaluate(event)                            HOOK       │
│     ├─ plugin.evaluate(event) → EvaluationResult                   │
│     └─ afterEvaluate(event, result)                     HOOK       │
│  4. If !shouldNotify → archive                          SHARED     │
│                                                                    │
│  5. plugin.extractUserId(event)                         PLUGIN     │
│                                                                    │
│  6. Dedup check (if notificationId is not null)         SHARED     │
│     ├─ beforeDedup(...)                                 HOOK       │
│     ├─ If notificationId == null → SKIP dedup                      │
│     └─ EXISTS check in notification_dedup table                    │
│  7. If already delivered → archive                      SHARED     │
│                                                                    │
│  8. Resolve delivery targets:                                      │
│     ├─ plugin.resolveDeliveryTargets(userId, event)     PLUGIN     │
│     │   returns targets? → use them directly                       │
│     ├─ returns null? → fall through to default:                    │
│     │   ├─ Routing config lookup                        SHARED     │
│     │   └─ Subscription table lookup                    SHARED     │
│     └─ afterResolveTargets(targets)                     HOOK       │
│                                                                    │
│  9. Delivery (for each target):                         SHARED     │
│     ├─ plugin.formatMessage(event, channel, eval)       PLUGIN     │
│     ├─ Dispatch to channel service:                                │
│     │   ├─ 'telegram' → TelegramService                            │
│     │   ├─ 'api' → notifications_outbox insert                     │
│     │   ├─ 'intercom' → IntercomService                            │
│     │   ├─ 'partner-email' → PartnersService + SmtpService         │
│     │   └─ (extensible — new channels register here)               │
│     └─ afterDelivery(event, targets)                    HOOK       │
│                                                                    │
│  10. Update dedup table (if notificationId not null)    SHARED     │
│  11. Archive message                                    SHARED     │
└──────────────────────────────────────────────────────────────────┘
```

**Key design: stages are skippable.** If the plugin returns specific values, stages are bypassed:

- `evaluate()` returns `shouldNotify: true` always → no filtering (staking-rewards behavior)
- `evaluate()` returns `notificationId: null` → stages 6-7 (dedup) are skipped entirely
- `resolveDeliveryTargets()` returns targets → stages 8a-8b (routing config + subscription lookup) are skipped
- `resolveDeliveryTargets()` returns null or is not implemented → falls through to default shared logic

**Type hooks** (escape hatches for per-type tweaks in marinade-notifications):

Each stage has optional `before` / `after` hooks that can be registered per notification type directly in marinade-notifications code. These are NOT in the plugin interface — they live in the service itself, allowing type-specific hacks without modifying the plugin library.

```typescript
// notification-service/pipeline/type-hooks.ts

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

const TYPE_HOOKS: Record<string, TypeHooks> = {
  bonds: {},
  'staking-rewards': {},
}
```

**Delivery channel registry** (shared, all notification types can use any registered channel):

```typescript
// notification-service/pipeline/channel-registry.ts

interface DeliveryChannel {
  readonly name: string // 'telegram', 'api', 'intercom', 'partner-email'
  deliver(
    target: DeliveryTarget,
    message: string,
    event: unknown,
  ): Promise<void>
}

// Existing channels (already implemented in marinade-notifications):
const CHANNEL_REGISTRY: Record<string, DeliveryChannel> = {
  intercom: intercomChannel, // wraps existing IntercomService
  'partner-email': partnerEmailChannel, // wraps existing PartnersService + SmtpService
  // New channels (to be added):
  telegram: telegramChannel, // wraps new TelegramService
  api: apiOutboxChannel, // wraps new notifications_outbox insert
}
```

**Why this design:**

- **Interface in marinade-notifications** — the contract is owned by the consuming service, not by plugins
- **Implementation flexible** — plugins can be external npm packages (bonds-notification) or inline code in marinade-notifications (staking-rewards)
- **Stages are optional** — plugins opt out of stages by returning null/not implementing methods. No forced pipeline for types that don't need it.
- **Existing channels reusable** — Intercom and Partner Email are registered as delivery channels, available to any notification type
- **Type hooks** — marinade-notifications can add per-type tweaks without touching the plugin library
- **Adding a new type** = implement `NotificationPlugin` (inline or external), register in `PLUGIN_REGISTRY`, add ingress + topic tables

### Staking-rewards migration path

The existing staking-rewards consumer is tightly coupled (hardcoded Intercom + Partners decision logic, status-to-event mapping, BigQuery whitelist lookup). It can be migrated to the pluggable pipeline, but this is **not required for v1**.

**How staking-rewards would work as a plugin (future migration):**

```typescript
// Inline plugin in marinade-notifications (no external library needed)
class StakingRewardsPlugin implements NotificationPlugin {
  type = 'staking-rewards'

  evaluate(event) {
    // Always notify (no threshold). Map status to shouldNotify.
    const eventName = mapStatusToEvent(event.status)
    if (!eventName) return null  // unknown status → drop
    return {
      shouldNotify: true,
      priority: 'info',
      relevanceHours: 0,
      notificationId: null,       // ← NO DEDUP (skip stages 6-7)
      renotifyIntervalHours: 0,
    }
  }

  extractUserId(event) {
    return event.withdraw  // wallet address
  }

  // Override delivery target resolution — use existing Intercom + Partners logic
  async resolveDeliveryTargets(userId, event) {
    // 1. Check BigQuery partner whitelist
    const partner = bigQueryService.getPartner(userId)
    if (partner) {
      return [{ channel: 'partner-email', address: partner.notify, metadata: { ... } }]
    }
    // 2. Fall back to Intercom
    const intercomUserId = await intercomService.getUserId(userId)
    if (intercomUserId) {
      return [{ channel: 'intercom', address: intercomUserId, metadata: { eventName } }]
    }
    return []  // no target found
  }
}
```

**Key observations for migration:**

- `resolveDeliveryTargets()` absorbs the current Partners-vs-Intercom decision logic — it returns specific targets instead of falling through to subscription table
- Status-to-event mapping moves into the plugin's `evaluate()` or `formatMessage()`
- BigQuery partner whitelist stays as-is — it's a **managed subscription source**, not self-service. Could optionally be migrated to the subscription table later (with `source: 'managed'` column), but not required
- The existing consumer can run alongside the new pipeline during transition — no big-bang migration needed

**Impact on subscription table design:**

The subscription table (Section 8.7) should support both self-service and managed subscriptions:

```sql
-- Add source column to distinguish subscription origins
source TEXT NOT NULL DEFAULT 'self-service',  -- 'self-service' (user subscribed) or 'managed' (admin/BigQuery imported)
```

This allows the BigQuery partner whitelist to be optionally imported into the subscription table in the future, while self-service subscriptions (bonds validators via CLI) coexist in the same table. The consumer pipeline doesn't care about `source` — it just queries active subscriptions for the user.

**v1 scope:** Staking-rewards consumer stays as-is. The pluggable pipeline is built for bonds. The interfaces are designed so staking-rewards can migrate later without breaking changes.

### 8.6 Dedup Mechanism

**Shared table** in marinade-notifications (used by all notification types, not bonds-specific):

```sql
CREATE TABLE notification_dedup (
    notification_id TEXT NOT NULL PRIMARY KEY,
    notification_type TEXT NOT NULL,     -- 'bonds', future types
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dedup_type ON notification_dedup(notification_type);
```

**Logic in pipeline** (stage 6):

```
SELECT 1 FROM notification_dedup WHERE notification_id = $1;

IF found → skip (already delivered)
ELSE → deliver, then INSERT into dedup table
```

**Design: notification_id is the sole dedup key.** There is no time-based renotify logic in the consumer. All re-notification decisions are made by the brain (`bonds-notification` lib) via the notification_id itself:

- **Situation unchanged** → same `notification_id` → dedup catches it → skip
- **Situation changed significantly** (e.g., deficit grows by >10%) → brain generates new `notification_id` (different amount_bucket) → dedup passes → delivered
- **Time to re-notify** (e.g., 24h elapsed, condition persists) → brain embeds a time bucket in the id: `sha256(bond_pubkey + "underfunded" + amount_bucket + time_bucket)` where `time_bucket = floor(created_at / renotify_interval_hours)`. When the interval elapses, time_bucket changes → new `notification_id` → dedup passes → delivered

This keeps all notification logic in one place (the brain) and makes the consumer pipeline simple — just an existence check.

**Housekeeping:** Old dedup rows can be pruned periodically (e.g., `DELETE FROM notification_dedup WHERE delivered_at < now() - interval '30 days'`).
\*\* NOTE: DO NOT implement this until you confirm it is needed.

### 8.7 Subscription Module (marinade-notifications) — IMPLEMENTED

> **Status: Implemented** on branch `subscription-enpoint` in marinade-notifications repo.
> 5 commits: dependencies + migration, core types + utilities, service, controller + module + wiring, E2E tests.
> All 94 existing tests pass. 16 new E2E tests for subscriptions pass.

**Database table** (`notification-service/migrations/03-subscriptions.sql`):

```sql
CREATE TABLE subscriptions (
    id BIGSERIAL,
    user_id TEXT NOT NULL,           -- Solana pubkey for bonds, wallet for staking-rewards
    notification_type TEXT NOT NULL,  -- 'bonds', future: 'staking-rewards'
    channel TEXT NOT NULL,            -- 'telegram', 'api', 'intercom', 'partner-email', etc.
    channel_address TEXT NOT NULL,    -- chat_id for telegram, '' for api, email for partner-email
    source TEXT NOT NULL DEFAULT 'self-service',  -- 'self-service' or 'managed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,          -- soft delete (insert-only, latest row wins)
    PRIMARY KEY (id)
);
CREATE INDEX idx_sub_user_type ON subscriptions(user_id, notification_type);
CREATE INDEX idx_sub_active ON subscriptions(user_id, notification_type, channel)
    WHERE deleted_at IS NULL;
```

**Insert-only with latest row semantics** (as planned):

- New subscription = INSERT new row
- Update subscription = INSERT new row with updated data (old row stays)
- Delete subscription = INSERT new row with `deleted_at` set
- Query: `SELECT DISTINCT ON (user_id, notification_type, channel) ... ORDER BY created_at DESC` where `deleted_at IS NULL`

**API endpoints (implemented):**

```
POST /subscriptions
  Body: { pubkey, notification_type, channel, channel_address, additional_data, signature, message }
  Auth: Solana ed25519 signature verification via SubscriptionVerifier plugin
  Response: { user_id, notification_type, channel, channel_address, created_at }

DELETE /subscriptions
  Body: { pubkey, notification_type, channel, additional_data, signature, message }
  Auth: Solana ed25519 signature verification via SubscriptionVerifier plugin
  Response: { deleted: true } or 404 if no active subscription

GET /subscriptions?pubkey={pubkey}&notification_type={type}
  Headers: x-solana-signature, x-solana-message
  Auth: Solana signature verified directly against query pubkey
  Response: [{ user_id, notification_type, channel, channel_address, created_at }]
```

**Solana signature verification** (`solana-auth.ts`):

- Uses `@solana/keys` (`verifySignature`, `signatureBytes`) + `@solana/codecs-strings` (`getBase58Encoder`) + `@solana/addresses` (`isAddress`)
- Native Web Crypto API (`crypto.subtle.importKey` for Ed25519) — no tweetnacl dependency
- Message timestamp validation with configurable tolerance (default 5 minutes, env `SUBSCRIPTION_TIMESTAMP_TOLERANCE_MS`)
- Timestamp extracted from message via `parseTimestampFromMessage()`, freshness checked via `isTimestampFresh()`

**SubscriptionVerifier plugin interface** (`subscription-verifier.interface.ts`):

```typescript
interface VerificationResult {
  verifyAgainstPubkey: string // pubkey the signature must match
  userId: string // canonical user_id to store
}

interface SubscriptionVerifier {
  verifySubscription(
    incomingPubkey: string,
    notificationType: string,
    additionalData: Record<string, unknown>,
  ): Promise<VerificationResult | null>
}
```

- Per-notification-type verifier registry via NestJS DynamicModule `forRoot(verifiers)` pattern
- Verifier maps signer pubkey → userId (e.g., bond_authority → vote_account for bonds)
- Returns null to reject the subscription (403 Forbidden)
- Currently wired with empty verifier map `SubscriptionsModule.forRoot({})` — bonds verifier to be added when bonds-notification library is implemented

**Implementation details (deviations from original plan):**

- Used `@solana/keys` + `@solana/codecs-strings` + `@solana/addresses` instead of `@solana/web3.js` + nacl (modern Solana SDK with native Web Crypto)
- Auth is utility functions in `solana-auth.ts`, not a NestJS guard (inline verification in controller methods, matching existing ingress controller patterns)
- Migration is `03-subscriptions.sql` (not 04, since dedup table doesn't exist yet)
- GET endpoint added for listing subscriptions (not in original plan)
- Body uses `pubkey` field (not `user_id`) — the verifier plugin maps pubkey to user_id

**Files created:**

1. `notification-service/subscriptions/subscription-verifier.interface.ts` — plugin interface
2. `notification-service/subscriptions/solana-auth.ts` — signature verification + timestamp utilities
3. `notification-service/subscriptions/constants.ts` — `SUBSCRIPTION_VERIFIERS` DI token (extracted to avoid circular dependency)
4. `notification-service/subscriptions/subscriptions.service.ts` — data access (subscribe, unsubscribe, getActiveSubscriptions, getSubscribedChannels)
5. `notification-service/subscriptions/subscriptions.controller.ts` — REST controller (POST, DELETE, GET)
6. `notification-service/subscriptions/subscriptions.module.ts` — NestJS DynamicModule with `forRoot(verifiers)`
7. `notification-service/migrations/03-subscriptions.sql` — database migration
8. `notification-service/__tests__/subscriptions.e2e.ts` — 16 E2E tests

**Files modified:**

- `notification-service/configuration/config.service.ts` — added `subscriptionTimestampToleranceMs`
- `notification-service/telemetry/metrics.config.ts` — added `subscriptions_total` counter
- `notification-service/app.module.ts` — added `SubscriptionsModule.forRoot({})`
- `notification-service/__tests__/db-utils.ts` — added `subscriptions` to cleanDatabase()
- `notification-service/package.json` — added `@solana/addresses`, `@solana/codecs-strings`, `@solana/keys`, `@solana/offchain-messages`

**Security hardening (post-review fixes):**

- **Message prefix validation** — each endpoint validates the signed message starts with the expected operation prefix (`Subscribe `, `Unsubscribe `, `ListSubscriptions `). Prevents cross-operation replay within the timestamp window.
- **GET routes through verifier** — when `notification_type` is provided and a verifier exists, the GET endpoint resolves `pubkey → userId` via the verifier (same as POST/DELETE). This fixes the bonds use case where bond_authority signs but subscriptions are indexed by vote_account.
- **Proper Address type** — `address()` from `@solana/addresses` replaces `as never` cast for off-chain message signatories encoding.
- **Configurable signing domain** — `SubscriptionVerifier.signingDomain` allows per-type Solana off-chain message application domains. See Section 8.10a.

**E2E test coverage** (21 tests):

- Subscribe happy path, invalid signature (401), expired timestamp (400)
- Duplicate subscriptions (latest row wins), unknown type (422), api channel rejection (400), missing body fields (400)
- Unsubscribe happy path, no active subscription (404)
- List subscriptions, filter by type, auth required (401), invalid list signature (401)
- Verifier userId mapping, verifier rejection (403)
- Full subscribe-unsubscribe-resubscribe lifecycle
- **Cross-operation replay rejection** — Subscribe message rejected on DELETE (400), Unsubscribe message rejected on POST (400), Subscribe message rejected on GET (400)
- **GET through verifier** — mapped userId resolution via verifier, verifier rejection on GET (403)

**What's NOT yet implemented (next steps):**

- No bonds-specific SubscriptionVerifier plugin (needs bonds-notification library — Work Item 6)
- No Telegram deep link flow (needs Telegram integration — Work Items 11, RQ1, RQ4)
- No linking token generation for Telegram (future enhancement)

### 8.8 Telegram Delivery Processor (marinade-notifications) — ✅ IMPLEMENTED

**Architecture:** marinade-notifications does NOT call the Telegram Bot API directly. Instead, it delegates to the existing **telegram-bot** service (`/home/chalda/marinade/telegram-bot`) via its `POST /send` REST endpoint.

**Services:**

- `notification-service/telegram/telegram-delivery.service.ts` — orchestrates delivery (subscription lookup + send)
- `notification-service/telegram/telegram-api.ts` — HTTP client that calls telegram-bot's `POST /send`

**Delivery flow:**

1. Consumer resolves the subscription's `tracking_id` for the user
2. Calls telegram-bot: `POST {TELEGRAM_BOT_URL}/send` with `{ feature: "feature_sam_auction", tracking_id, text, parse_mode }`
3. Auth: `X-Send-Auth-Token: <TG_SEND_AUTH_TOKEN>` header
4. telegram-bot looks up `(feature, tracking_id)` → finds `chat_id` → calls Telegram Bot API `sendMessage`
5. Returns `{ ok: true, message_id, chat_id }` on success

**Error handling (from telegram-bot responses):**

- `404` — no subscription found for this tracking_id (user never clicked deep link)
- `410` — user blocked the bot (subscription soft-deleted by telegram-bot)
- `429` — Telegram rate limit hit, caller should retry
- `502` — Telegram API error

**Config:**

- `TELEGRAM_BOT_URL` — base URL of telegram-bot service
- `TG_SEND_AUTH_TOKEN` — shared secret for `POST /send` authentication

**MUST_HAVE (not yet implemented):** Telegram delivery telemetry — metrics for POST /send status codes, `telegram_status` transitions, response time histograms, and failed delivery logging. See `marinade-notifications/MUST_HAVE_FUTURE.md` for details.

### 8.9 Notifications Read API (marinade-notifications) — ✅ IMPLEMENTED

**Table** (already created by migration `04-bonds-event-v1.sql`):

```sql
CREATE TABLE notifications_outbox (
    id BIGSERIAL PRIMARY KEY,
    notification_type TEXT NOT NULL,
    inner_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    priority TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB NOT NULL,
    notification_id TEXT,
    relevance_until TIMESTAMPTZ NOT NULL,
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**API endpoint:**

```
GET /notifications?user_id={vote_account}&notification_type=sam_auction&priority=critical&inner_type=bond_underfunded_change&limit=50&offset=0
  Auth: NONE (public endpoint — notification data is derived from on-chain state)
  Response: [{ id, notification_type, inner_type, user_id, priority, message, data, notification_id, relevance_until, created_at }]
  Filters: deactivated_at IS NULL AND relevance_until > now()
  Includes broadcast notifications (sentinel user_id)
  Rate limit: 60 req/min
```

**Design decision:** Notifications are public data (bond health, auction status — all derivable from on-chain state). Only subscription management (subscribe/unsubscribe/list-subscriptions) requires Solana signature auth because it reveals private info (Telegram handles, email addresses). The PSR dashboard can query this endpoint directly for any vote_account without wallet connection.

**New files:**

1. `notification-service/notifications/notifications.controller.ts`
2. `notification-service/notifications/notifications.service.ts`
3. `notification-service/notifications/notifications.module.ts`
4. `notification-service/migrations/05-notifications-outbox.sql`

**Consumers:** CLI and PSR dashboard poll this endpoint to show notifications.

### 8.10 Notification Routing Configuration (marinade-notifications)

**Location:** `notification-service/config/notification-routing.yaml`

**Purpose:** Defines the default channels to use for each notification type and inner_type. The consumer loads this config to decide which delivery channels apply. This is separate from user subscriptions — routing config says "this inner_type CAN go to telegram and api", subscriptions say "this user WANTS telegram".

**YAML config:**

```yaml
# notification-routing.yaml (actual config hardcoded in routing-config.ts)
bonds:
  default_channels: [api] # always save to outbox for pull API
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
      force: true # send to ALL subscribers (broadcast)
    first_seen:
      channels: [api]
    auction_entered:
      channels: [api]
    bond_balance_change:
      channels: [api]
    version_bump:
      channels: [api]
```

**How it interacts with the consumer:**

1. Consumer loads routing config for the event's `type` + `inner_type`
2. Determines allowed channels from config
3. If event has `requested_channels` (optional field, mainly for admin announcements), intersects with allowed channels
4. If config has `force: true`, sends to all subscribers on all allowed channels (ignoring per-user channel preferences)
5. Otherwise, filters by user's subscribed channels

**Why a YAML file and not a database table:** Routing config changes infrequently and should be versioned with code. New channel types or routing rules ship with a new deployment, not as runtime config.

### 8.10a Signing Domain Configuration — IMPLEMENTED

> **Status: Implemented** as part of the subscription module fixes on branch `subscription-enpoint`.

**Purpose:** Each notification type uses a Solana off-chain message application domain for signature verification. Both the CLI (signer) and the server (verifier) must agree on the domain. The domain is configured per-type via the `SubscriptionVerifier.signingDomain` property.

**How it works (implemented in `subscription-verifier.interface.ts`):**

```typescript
export interface SubscriptionVerifier {
  readonly signingDomain?: string // Solana off-chain message application domain
  verifySubscription(
    incomingPubkey: string,
    notificationType: string,
    additionalData: Record<string, unknown>,
  ): Promise<VerificationResult | null>
}
```

- Each verifier plugin declares its `signingDomain` (e.g., validator-bonds program ID for bonds)
- The controller reads `verifier.signingDomain` before calling `verifySolanaSignature()`
- Default fallback: `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4` (validator-bonds program ID)
- Both CLI (`@marinade.finance/ledger-utils`) and server (`solana-auth.ts`) use `@solana/offchain-messages` for byte-identical off-chain message formatting

**Per-type domain examples:**

| Notification Type | Signing Domain                                | Rationale                            |
| ----------------- | --------------------------------------------- | ------------------------------------ |
| `bonds`           | `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4` | Validator-bonds program ID           |
| (future types)    | type-specific program ID or custom domain     | Each type scopes its signing context |

**CLI compatibility:** `@marinade.finance/ledger-utils` v3.1.0 `formatOffchainMessage()` and server-side `formatSolanaOffchainMessage()` produce byte-identical output when given the same domain. Cross-verification tests exist in the ledger-utils repo.

### 8.11 Testing Strategy

Two separate systems (validator-bonds emitter, marinade-notifications consumer) with a shared contract library bridging them.

#### Shared test library: `@marinade.finance/bonds-event-testing`

**Location:** `packages/bonds-event-testing/` in validator-bonds repo (published to npm)

**Purpose:** Schema contract enforcement across repositories. When the schema changes in validator-bonds, the test library is updated and published. marinade-notifications bumps the dependency and runs tests — if they break, the schema change is incompatible.

**Contents:**

- `schema.ts` — embedded JSON Schema for bonds-event-v1 + AJV validator function (`validateBondsEvent(event): { valid: boolean, errors: string[] }`)
- `fixtures.ts` — factory functions for valid test events per inner_type:
  ```typescript
  createBondUnderfundedEvent(overrides?: Partial<BondsEventV1>): BondsEventV1
  createOutOfAuctionEvent(overrides?: Partial<BondsEventV1>): BondsEventV1
  createStakeCappedEvent(overrides?: Partial<BondsEventV1>): BondsEventV1
  createAnnouncementEvent(overrides?: Partial<BondsEventV1>): BondsEventV1
  ```
- `invalid-fixtures.ts` — known-invalid events for negative testing (missing required fields, wrong types, bad inner_type values)
- `assertions.ts` — helper assertions:
  ```typescript
  assertValidBondsEvent(event: unknown): void      // throws if invalid
  assertEventHasRequiredDetails(event: unknown, innerType: string): void
  ```

**How it's used:**

- **In validator-bonds tests:** imported locally (workspace dependency), verifies emitter output matches schema
- **In marinade-notifications tests:** imported from npm, used to generate valid/invalid POST payloads for E2E tests

#### Emitter tests (validator-bonds — `packages/bonds-eventing/`)

**Framework:** Jest (same as rest of validator-bonds, Jest 29 + ts-jest)

**Unit tests** (`__tests__/`):

1. **Event generation tests** — mock API responses (validators-api, scoring, bonds-api), run the eventing module, verify:
   - Correct conditions produce events (bond underfunded → event emitted)
   - Conditions not met → no event
   - Each emitted event passes `assertValidBondsEvent()` from test library
   - `message_id` is UUID format
   - `created_at` is ISO 8601 datetime
   - `data.message` is non-empty human-readable text
   - `data.details` contains expected fields for each inner_type (e.g., `deficit_sol`, `bond_good_for_n_epochs` for underfunded)

2. **Auction simulation tests** — mock API data, verify `bondGoodForNEpochs` calculation matches expected values (same formula as PSR dashboard)

3. **Retry logic tests** — mock HTTP POST to notification service:
   - Successful POST → event recorded as `sent` in DB
   - Service down → retries with expected backoff timing
   - Retry exhaustion → event recorded as `failed` in DB, no crash

4. **DB persistence tests** — verify `emitted_bond_events` rows are written with correct fields and status

**CI:** Add to existing `ts-lint-and-test.yml` workflow (unit tests only, no Solana validator needed)

#### Consumer tests (marinade-notifications)

**Framework:** Jest 30 + @nestjs/testing + TestContainers PostgreSQL + supertest (existing patterns)

**Unit tests** (`notification-service/__tests__/`):

1. **Pipeline stage tests** — test each stage of `NotificationPipelineService` in isolation:
   - `evaluate()` called with mock plugin → correct shouldNotify/skip
   - Dedup logic → skip when recently delivered, pass when notificationId changes
   - Routing config loader → correct channels resolved per inner_type
   - Subscription lookup → correct targets for user
   - Delivery dispatch → correct channel service called

2. **bonds-notification plugin tests** — test the plugin imported from `@marinade.finance/bonds-notification`:
   - Threshold evaluation (deficit below min → skip, above → notify)
   - Priority assignment (bondGoodForNEpochs < 2 → critical, < 10 → warning)
   - notification_id determinism (same input → same id, different input → different id)
   - Significant change detection (deficit changes by >10% → new id)

**E2E tests** (`notification-service/__tests__/`):

Using TestContainers PostgreSQL (existing pattern via `db-utils.ts`):

1. **Ingress acceptance** — import fixtures from `@marinade.finance/bonds-event-testing`:
   - POST valid events (all inner_types) → 200 OK, message in inbox
   - POST invalid events (from `invalid-fixtures.ts`) → 400 Bad Request
   - POST duplicate message_id → 200 OK (idempotent, no duplicate in inbox)
   - POST without JWT → 401 Unauthorized

2. **Consumer pipeline E2E** — full flow with mocked delivery channels:
   - Insert event in inbox → consumer picks up → plugin evaluates → delivery target resolved → mock channel called → archived
   - Below-threshold event → archived without delivery
   - Dedup: same notification_id within renotify_interval → second event archived without delivery
   - Dedup: same notification_id after renotify_interval → delivered again
   - Changed notification_id (significant change) → delivered immediately

3. **Subscription E2E** — ✅ **IMPLEMENTED** (16 tests in `subscriptions.e2e.ts`):
   - POST subscription with valid Solana signature → subscription created
   - POST with invalid signature → 401 rejected
   - POST with expired timestamp → 400 rejected
   - Duplicate subscriptions → latest row wins
   - Unknown notification type → 422
   - API channel rejection → 400
   - Missing body fields → 400
   - DELETE subscription → soft-deleted, 404 if no active sub
   - GET subscriptions → list with type filter, header-based auth
   - Verifier userId mapping and rejection (403)
   - Full subscribe-unsubscribe-resubscribe lifecycle

4. **Notifications read API E2E**:
   - Insert notifications in outbox → GET returns them filtered by user/type/priority
   - Expired notifications → not returned

**Schema contract tests** (the bridge):

```typescript
// Uses fixtures from @marinade.finance/bonds-event-testing
import {
  createBondUnderfundedEvent,
  assertValidBondsEvent,
} from '@marinade.finance/bonds-event-testing'

describe('schema contract', () => {
  it('test library fixtures are accepted by ingress', async () => {
    const event = createBondUnderfundedEvent()
    assertValidBondsEvent(event) // passes locally
    const res = await request(app)
      .post('/bonds-event-v1')
      .send(wrapInMessage(event))
    expect(res.status).toBe(200) // accepted by service too
  })

  it('test library invalid fixtures are rejected by ingress', async () => {
    for (const invalid of getInvalidFixtures()) {
      const res = await request(app)
        .post('/bonds-event-v1')
        .send(wrapInMessage(invalid))
      expect(res.status).toBe(400)
    }
  })
})
```

When schema changes in validator-bonds:

1. Update schema + fixtures in `bonds-event-testing`
2. Publish new version to npm
3. Bump dependency in marinade-notifications
4. Run `pnpm test:e2e` → schema contract tests verify compatibility
5. If tests break → the change is incompatible, fix before merging

**CI:** Add to existing `lint-and-test.yml` in marinade-notifications (unit + e2e already run there)

---

## 9. Work Items

Ordered by dependency. Updated 2026-03-26 to reflect current implementation status.

**Phase 1: Pipeline framework (marinade-notifications)** — ✅ IMPLEMENTED (hard-coded consumer, not generic pipeline)

1. ~~**NotificationPlugin interface + DeliveryChannel interface**~~ — **DEFERRED.** Actual implementation uses a hard-coded `BondsEventV1Consumer` class (same pattern as staking-rewards consumer). The generic plugin abstraction can be extracted later when a second type needs it.
2. ~~**Delivery channel registry**~~ — **DEFERRED.** Telegram and API channels are wired directly in the consumer.
3. ~~**Generic notification pipeline service**~~ — **DEFERRED.** See item 1.
4. **Shared infrastructure tables** — ✅ `notification_dedup`, `subscriptions`, `notifications_outbox` all implemented
5. **Notification routing config** — ✅ Hardcoded in `routing-config.ts` (typed keys from `BONDS_EVENT_INNER_TYPES`)

**Phase 2: Bonds notification type** — ✅ IMPLEMENTED

6. **bonds-notification library** — ✅ `packages/bonds-notification/` in validator-bonds repo. Brain with evaluate/buildContent/extractUserId, YAML threshold config, notification_id generation.
7. **Event schema** — ✅ JSON Schema `bonds-event-v1.json` in marinade-notifications with codegen → `bonds-event-v1` package (types + Ajv validator). All 9 inner_types.
8. ~~**bonds-event-testing library**~~ — **NOT NEEDED.** Each repo uses the generated `bonds-event-v1` package directly + local test factories. No shared testing package required.
9. **marinade-notifications: bonds-event-v1 topic** — ✅ Ingress endpoint, queue tables, consumer with brain integration, dedup, outbox, routing.
10. **marinade-notifications: subscription module** — ✅ REST API (POST/DELETE/GET), Solana off-chain message auth, SAM auction SubscriptionVerifier, telegram_status tracking.
11. **marinade-notifications: Telegram delivery** — ✅ Delegates to telegram-bot service via `POST /send` (not direct Telegram Bot API). See Section 8.8.
12. **marinade-notifications: notifications read API** — ✅ `GET /notifications` endpoint with Solana auth, filters (type, priority, inner_type, limit/offset), broadcast inclusion.

**Phase 3: Eventing module (validator-bonds)** — ✅ IMPLEMENTED

13. **eventing module** — ✅ `packages/bonds-eventing/` — DsSamSDK simulation, delta-based event generation, DB persistence, POST with retry.
14. **Eventing module tests** — ✅ Partially. 18 tests (12 evaluate-deltas + 6 emit-events). DB-dependent and integration tests deferred.
15. **Buildkite pipeline update** — ✅ Step in `collect-bonds.yml` after Store Bonds with `soft_fail`.

**Phase 4: Consumer tests (marinade-notifications)** — ✅ PARTIALLY IMPLEMENTED

16. **Pipeline unit tests** — ✅ Consumer tests with testcontainers PostgreSQL
17. **E2E tests** — ✅ bonds-event-v1 consumer E2E, subscription E2E (21 tests)
18. ~~**Schema contract tests**~~ — Replaced by generated `bonds-event-v1` package validation (both sides import the same generated types)

**Phase 5: Client integration** — ✅ PARTIALLY IMPLEMENTED

19. **CLI integration** — ✅ `subscribe`, `unsubscribe`, `subscriptions`, `show-notifications` commands. `show-notifications` is public (no auth needed), supports `--priority`, `--inner-type`, `--limit` filters. Subscription commands use off-chain Solana message signing (Ledger + keypair).
20. **PSR dashboard integration** — ✅ Notification column added to SAM table. Shows `!!`/`!`/`i` indicators per validator with color (red/yellow/blue) and tooltip with notification details. Fetches from `GET /notifications` (public, no auth).

**Phase 6: Staking-rewards migration (optional)** — NOT STARTED

21–23. Deferred. Not required for bonds v1.

**Phase 7: Operational readiness** — ❌ NOT YET

24. **Telegram delivery telemetry** — Metrics for POST /send status codes, `telegram_status` transitions, response time histograms, failed delivery logging. See `marinade-notifications/MUST_HAVE_FUTURE.md`.
25. **`@marinade.finance/bonds-notification` publishing** — Currently consumed via local file link. Needs npm publish for production deployment.
26. **Production configuration** — Notifications API URL, JWT provisioning, DsSamSDK production auction config.

---

## 10. Resolved Design Decisions

> **Note:** All major design questions (Q1–Q7, RQ1–RQ6) are now resolved. See Section 11 for remaining open items (production config, publishing).

### Q1: bonds-notification library location — RESOLVED

**Decision:** `packages/bonds-notification/` in validator-bonds repo, published to npm as `@marinade.finance/bonds-notification`. Domain knowledge belongs with domain code.

### Q2: Telegram subscription & chat_id discovery — RESOLVED & IMPLEMENTED

**Discovery:** The existing `telegram-bot` service (`/home/chalda/marinade/telegram-bot`, branch `feature-bonds`) already supports the complete deep-link subscription flow for bonds via `feature_sam_auction`.

**Implemented Telegram deep link flow:**

1. User subscribes via CLI: `validator-bonds-cli subscribe <bond> --type telegram --address @handle`
2. CLI calls marinade-notifications subscription API with pubkey + Solana signature + additional_data
3. Subscription API generates a `tracking_id` and returns a deep link: `https://t.me/<BotName>?start=feature_sam_auction-<tracking_id>`
4. CLI displays the link and opens the browser
5. User clicks the link → Telegram opens bot with `/start feature_sam_auction-<tracking_id>`
6. telegram-bot parses the deep-link, stores `(chat_id, feature_sam_auction, tracking_id)` in its own PostgreSQL
7. telegram-bot enforces one-owner-per-tracking_id (unique index on `(feature, tracking_id)`)
8. Subscription is now active — marinade-notifications delivers via `POST /send` to telegram-bot with the `tracking_id`

**Key differences from original plan:**

- No linking token / expiry / single-use mechanism in marinade-notifications — the tracking_id IS the linking key, and telegram-bot owns the `chat_id ↔ tracking_id` mapping
- telegram-bot has its own `subscriptions` table (separate from marinade-notifications). marinade-notifications stores `telegram_status` to track activation state
- The `feature_sam_auction` feature type in telegram-bot is deep-link-only (not self-service), which matches the bonds requirement that only bond authorities can subscribe

### Q3: user_id and subscription verification — RESOLVED & IMPLEMENTED

**Decision — Plugin interface for subscription verification:**

The subscription module is generic. For each `notification_type`, a **verification plugin** interface decides how to validate the subscription.

**Implemented interface** (in `notification-service/subscriptions/subscription-verifier.interface.ts`):

```typescript
interface VerificationResult {
  verifyAgainstPubkey: string // the pubkey the signature must match
  userId: string // the canonical user_id to store
}

interface SubscriptionVerifier {
  verifySubscription(
    incomingPubkey: string,
    notificationType: string,
    additionalData: Record<string, unknown>,
  ): Promise<VerificationResult | null>
}
```

**Key implementation detail:** The interface also receives `notificationType` as a parameter (added during implementation for flexibility). Verifiers are registered per notification_type via `SubscriptionsModule.forRoot(verifiers)` where `verifiers` is `Record<string, SubscriptionVerifier>`.

**For bonds type** (to be implemented in `bonds-notification` library — Work Item 6):

1. Caller sends `pubkey` (bond authority) + `additionalData: { config_address: "..." }`
2. Plugin loads the bond on-chain: derives bond PDA from `(config_address, vote_account)`
3. Finds the bond where authority matches the incoming pubkey
4. Returns `{ verifyAgainstPubkey: bond_authority, userId: vote_account }`
5. Subscription is indexed by `vote_account` (since events are per vote_account)

**Current state:** No verifier is registered yet (`SubscriptionsModule.forRoot({})`). Subscribing to any notification_type returns 422 "unsupported notification type" until a verifier plugin is registered.

This means:

- Events are indexed by `vote_account` (the natural key)
- Subscriptions are also indexed by `vote_account`
- But the signing key is the `bond_authority` (which the validator controls)
- The plugin bridges the gap

### Q4: Auction simulation data — RESOLVED

**Decision:** Eventing module replicates PSR dashboard approach — fetches up-to-date data from APIs and runs ds-sam-sdk auction simulation directly.

Data sources:

- `validators-api.marinade.finance/validators` — validator data
- `scoring.marinade.finance/api/v1/scores/sam` — bid penalties/scores
- `validator-bonds-api.marinade.finance/bonds` — bond data
- ds-sam-sdk — auction simulation + `bondGoodForNEpochs` calculation

PSR dashboard loads this data on every page visit (much more frequent than once/hour), so the APIs can handle the load.

### Q5: Admin notification flow — RESOLVED

**Decision:** Same `/bonds-event-v1` endpoint with `inner_type: "announcement"`. bonds-notification lib recognizes admin types and always passes through (no threshold evaluation, high priority).

### Q6: Schema codegen — RESOLVED

**Discovery:** marinade-notifications already has full codegen tooling:

- `message-types/` directory with `pnpm generate` command
- **TypeScript**: `json-schema-to-typescript` library → generates types + AJV validator + embedded schema
- **Rust**: `cargo typify --no-builder` → generates serde structs + schema validation
- Both generated from the same JSON Schema file in `message-types/schemas/`
- Existing pattern: add `bonds-event-v1.json` to `schemas/`, run `pnpm generate`, get both TS and Rust types

**Decision:** JSON Schema is the source of truth. Use existing `pnpm generate` pipeline. No manual type definitions needed.

### Q7: Notification data format — RESOLVED

**Decision:** Simple text data points + `details` section.

The notification `data` field contains:

- `message`: Human-readable plain text summary (simple data points, no complex formatting)
- `details`: Object with ALL raw data points used to construct the message — enables reconstructing the message if needed, and provides structured data for programmatic use

```json
{
  "data": {
    "message": "Bond underfunded: 8.5 SOL deficit. Bond covers 0.5 epochs. Top up to stay in auction.",
    "details": {
      "bond_balance_sol": 1.5,
      "required_sol": 10.0,
      "deficit_sol": 8.5,
      "bond_good_for_n_epochs": 0.5,
      "marinade_activated_stake_sol": 50000,
      "expected_max_eff_bid_pmpe": 3.2,
      "epoch": 930,
      "bond_pubkey": "...",
      "vote_account": "..."
    }
  }
}
```

The bonds-notification library generates the `message` text and populates the `details`. Delivery channels send the `message` as-is. CLI/dashboard can use `details` for richer display.

---

## 11. Design Questions (All Resolved)

### RQ1: Telegram bot ownership — RESOLVED

**Decision:** Reuse the existing telegram-bot service (`/home/chalda/marinade/telegram-bot`, branch `feature-bonds`).

The telegram-bot already has:

- `feature_sam_auction` feature type for bonds (deep-link only, not self-service)
- `POST /send` endpoint for programmatic message delivery (authenticated via `X-Send-Auth-Token` header)
- Deep-link activation: `https://t.me/<BotName>?start=feature_sam_auction-<tracking_id>`
- One-owner-per-tracking-id constraint (DB unique index on `(feature, tracking_id)`)
- Subscription storage with soft-deletion (`last_unsubscribed_at` pattern)
- Auto-unsubscribe when user blocks the bot (403 handling on /send)

**Integration model:** marinade-notifications calls `POST /send` on telegram-bot with `{ feature: "feature_sam_auction", tracking_id, text, parse_mode }`. The telegram-bot routes the message to the subscribed `chat_id` via the Telegram Bot API. No webhook sharing needed — marinade-notifications never talks to Telegram directly.

**Note:** The tracking_id is the subscription linking key. When a user subscribes via CLI, the subscription API generates a tracking_id and returns a deep link URL. The user clicks it, telegram-bot stores `(chat_id, feature_sam_auction, tracking_id)`. Later, when delivering notifications, marinade-notifications looks up the tracking_id from its subscription table and passes it to telegram-bot's `/send`.

### RQ2: Subscription additional data schema per type — RESOLVED

**Decision:** Free-form JSON with per-plugin validation. The subscription API accepts `additionalData: Record<string, unknown>` and passes it to the registered `SubscriptionVerifier` plugin for the given `notification_type`. The plugin is responsible for validating the data it needs (e.g., bonds plugin validates `config_address` is present and valid). No shared schema enforcement at the API level. Simple, v1-appropriate.

### RQ3: Linking token lifetime and security — RESOLVED

**Decisions** (validated against Telegram deep linking docs):

- **Token format:** Opaque random token, 16 bytes, base64url-encoded (= 22 characters, well within Telegram's 64-character `start` parameter limit which only allows `[A-Za-z0-9_-]`). The token is NOT a signed payload — it's a random key stored server-side. This avoids trying to cram `sign(pubkey + timestamp)` into 64 chars.
- **Lifetime:** 10 minutes. Stored server-side with `created_at`, rejected if expired.
- **Single-use:** Yes. Deleted (or marked consumed) after successful link. Prevents replay.
- **Storage:** marinade-notifications `subscriptions` table with `status: pending` and `linking_token` column. On `/start <token>`, the webhook handler looks up the token, verifies it's not expired/consumed, extracts the pubkey, saves the `chat_id`, and marks the subscription as `active`.
- **Flow:** CLI calls subscription API → API generates random token, stores it with pubkey + status:pending → returns deep link URL `https://t.me/<BotName>?start=<token>` → user clicks → bot receives `/start <token>` → bot calls subscription API to complete linking → subscription becomes active.

### RQ4: Existing telegram-bot service — RESOLVED

**Location:** `/home/chalda/marinade/telegram-bot` (branch `feature-bonds`).

The telegram-bot is a NestJS service with:

- **Features:** `feature_unstake`, `feature_select`, `feature_migrate` (self-service), `feature_sam_auction` (deep-link only, for bonds)
- **Endpoints:** `POST /webhook` (Telegram updates), `POST /send` (programmatic delivery), `GET /health`
- **Database:** PostgreSQL via Slonik — `subscriptions` table with `(chat_id, feature, tracking_id)` + soft-deletion
- **Deep-link flow:** `/start feature_sam_auction-<tracking_id>` → stores subscription → one owner per tracking_id enforced
- **Delivery:** `POST /send` authenticates via `X-Send-Auth-Token`, looks up subscription by `(feature, tracking_id)`, sends message via Telegram Bot API `sendMessage`
- **Error handling:** 403 (user blocked bot) → soft-deletes subscription; 429 → returns 429 for caller retry; 5xx → returns 502
- **Integrations:** Slack notifications on new subscriptions, Google Analytics GA4 event tracking
- **Recent changes:** Added SAM auction support, renamed `TG_SEND_AUTH_TOKEN` → `SEND_AUTH_TOKEN` (generic API key)

### RQ5: Who generates `data.message` text? — RESOLVED

**Decision:** The eventing module (emitter) generates `data.message` text and fills `data.details` with raw numbers. The consumer (via bonds-notification lib) uses the message as-is. The emitter knows the context best and the saved event logs are human-readable.

### RQ6: Emitted events persistence — RESOLVED

**Decision:** The eventing module writes every emitted event to the validator-bonds-api PostgreSQL database (the same DB used by bonds-collector and the bonds API). Each row stores the full event payload and a delivery status:

- `status: sent` — event was successfully POSTed to marinade-notifications (HTTP 200)
- `status: failed` — event could not be delivered after retry exhaustion

This provides a queryable history of all events the eventing module attempted to send. No GCS artifacts or file-based persistence needed.

**Table** (in validator-bonds-api PostgreSQL, new migration):

```sql
CREATE TABLE emitted_bond_events (
    id BIGSERIAL PRIMARY KEY,
    message_id UUID NOT NULL,           -- transport dedup key (sent to marinade-notifications)
    inner_type TEXT NOT NULL,            -- 'bond_underfunded', 'out_of_auction', etc.
    vote_account TEXT NOT NULL,
    payload JSONB NOT NULL,             -- full event data as sent
    status TEXT NOT NULL,               -- 'sent' or 'failed'
    error TEXT,                         -- error message if failed
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emitted_events_vote ON emitted_bond_events(vote_account);
CREATE INDEX idx_emitted_events_type ON emitted_bond_events(inner_type);
CREATE INDEX idx_emitted_events_created ON emitted_bond_events(created_at);
```
