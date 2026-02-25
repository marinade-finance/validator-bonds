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
│  ┌──────────────┐    ┌──────────────────────┐                          │
│  │bonds-collector│───>│  eventing module (TS) │                         │
│  │  (Rust CLI)   │    │  - stateless          │                         │
│  └──────────────┘    │  - runs after collect  │                         │
│                       │  - fetches auction data│                         │
│                       │  - emits raw events    │                         │
│                       │  - generates notif. ID │                         │
│                       └─────────┬──────────────┘                        │
│                                 │ POST /bonds-event-v1                  │
│  ┌──────────────────────────┐   │                                       │
│  │ bonds-notification (lib) │   │  ← also consumed by marinade-notif.  │
│  │  - YAML threshold config │   │                                       │
│  │  - priority/relevance    │   │                                       │
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
│  │  3. checks dedup table → skip if recently delivered          │       │
│  │  4. looks up subscriptions table → get channels per user     │       │
│  │  5. routes to delivery processors:                           │       │
│  │     ├─ Telegram (REST API) → sendMessage to chat_id          │       │
│  │     └─ API (DB save) → insert into notifications_outbox      │       │
│  │  6. updates dedup table on successful delivery               │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐        │
│  │ subscription API     │   │ notifications read API            │        │
│  │  POST /subscriptions │   │  GET /notifications               │        │
│  │  DELETE /subscriptions│  │  - filter: type, user_id,         │        │
│  │  - Solana sig verify │   │    priority, inner_type, recency  │        │
│  └─────────────────────┘   └──────────────────────────────────┘        │
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
6. For each condition met, emits a raw event with a deterministic `notification_id`
7. POSTs event to `marinade-notifications /bonds-event-v1` endpoint
8. Consumer processes: bonds-notification lib evaluates → dedup check → subscription lookup → delivery

### Message Flow — Admin Notifications

1. Admin POSTs to `marinade-notifications /bonds-event-v1` with `inner_type: "announcement"` (or similar)
2. Consumer processes: bonds-notification lib recognizes admin type → always notify, high priority
3. Delivers to all subscribers (or filtered by target criteria in payload)

---

## 8. Implementation Plan

### 8.1 bonds-notification Library

**Location:** `packages/bonds-notification/` in validator-bonds repo (published to npm as `@marinade.finance/bonds-notification`)

**Purpose:** Business logic "brain" — decides IF to notify, at what priority, and how often. Consumed by both the eventing module and marinade-notifications consumer.

**Contents:**

- `config.yaml` — threshold configuration, packed inside the library
- `evaluate.ts` — main function: takes raw event + config → returns `{shouldNotify, priority, relevanceDuration, notificationId}` or null
- `types.ts` — shared TypeScript types for bond events (generated from JSON Schema)
- `schema/bonds-event-v1.json` — JSON Schema for the event payload (shared with marinade-notifications codegen)

**YAML config example:**

```yaml
thresholds:
  bond_underfunded:
    # Minimum deficit to trigger notification (absolute SOL)
    min_deficit_sol: 0.5
    # Priority based on bondGoodForNEpochs
    priority_rules:
      - condition: 'bondGoodForNEpochs < 2'
        priority: critical
      - condition: 'bondGoodForNEpochs < 10'
        priority: warning
    # Re-notify if deficit changes by more than this %
    significant_change_pct: 10
    # Re-notify interval if condition persists unchanged
    renotify_interval_hours: 24
    # How long the notification stays relevant
    relevance_hours: 120 # 5 days

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

**Notification ID generation** (deterministic, for dedup):

- `bond_underfunded`: `sha256(bond_pubkey + "underfunded" + amount_bucket)` where `amount_bucket = floor(deficit_sol / (deficit_sol * significant_change_pct / 100))`
- `out_of_auction`: `sha256(bond_pubkey + "out_of_auction" + epoch)`
- `stake_capped`: `sha256(bond_pubkey + "stake_capped" + cap_bucket)`

The notification_id changes only when the situation changes significantly, ensuring dedup works correctly.

### 8.2 Event Schema (bonds-event-v1)

**JSON Schema** — used by both marinade-notifications codegen and Rust (via serde):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": [
    "type",
    "inner_type",
    "vote_account",
    "notification_id",
    "data",
    "created_at"
  ],
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
    "vote_account": {
      "type": "string",
      "description": "Validator vote account pubkey"
    },
    "bond_pubkey": { "type": "string", "description": "Bond account pubkey" },
    "epoch": { "type": "integer" },
    "notification_id": {
      "type": "string",
      "description": "Deterministic dedup key"
    },
    "priority": { "enum": ["critical", "warning", "info"] },
    "relevance_hours": {
      "type": "integer",
      "description": "How long this notification is relevant"
    },
    "data": {
      "type": "object",
      "description": "Inner-type-specific payload",
      "properties": {
        "bond_balance_sol": { "type": "number" },
        "required_sol": { "type": "number" },
        "deficit_sol": { "type": "number" },
        "bond_good_for_n_epochs": { "type": "number" },
        "current_stake_sol": { "type": "number" },
        "capped_stake_sol": { "type": "number" },
        "message": { "type": "string", "description": "Human-readable summary" }
      }
    },
    "created_at": { "type": "string", "format": "date-time" }
  }
}
```

### 8.3 Eventing Module (validator-bonds)

**Location:** `packages/bonds-eventing/` in validator-bonds repo

**Runs as:** Node.js script in Buildkite, new step in `collect-bonds.yml` after bonds-collector

**Dependencies:**

- `@marinade.finance/bonds-notification` — for threshold evaluation and notification ID generation
- `@marinade.finance/ds-sam-sdk` — for auction simulation (same as PSR dashboard)
- `ts-message-client` from marinade-notifications — for posting to notification service

**Flow:**

1. Fetch current bond data from validator-bonds-api (`/v1/bonds`)
2. Fetch validator/auction data (validators-api, scoring API)
3. Run ds-sam-sdk auction simulation (same approach as PSR dashboard)
4. For each bonded validator, compute `bondGoodForNEpochs` and auction status
5. Call `bonds-notification.evaluate(event)` for each condition
6. If `shouldNotify` is true, POST to marinade-notifications with the event

**Stateless design:** No database, no memory of previous runs. The bonds-notification library's threshold + notification_id logic ensures appropriate dedup downstream.

### 8.4 New Topic in marinade-notifications (bonds-event-v1)

Following the existing per-topic pattern:

**Files to create:**

1. `message-types/schemas/bonds-event-v1.json` — JSON Schema (from 8.2)
2. `message-types/typescript/bonds-event-v1/src/index.ts` — generated types + validator
3. `notification-service/migrations/03-bonds-event-v1.sql` — inbox/archive/DLQ tables
4. `notification-service/ingress/bonds-event-v1/controller.ts` — POST endpoint
5. `notification-service/ingress/bonds-event-v1/service.ts` — enqueue logic
6. `notification-service/ingress/bonds-event-v1/module.ts` — module registration
7. `notification-service/consumers/bonds-event-v1/consumer.ts` — consumer with bonds-notification integration
8. `notification-service/consumers/bonds-event-v1/module.ts` — consumer module

**Register in:**

- `notification-service/app.module.ts` — add ingress + consumer modules
- `notification-service/queues/queues.service.ts` — add to `TOPIC_TABLE_MAP`

**Consumer logic** (different from staking-rewards consumer):

1. Dequeue message from inbox
2. Validate payload against schema
3. Load `bonds-notification` library, call `evaluate(payload)` → get threshold decision
4. If `shouldNotify` is false → archive (not relevant enough)
5. Check `bonds_dedup` table: is `notification_id` already delivered within `renotify_interval`?
6. If deduped → archive (already notified recently)
7. Query `subscriptions` table for `user_id = vote_account` (or bond authority)
8. For each subscription channel:
   - `telegram`: call TelegramService.sendMessage(chatId, formattedMessage)
   - `api`: insert into `notifications_outbox` table
9. Update `bonds_dedup` table with delivery timestamp
10. Archive message

### 8.5 Dedup Mechanism

**New table** in marinade-notifications:

```sql
CREATE TABLE bonds_notification_dedup (
    notification_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivery_count INT NOT NULL DEFAULT 1,
    PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX idx_dedup_user ON bonds_notification_dedup(user_id);
```

**Logic in consumer:**

```
SELECT last_delivered_at FROM bonds_notification_dedup
WHERE notification_id = $1 AND user_id = $2;

IF found AND (now() - last_delivered_at) < renotify_interval:
  → skip (already delivered recently)
ELSE:
  → deliver, then UPSERT into dedup table
```

The notification_id changes when the situation changes significantly (e.g., deficit grows by >10%), so a changed notification_id bypasses dedup automatically.

### 8.6 Subscription Module (marinade-notifications)

**New tables:**

```sql
CREATE TABLE subscriptions (
    id BIGSERIAL,
    user_id TEXT NOT NULL,           -- Solana pubkey for bonds
    notification_type TEXT NOT NULL,  -- 'bonds', future: 'staking-rewards'
    channel TEXT NOT NULL,            -- 'telegram', 'api', future: 'email'
    channel_address TEXT NOT NULL,    -- chat_id for telegram, '' for api
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,          -- soft delete (insert-only, latest row wins)
    PRIMARY KEY (id)
);
CREATE INDEX idx_sub_user_type ON subscriptions(user_id, notification_type);
CREATE INDEX idx_sub_active ON subscriptions(user_id, notification_type, channel)
    WHERE deleted_at IS NULL;
```

**Insert-only with latest row semantics** (as requested):

- New subscription = INSERT new row
- Update subscription = INSERT new row with updated data (old row stays)
- Delete subscription = INSERT new row with `deleted_at` set
- Query: `SELECT DISTINCT ON (user_id, notification_type, channel) ... ORDER BY created_at DESC` where `deleted_at IS NULL`

**API endpoints:**

```
POST /subscriptions
  Body: { user_id, notification_type, channel, channel_address, signature, message }
  Auth: Solana signature verification (see below)

DELETE /subscriptions
  Body: { user_id, notification_type, channel, signature, message }
  Auth: Solana signature verification
```

**Solana signature verification:**

- Client signs a structured message: `"Subscribe {notification_type} {channel} {timestamp}"`
- Server verifies using `@solana/web3.js` `nacl.sign.detached.verify(message, signature, publicKey)`
- Prevents unauthorized subscription management (only the keypair owner can subscribe)

**New files:**

1. `notification-service/subscriptions/subscriptions.controller.ts`
2. `notification-service/subscriptions/subscriptions.service.ts`
3. `notification-service/subscriptions/subscriptions.module.ts`
4. `notification-service/subscriptions/solana-auth.guard.ts` — Solana signature verification guard
5. `notification-service/migrations/04-subscriptions.sql`

### 8.7 Telegram Delivery Processor (marinade-notifications)

**New service:** `notification-service/telegram/telegram.service.ts`

**Pattern:** Same as IntercomService — NestJS service with @Retry decorator, APM spans, metrics.

**Implementation:**

```typescript
@Injectable()
class TelegramService {
  @Retry<ConfigService>({ getConfig: c => c.telegramRetryOptions })
  @CaptureSpan('telegram.sendMessage')
  async sendMessage(chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
  }
}
```

**Config additions:**

- `TELEGRAM_BOT_TOKEN` — env var
- `TELEGRAM_MAX_RETRIES` — default 3
- `TELEGRAM_RETRY_BASE_DELAY_MS` — default 2000
- `TELEGRAM_DRY_RUN` — for testing

**New files:**

1. `notification-service/telegram/telegram.service.ts`
2. `notification-service/telegram/telegram.module.ts`

### 8.8 Notifications Read API (marinade-notifications)

**New table:**

```sql
CREATE TABLE notifications_outbox (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,     -- 'bonds'
    inner_type TEXT NOT NULL,            -- 'bond_underfunded', 'announcement', etc.
    priority TEXT NOT NULL,              -- 'critical', 'warning', 'info'
    notification_id TEXT NOT NULL,       -- dedup key (for client-side dedup)
    payload JSONB NOT NULL,              -- full event data
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL      -- created_at + relevance_hours
);
CREATE INDEX idx_outbox_user ON notifications_outbox(user_id, notification_type);
CREATE INDEX idx_outbox_expires ON notifications_outbox(expires_at);
```

**API endpoint:**

```
GET /notifications?user_id={pubkey}&type=bonds&priority=critical&inner_type=bond_underfunded&limit=50
  Auth: Solana signature (same as subscriptions) or JWT (for internal use)
  Response: [{ id, inner_type, priority, notification_id, payload, created_at, expires_at }]
  Filters: Only returns non-expired notifications (expires_at > now())
```

**New files:**

1. `notification-service/notifications/notifications.controller.ts`
2. `notification-service/notifications/notifications.service.ts`
3. `notification-service/notifications/notifications.module.ts`
4. `notification-service/migrations/05-notifications-outbox.sql`

**Consumers:** CLI and PSR dashboard poll this endpoint to show notifications.

---

## 9. Work Items

Ordered by dependency:

1. **bonds-notification library** — types, schema, YAML config, evaluate function
2. **Event schema** — JSON Schema for bonds-event-v1 (in bonds-notification, copied to marinade-notifications)
3. **marinade-notifications: new topic** — migration, ingress, consumer skeleton
4. **marinade-notifications: subscription module** — tables, API, Solana auth guard
5. **marinade-notifications: Telegram service** — REST-based message sending
6. **marinade-notifications: notifications outbox + read API** — table, endpoint
7. **marinade-notifications: dedup table + logic** — in consumer
8. **marinade-notifications: bonds-event consumer** — full integration (bonds-notification lib + dedup + subscriptions + delivery routing)
9. **eventing module** — data fetching, ds-sam-sdk simulation, event generation, posting to notification service
10. **Buildkite pipeline update** — add eventing module step to collect-bonds.yml
11. **CLI integration** — subscribe/unsubscribe commands, poll notifications endpoint
12. **PSR dashboard integration** — poll notifications endpoint, replace hardcoded banner

---

## 10. Open Design Questions

### Q1: Where should the bonds-notification library live?

**Option A:** `packages/bonds-notification/` in validator-bonds repo → published to npm

- Pro: Domain knowledge lives with domain code, versioned with bonds changes
- Con: marinade-notifications depends on a package from another repo

**Option B:** Package in marinade-notifications monorepo

- Pro: Co-located with consumer code
- Con: Business logic for bonds leaks into notification infra repo

**Option C:** Standalone repo

- Pro: Clean separation
- Con: Overhead of another repo

**Leaning:** Option A — bonds business logic belongs in the bonds repo.

### Q2: How does Telegram chat_id discovery work?

Telegram REST API requires `chat_id` to send messages. The user subscribes via CLI with their Solana keypair, but we need to map that to a Telegram chat_id.

**Option A:** User starts the Telegram bot → bot saves `chat_id` → user enters their Telegram username in CLI → we look up chat_id by username in our records

- Requires bot webhook/polling to capture `/start` events

**Option B:** User starts the bot → bot generates a one-time code → user enters code in CLI → code is verified and linked to pubkey

- More secure, no username needed
- Requires bot webhook/polling for the initial code generation

**Option C:** User interacts with bot → bot asks for their pubkey → bot creates subscription directly (no CLI needed for Telegram)

- Simplest for user, but bot needs to verify pubkey ownership somehow

**This requires discussion** — all options need some form of bot interaction beyond just REST sendMessage.

### Q3: What is the user_id for subscription/notification lookup?

The KEYPOINTS mention pubkey as user_id. But which pubkey?

**Option A:** Vote account address — validators know this, it's public
**Option B:** Bond authority — the keypair that manages the bond
**Option C:** Withdraw authority of the bond

Vote account is the most natural (it's what PSR dashboard and APIs use), but the subscription signature must come from a keypair the validator controls (likely bond authority or validator identity).

**Possible approach:** Subscribe with bond_authority signature, but index notifications by vote_account (since events are per vote_account). The subscription links authority → vote_account.

### Q4: How does the eventing module get auction simulation data?

The eventing module needs to replicate what PSR dashboard does:

- Fetch all validators from validators-api
- Fetch scoring data
- Run ds-sam-sdk auction simulation
- Compute bondGoodForNEpochs per validator

This is non-trivial (PSR dashboard does this client-side with significant code). Options:

**Option A:** Eventing module runs ds-sam-sdk directly (duplicates PSR dashboard logic)
**Option B:** There's an API that already computes auction results (ds-sam-pipeline outputs?)
**Option C:** bonds-collector is extended to store computed auction results that eventing module reads

**This needs clarification** — what's the easiest way to get auction simulation results in the eventing module?

### Q5: Admin notification flow

The KEYPOINTS describe two use cases: automated events and admin notifications.

**Option A:** Admin POSTs to the same `/bonds-event-v1` endpoint with `inner_type: "announcement"`

- Simple, reuses existing pipeline
- bonds-notification lib recognizes admin types and always passes through

**Option B:** Separate admin API endpoint that bypasses threshold evaluation

- Cleaner separation
- But adds another endpoint to maintain

**Leaning:** Option A — keep it simple, use `inner_type` to distinguish.

### Q6: Should the JSON Schema be the source of truth for both TS and Rust types?

The KEYPOINTS mention "json data should be defined as some schema to be possible to be loaded by rust as well."

**Option A:** JSON Schema → codegen for both TypeScript (existing marinade-notifications pattern) and Rust (via `typify` or `schematools`)
**Option B:** Define types manually in both languages, use JSON Schema only for validation
**Option C:** Use protobuf as source of truth, generate both TS and Rust

**Leaning:** Option A — JSON Schema as source of truth matches existing marinade-notifications pattern. Rust types can be manually defined for now (the event payload is simple enough).

### Q7: Notification message formatting

Who formats the human-readable notification text?

**Option A:** bonds-notification library generates formatted text (Markdown for Telegram, plain text for API)

- Pro: Formatting is a business decision, lives with business logic
- Con: Library needs to know about all delivery channels

**Option B:** Consumer formats using templates based on inner_type + channel

- Pro: Channel-specific formatting in channel-specific code
- Con: Formatting logic split across projects

**Leaning:** Option A for v1 — the library returns a formatted `message` string, Telegram sends it as-is. Can be refined later.
