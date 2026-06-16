# Validator Bonds Claude Code Plugin

A Claude Code plugin that loads domain knowledge for the Marinade Validator Bonds
protocol into Claude sessions. It provides skills covering SAM auction mechanics,
settlement types, bond lifecycle, and ecosystem navigation — turning a generic
Claude session into one that can answer precise protocol questions without web
search or manual context loading.

## Plugin Overview

The plugin lives at `plugins/validator-bonds/` inside the validator-bonds monorepo.
It is loaded by Claude Code via `--plugin-dir plugins/validator-bonds` (or
automatically when the eval harness runs). Claude Code reads `plugin.json`, then
registers the skills found under `skills/`.

Skills are not always triggered automatically. Claude Code matches the
`when_to_use` field in each skill's frontmatter against the current conversation.
For best results invoke skills explicitly with `/skill-name` or ensure the
conversation contains recognisable vocabulary from the `when_to_use` field.

**Plugin manifest:** `plugins/validator-bonds/.claude-plugin/plugin.json`

---

## Skills

### `marinade-sam-bond`

The core protocol context skill. Covers SAM (Stake Auction Marketplace) auction
mechanics, all settlement types and their `SettlementReason` enum variants
(`Bidding`, `PriorityFee`, `BidTooLowPenalty`, `BlacklistPenalty`, `BondRiskFee`,
`InstitutionalPayout`, `ProtectedEvent`), the epoch lifecycle from bid submission
through claiming window to settlement closure, bond collateral mechanics, CPMPE,
clearing price, minimum bond balance tiers, PDA seeds, and direct data
dependencies (ds-sam, ds-sam-pipeline, institutional-staking, sam-blacklist).

Load this first before any code-level settlement or SAM research. It carries
exact file paths to source symbols so the `find` skill knows where to look.

Adjacent context files loaded alongside it:

- `institutional-staking.md` — institutional staking API, payout structure
- `sam-blacklist.md` — sandwich/slow-slot detection thresholds, pipeline integration

**Triggers:** CPMPE, PMPE, PSR, SAM auction, ValidatorBond, SettlementReason,
BidTooLowPenalty, BlacklistPenalty, BondRiskFee, InstitutionalPayout,
ProtectedEvent, CommissionSamIncrease, DowntimeRevenueImpact, fund_bond,
withdraw_request, merkle settlement, clearing price, winningTotalPmpe,
epoch lifecycle, claiming window, how bonds work, how settlements work.

---

### `find`

Research and fact-recall skill. Two modes: lookup (scans `facts/*.md` and
`.diary/*.md` for existing verified facts) and research (reads source code,
`.refs/` clones, and live APIs to verify and write new facts). Single entry
point for both — if facts exist and are sufficient, answers directly; otherwise
spawns subagents to research, verify, and persist findings under `facts/`.

Use `find` for code-level detail once `marinade-sam-bond` has established what
you are looking for. Do not use it for ecosystem navigation or protocol overview
questions — those belong to `marinade-ecosystem` and `marinade-sam-bond`.

**Triggers:** research X, verify X, dig into the code, check the source,
confirm a claim, trace the logic, find out how X works, .refs/ ds-sam,
what do I know about X, recall, check the facts, check the diary.

---

### `marinade-docs`

Index of documentation URLs, live API base URLs with endpoint lists, GCS bucket
paths, and clone commands for every public and private repo. Does not cover
protocol internals — use `marinade-sam-bond` for those.

**Triggers:** where do I find, which API, API endpoint, OpenAPI schema, docs URL,
bonds API URL, scoring API, clone a repo, repo URL, GCS bucket path, what URL.

---

### `marinade-ecosystem`

Map of the Marinade Finance GitHub org: what each repo does, how repos relate,
program IDs, token mints, SDK packages, and where to file issues. Does not cover
settlement mechanics, SAM internals, or doc URLs.

**Triggers:** marinade-finance GitHub org, which repo does X, program ID,
program address, mSOL mint, MNDE token, marinade-ts-sdk, ds-sam-sdk,
cross-repo navigation, what does this repo do, file an issue.

---

## Eval System

The eval harness runs each `evals/cases/*.yaml` file through a real `claude -p`
call and checks whether the answer contains the expected facts.

### How it works

1. **Load cases** — each `.yaml` has a `question`, a list of `facts` (strings
   that must appear in the answer), and an optional `wrong_facts` list (strings
   that must NOT appear).
2. **Ask Claude** — runs `claude --plugin-dir <plugin> -p <question>` from the
   repo root with `CLAUDE_EVAL=1` set. Claude sees the full repo tree but not
   the `evals/cases/` directory (the eval runs from a tmpdir copy by default).
3. **Check facts** — for each fact:
   - Exact match (case-insensitive substring) → `method: exact`
   - No exact match → sent to `claude-haiku-4-5-20251001` as a semantic judge
     with a YES/NO prompt → `method: haiku`
   - API failure → `method: error`, case fails
4. **Check wrong_facts** — same pipeline, but pass/fail is inverted (must NOT
   match).
5. **Result** — a case passes only when all facts pass and all wrong_facts pass
   (i.e. are absent).
6. **Report** — written to `evals/report/<tag>/eval-<timestamp>.yml`.

### Running evals

From the repo root:

```bash
# Run all cases with the plugin loaded (default tag = YYYYMMDD)
pnpm eval

# List case names and questions without running (no API calls)
pnpm eval -- -l

# Run first 5 cases
pnpm eval -- -5

# Run a single case by name (no path, no extension)
pnpm eval -- bidding-settlement

# Print full model answer per case
pnpm eval -- -v

# Baseline: disable all skills
pnpm eval -- --no-skills

# Custom output tag
pnpm eval -- -t baseline-20260616

# Change model (sonnet/opus/haiku or a full model ID)
pnpm eval -- --model opus
pnpm eval -- --model claude-sonnet-4-6

# Run in the live checkout instead of an isolated temp copy
pnpm eval -- --persist

```

Or invoke directly:

```bash
cd plugins/validator-bonds
bun eval.ts -v bidding-settlement
```

### Reading results

Pass/fail summary is printed to stdout:

```
✓  program-id  What is the Validator Bonds program ID?
✗  bidding-settlement
   Q: What is a Bidding settlement in the SAM auction? ...
   [miss] active_delegation_lamports
   [ ok] Bidding
```

Full YAML log at `evals/report/<tag>/eval-<timestamp>.yml`:

```yaml
meta:
  mode: plugin:/path/to/plugins/validator-bonds
  flags: [--plugin-dir, /path/to/plugins/validator-bonds]
  plugin_dir: /path/to/plugins/validator-bonds
  tag: '20260616'
  started_at: 2026-06-16T10:00:00.000Z
cases:
  - case: bidding-settlement
    result: pass # pass | fail | error
    question: '...'
    answer: '...'
    facts:
      - fact: Bidding
        passed: true
        method: exact
      - fact: active_delegation_lamports
        passed: true
        method: haiku
    wrong_facts:
      - fact: native stakers
        passed: true # inverted: true = correctly absent
        method: exact
```

### Clean isolation (dockbox)

Running `claude -p` in the project dir picks up `~/.claude/skills/` (global
skills). To test only the validator-bonds plugin with no global skills loaded:

```bash
dockbox run --env ANTHROPIC_API_KEY -v $(pwd):/repo \
  bun /repo/plugins/validator-bonds/eval.ts \
    --plugin-dir /repo/plugins/validator-bonds
```

---

## Adding Eval Cases

### Step-by-step

1. Create `plugins/validator-bonds/evals/cases/<name>.yaml`.
2. Write a `question` that a developer or validator would plausibly ask.
3. Add `facts`: strings that must appear if the skill is working.
4. Optionally add `wrong_facts`: strings that indicate a hallucination or
   confusion between settlement types.
5. Verify that every fact is grounded in a `SKILL.md` file — if the content is
   not in the skill, the model cannot produce it from skill routing alone.
6. Run the single case to confirm:
   ```bash
   pnpm eval -- -v <name>
   ```

### What makes a good fact

**Prefer code identifiers and protocol constants** over prose descriptions:

```yaml
# Good — exact symbols that only appear if the skill was loaded
facts:
  - active_delegation_lamports
  - auction_effective_static_bid_pmpe
  - epochs_to_claim_settlement

# Weaker — model can hallucinate plausible prose without the skill
facts:
  - stakers receive compensation
  - payment comes from the bond
```

**Short strings work better** — the exact-match check is a substring check.
`bond` matches `ValidatorBond`, `bond account`, etc. A fact like
`the validator's bond account funds the settlement` is harder to match and more
likely to require the Haiku judge.

**Each fact should be independently falsifiable** — do not write a fact that is
always true regardless of skill routing. `Solana` is not a useful fact.
`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4` is.

### wrong_facts gotchas

`wrong_facts` use the same matching pipeline (exact then Haiku) with inverted
pass logic. A wrong_fact passes the check if it is absent from the answer.

Common mistakes:

- Adding a wrong_fact that is a plausible term the model might use even without
  confusion (e.g. `commission increase` on a downtime question may still appear
  as a contrast). Keep wrong_facts narrow and unambiguous.
- Adding a wrong_fact that is a synonym of a required fact. The Haiku judge
  treats paraphrase as a match, so `wrong_fact: bond account` on a case that
  requires `bond` will cause the case to fail whenever it passes.

---

## Directory Layout

```
plugins/validator-bonds/
├── .claude-plugin/
│   └── plugin.json          # plugin manifest (name, version, skills path)
├── eval.ts                  # eval harness (bun script)
├── evals/
│   ├── cases/               # one .yaml per eval case
│   │   ├── bidding-settlement.yaml
│   │   ├── blacklist-penalty.yaml
│   │   └── ...              # ~70 cases across settlement types + ecosystem
│   └── report/
│       └── <tag>/           # one subdir per run tag (default: YYYYMMDD)
│           └── eval-<timestamp>.yml
└── skills/
    ├── find/
    │   └── SKILL.md         # fact lookup + code research skill
    ├── marinade-docs/
    │   └── SKILL.md         # doc URLs, API base URLs, GCS paths, clone commands
    ├── marinade-ecosystem/
    │   ├── SKILL.md         # GitHub org map, program IDs, SDK packages
    │   └── evals/
    │       └── questions.md # manual question bank (not run by eval harness)
    └── marinade-sam-bond/
        ├── SKILL.md         # core protocol context (settlement types, epoch lifecycle)
        ├── institutional-staking.md  # institutional staking API detail
        └── sam-blacklist.md          # sandwich/slow-slot detection detail
```
