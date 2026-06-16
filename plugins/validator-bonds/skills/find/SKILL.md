---
name: find
description: Answer questions from stored facts in `facts/`, or research new questions against primary sources (source code, .refs/ clones, live APIs) and write verified facts. Single entry point for both lookup and research. NOT for Marinade doc/repo navigation (use marinade-docs); NOT for settlement/SAM protocol context (load marinade-sam-bond first).
when_to_use: research X, verify X, dig into the code, check the source, confirm a claim, is this true, where in the program does, read the implementation, fact needs code verification, trace the logic, find out how X works in the code, .refs/ ds-sam, primary source, what do I know about X, do we have a fact on, recall, look up stored knowledge, check the facts
user-invocable: true
arg: <question or topic to research>
---

# Find

Lookup → answer from facts if sufficient → otherwise research, verify, write, answer.
Always use subagents. Never research in main context.

> **For settlement/SAM questions, load `/marinade-sam-bond` first** — it has the
> settlement type table with exact file paths and protocol vocabulary. Use `find`
> for code-level detail once you know what you're looking for.

## Step 1: Check existing facts

Spawn an Explore subagent. It:

1. Greps `summary:` in `facts/*.md`
2. Returns: file path, one-line summary, why it matches

List matched files, what each says, whether it answers, what gap remains.
Verdict: answer directly (sufficient), refresh via Step 2 (stale/partial), or research fresh (no match).

**If facts fully answer the question — answer now. Skip Steps 2–3.**

## Step 2: Research (subagent)

Tools: Read, Glob, Grep, Bash, WebFetch.

**Load context skills first, then dig:**

- `/marinade-sam-bond` — settlement type table with exact file paths, epoch
  lifecycle, `.refs/` repo pointers. Load this before any settlement/SAM dig.
- `/marinade-docs` — repo clone commands, live API base URLs, GCS bucket paths.
- `/marinade-ecosystem` — what each repo/package does, program IDs, SDK map.

Once you know what you're looking for: grep the tree for the exact symbol or
path; don't guess. For `.refs/` repos (ds-sam, ds-sam-pipeline, etc.) check
they're cloned under `.refs/` before reading — clone commands are in
`/marinade-docs`. Note any claim from a private `.refs/` repo as
upstream-unverifiable; those repos can change independently.

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
2. **Claim matches source** — open the source, read it; paraphrase drift is the most common failure
3. **No contradiction** — grep `facts/` for conflicting claims; investigate and delete the wrong one
4. **Numbers recomputed** — any quantity, rate, or percentage re-read from source, not copied from a summary
5. **Upstream claims flagged** — logic in `.refs/` repos can change; record the upstream source explicitly

Delete facts that fail any check. An unverified fact is worse than no fact.

## Step 4: Answer

Read surviving fact files, answer the original question. Cite inline:

```
BidTooLowPenalty fires when a validator reduces its bid vs the previous epoch.

---
source: .refs/ds-sam/packages/ds-sam-sdk/src/calculations.ts:248
field:  revShare.bidPmpe < tolCoef * (pastAuction?.bidPmpe ?? 0)
```

Cite file:line or URL. Never "probably" or "likely" — either you read it or you didn't.
