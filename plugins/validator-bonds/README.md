# Validator Bonds Agent Plugin

Agent plugin skills for the Marinade Validator Bonds protocol. It provides
context covering SAM auction mechanics, settlement types, bond lifecycle, and
ecosystem navigation.

## Install

Codex:

```sh
codex plugin marketplace add marinade-finance/validator-bonds
codex plugin add validator-bonds@marinade
```

Claude Code:

```sh
/plugin marketplace add marinade-finance/validator-bonds
/plugin install validator-bonds@marinade
```

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

### `find`

Research and fact-recall skill. Two modes: lookup (scans `facts/*.md` for
existing verified facts) and research (reads source code, `.refs/` clones, and
live APIs to verify and write new facts). Single entry point for both — if
facts exist and are sufficient, answers directly; otherwise spawns subagents to
research, verify, and persist findings under `facts/`.

Use `find` for code-level detail once `marinade-sam-bond` has established what
you are looking for. Do not use it for ecosystem navigation or protocol overview
questions — those belong to `marinade-ecosystem` and `marinade-sam-bond`.

**Triggers:** research X, verify X, dig into the code, check the source,
confirm a claim, trace the logic, find out how X works, .refs/ ds-sam,
what do I know about X, recall, check the facts.

### `marinade-docs`

Index of documentation URLs, live API base URLs with endpoint lists, GCS bucket
paths, and clone commands for every public and private repo. Does not cover
protocol internals — use `marinade-sam-bond` for those.

**Triggers:** where do I find, which API, API endpoint, OpenAPI schema, docs URL,
bonds API URL, scoring API, clone a repo, repo URL, GCS bucket path, what URL.

### `marinade-ecosystem`

Map of the Marinade Finance GitHub org: what each repo does, how repos relate,
program IDs, token mints, SDK packages, and where to file issues. Does not cover
settlement mechanics, SAM internals, or doc URLs.

**Triggers:** marinade-finance GitHub org, which repo does X, program ID,
program address, mSOL mint, MNDE token, marinade-ts-sdk, ds-sam-sdk,
cross-repo navigation, what does this repo do, file an issue.

## Eval System

The eval harness runs each `evals/cases/*.yaml` file through a real `claude -p`
call and checks whether the answer contains the expected facts.

### How it works

1. **Load cases** — each `.yaml` has a `question`, a list of `facts` (strings
   that must appear in the answer), and an optional `wrong_facts` list (strings
   that must NOT appear).
2. **Ask Claude** — runs `claude -p <question>` with the plugin skills loaded
   and `CLAUDE_EVAL=1` set. By default Claude runs in an isolated copy of the
   repo under `/tmp/vb-eval-*` (use `--persist` to run in the live checkout).
3. **Check facts** — for each fact:
   - Exact match (case-insensitive substring) → `method: exact`
   - No exact match → sent to `claude-haiku-4-5-20251001` as a semantic judge
     with a YES/NO prompt → `method: haiku`
   - API failure → `method: error`, case fails
4. **Check wrong_facts** — exact match only, inverted: must NOT appear.
5. **Result** — a case passes only when all facts pass and all wrong_facts pass
   (i.e. are absent).
6. **Report** — written to `evals/report/<tag>/eval-<timestamp>.yml`.

### Running evals

From the repo root:

```bash
pnpm eval                              # all cases, Sonnet
pnpm eval -- -l                        # list cases without running
pnpm eval -- -5                        # first 5 cases
pnpm eval -- bidding-settlement        # single case by name
pnpm eval -- -v bidding-settlement     # verbose: print full answer
pnpm eval -- --model opus              # use Opus
pnpm eval -- -t mytag case1 case2      # named run, specific cases
pnpm eval -- --persist                 # run in the live checkout, not a temp copy
```

### Reading results

Pass/fail summary is printed to stdout (failures list each missing fact and any
forbidden `wrong_facts` that appeared):

```
✓ program-id
✗ bidding-settlement
  missing: active_delegation_lamports
  wrong_fact: native stakers
```

Full YAML log at `evals/report/<tag>/eval-<timestamp>.yml`.

## Adding Eval Cases

See `evals/CLAUDE.md` for full guidance. Short version:

1. Create `evals/cases/<name>.yaml` with `question`, `facts`, optional `wrong_facts`.
2. Facts must be grounded in a `SKILL.md` — if the content is not in the skill,
   the model cannot produce it from skill routing alone.
3. Use code identifiers (`epochs_to_claim_settlement`) not prose (`stakers get paid`).
4. Don't give the formula or answer in the question body — cite the source file
   and give input values; let the model discover the formula.
5. Test: `pnpm eval -- -v <name>`

## Directory Layout

```
plugins/validator-bonds/
├── .claude-plugin/
│   └── plugin.json          # Claude Code manifest (name, version, skills path)
├── .codex-plugin/
│   └── plugin.json          # Codex manifest
├── README.md                # this file
├── CLAUDE.md                # plugin developer notes
├── eval.ts                  # eval harness (bun script)
├── evals/
│   ├── README.md            # eval command reference + case format
│   ├── CLAUDE.md            # case authoring guide
│   ├── cases/               # one .yaml per eval case (~70 cases)
│   └── report/              # run output (gitignored)
└── skills/
    ├── find/
    │   └── SKILL.md
    ├── marinade-docs/
    │   └── SKILL.md
    ├── marinade-ecosystem/
    │   ├── SKILL.md
    │   └── evals/
    │       └── questions.md # manual question bank (not run by eval harness)
    └── marinade-sam-bond/
        ├── SKILL.md
        ├── institutional-staking.md
        └── sam-blacklist.md
```
