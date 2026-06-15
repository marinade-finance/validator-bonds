---
name: find
description: >
  Research a validator-bonds / SAM protocol question against primary sources
  (source code, refs/, facts/). USE when /recall-memories returns no match,
  a claim needs code verification, or "research X / verify X". NOT for live
  validator data (query the bonds API directly), general Marinade navigation
  (use marinade-docs), or stored knowledge lookup (use /recall-memories).
user-invocable: true
arg: <question or topic to research>
---

# Find

Research → verify against primary source → write to `facts/` → answer with citation.
Always use subagents. Never research in main context.

## Step 1: Check existing facts

Glob `facts/*.md` and grep for the topic. If a matching fact exists and
`verified_at` is within 30 days, use it directly — skip to Step 3.

## Step 2: Research (subagent)

Tools: Read, Glob, Grep, Bash, WebFetch.

Primary sources in priority order:

**1. This repo — the only authoritative truth for on-chain and settlement behavior.**

| Question about                                  | Look here                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Settlement types / `SettlementReason` enum      | `settlement-distributions/settlement-common/src/settlement_collection.rs:32` |
| Protected events (PSR, commission, downtime)    | `settlement-distributions/settlement-common/src/protected_events.rs`         |
| Bid distribution logic (PriorityFee, penalties) | `settlement-distributions/bid-distribution/src/generators/`                  |
| On-chain program state / instructions           | `programs/validator-bonds/src/`                                              |
| Config fields (`withdraw_lockup_epochs`, etc.)  | `programs/validator-bonds/src/state/config.rs`                               |
| Settlement parameters (fees, splits)            | `settlement-config.yaml`                                                     |
| TS SDK queries / PDA derivation                 | `packages/validator-bonds-sdk/src/`                                          |

**2. `.refs/` clones — upstream repos this project consumes.**

Clone if absent before reading:

```bash
git clone https://github.com/marinade-finance/ds-sam .refs/ds-sam
git clone https://github.com/marinade-finance/ds-sam-pipeline .refs/ds-sam-pipeline
```

| Question about                                | Look here                                                       |
| --------------------------------------------- | --------------------------------------------------------------- |
| SAM auction clearing price                    | `.refs/ds-sam/src/auction.ts`                                   |
| BidTooLow trigger, tolCoef                    | `.refs/ds-sam/src/calculations.ts`                              |
| `minBondBalanceSol`, `clipBondStakeCap` tiers | `.refs/ds-sam/src/constraints.ts`, `.refs/ds-sam/src/config.ts` |
| Epoch auction outputs                         | `.refs/ds-sam-pipeline/auctions/<epoch>/outputs/`               |

Private repos (`ds-scoring`, `sam-blacklist`, `institutional-staking`) require
`gh auth login`. Note claims from these as upstream-unverifiable if inaccessible.

**3. Live APIs** (read-only):

```bash
curl -s "https://validator-bonds-api.marinade.finance/bonds/bidding" | jq ...
curl -s "https://scoring.marinade.finance/api/v1/scores/sam?epoch=<N>" | jq ...
```

Use `/marinade-docs` for the full API and docs index.

Write new facts to `facts/<slug>.md`:

```yaml
---
topic: <specific topic>
category: <sam-auction|settlement|on-chain|bond-lifecycle|scoring>
verified_at: <ISO timestamp>
sources:
  - <file:line or URL — required, ≥1>
summary: >
  <one sentence for fast recall>
---
<claim + supporting evidence with direct quotes or line excerpts>
```

One fact per file. At least one inline citation per non-trivial claim.

## Step 3: Verify (subagent per batch of 5)

Each fact must pass all checks before `verified_at` is set:

1. **Source accessible** — every file:line exists; every URL returns 200
2. **Claim matches source** — open the source, read it, confirm the body
   matches what the source actually says; paraphrase drift is the most
   common failure mode
3. **No contradiction** — grep `facts/` for conflicting claims; if two
   disagree, investigate and delete the wrong one
4. **Numbers recomputed** — any quantity, rate, or percentage must be
   re-read from source, not copied from a summary
5. **Upstream claims flagged** — logic in `refs/ds-sam/`, `ds-scoring`,
   `sam-blacklist` can change when those repos update; note the upstream
   source explicitly so readers know to re-verify

Delete facts that fail any check. If a fact can't be verified at all,
don't write it — an unverified fact is worse than no fact.

## Step 4: Answer

Read surviving fact files, answer the original question. Cite inline:

```
BidTooLowPenalty fires when a validator reduces its bid vs the previous epoch.

---
source: refs/ds-sam/src/calculations.ts:248
field:  revShare.bidPmpe < tolCoef * (pastAuction?.bidPmpe ?? 0)
```

Cite file:line or URL. Never "probably" or "likely" — either you read it or you didn't.
