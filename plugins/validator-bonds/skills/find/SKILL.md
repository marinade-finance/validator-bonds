---
name: find
description: Deep code research against primary sources (source code, .refs/ clones, live APIs) — writes a verified fact file and answers with citations. General-purpose; works for any code question in this repo or its upstreams. NOT a substitute for protocol context: load marinade-sam-bond first for settlement/SAM context, then use find for code-level detail. NOT for Marinade doc/repo navigation (use marinade-docs) or stored-knowledge lookup (use recall-memories).
when_to_use: research X, verify X, dig into the code, check the source, confirm a claim, is this true, where in the program does, read the implementation, recall-memories returned no match, fact needs code verification, trace the logic, find out how X works in the code, .refs/ ds-sam, primary source
user-invocable: true
arg: <question or topic to research>
---

# Find

Research → verify against primary source → write to `facts/` → answer with citation.
Always use subagents. Never research in main context.

> **Before researching settlement or SAM questions, load `/marinade-sam-bond`** —
> it has the settlement type table with exact file paths and the protocol
> vocabulary. `find` is for code-level detail once you know what you're looking
> for, not for re-deriving protocol context from scratch.

## Step 1: Check existing facts

Glob `facts/*.md` and grep for the topic. If a matching fact exists and
`verified_at` is within 30 days, use it directly — skip to Step 3.

## Step 2: Research (subagent)

Tools: Read, Glob, Grep, Bash, WebFetch.

Primary sources in priority order:

**1. This repo — authoritative for on-chain and settlement behavior.**

- `programs/validator-bonds/src/` — on-chain Anchor program: state accounts,
  instructions, PDA seeds.
- `settlement-distributions/` — off-chain settlement generation
  (`settlement-common`, `bid-distribution`, `institutional-distribution`,
  `merkle-generator`).
- `settlement-pipelines/` — on-chain settlement lifecycle binaries.
- `packages/` — TS SDK, CLIs, sanity-check, codama, eventing.
- `settlement-config.yaml` — settlement types, fee splits, whitelists.

When the question is "where is X" rather than "is X true", grep the tree;
don't guess a path.

**2. `.refs/` clones — upstream repos this project consumes.**

Clone if absent before reading:

```bash
git clone https://github.com/marinade-finance/ds-sam .refs/ds-sam
git clone https://github.com/marinade-finance/ds-sam-pipeline .refs/ds-sam-pipeline
```

ds-sam is a pnpm monorepo — the SDK source lives under
`packages/ds-sam-sdk/src/`, not a top-level `src/`:

| Question about                            | Look here                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| SAM auction clearing price                | `.refs/ds-sam/packages/ds-sam-sdk/src/auction.ts`                      |
| BidTooLow trigger, tolCoef, bond risk fee | `.refs/ds-sam/packages/ds-sam-sdk/src/calculations.ts`                 |
| `minBondBalanceSol`, stake-cap tiers      | `.refs/ds-sam/packages/ds-sam-sdk/src/constraints.ts`, `.../config.ts` |
| SAM input/output DTOs                     | `.refs/ds-sam/packages/ds-sam-sdk/src/types.ts`                        |
| Epoch auction outputs                     | `.refs/ds-sam-pipeline/auctions/<epoch>/outputs/`                      |

Private upstreams already cloned under `.refs/`: `ds-scoring`,
`sam-blacklist`, `institutional-staking`, `stakes-etl`. If one is absent it
requires `gh auth login` to clone — note any claim from an inaccessible repo
as upstream-unverifiable. Logic in `.refs/` can change when those repos
update; always record the upstream source so readers know to re-verify.

**3. Live APIs** (read-only):

```bash
curl -s "https://validator-bonds-api.marinade.finance/bonds/bidding" | jq ...
curl -s "https://scoring.marinade.finance/api/v1/scores/sam?epoch=<N>" | jq ...
curl -s "https://institutional-staking.marinade.finance/v1/epoch/latest" | jq ...
```

Use `/marinade-docs` for the full API and docs index.

## Fact file format

Write new facts to `facts/<slug>.md`, one fact per file:

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

At least one inline citation per non-trivial claim.

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
5. **Upstream claims flagged** — logic in `.refs/` repos can change when those
   repos update; note the upstream source explicitly so readers re-verify

Delete facts that fail any check. If a fact can't be verified at all,
don't write it — an unverified fact is worse than no fact.

## Step 4: Answer

Read surviving fact files, answer the original question. Cite inline:

```
BidTooLowPenalty fires when a validator reduces its bid vs the previous epoch.

---
source: .refs/ds-sam/packages/ds-sam-sdk/src/calculations.ts:248
field:  revShare.bidPmpe < tolCoef * (pastAuction?.bidPmpe ?? 0)
```

Cite file:line or URL. Never "probably" or "likely" — either you read it or you didn't.
