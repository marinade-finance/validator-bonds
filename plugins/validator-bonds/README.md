# Validator Bonds Agent Plugin

Agent plugin skills for Marinade Validator Bonds. Covers SAM auction mechanics,
settlement types, bond lifecycle, and ecosystem navigation.

## Install

### Claude Code

**From this repo** — pass `--plugin-dir` when starting a session:

```sh
claude --plugin-dir plugins/validator-bonds
```

Or set it permanently for this project in `.claude/settings.json`:

```json
{ "pluginDirs": ["plugins/validator-bonds"] }
```

**From anywhere** — clone once, then point at the plugin directory:

```sh
git clone https://github.com/marinade-finance/validator-bonds /opt/validator-bonds
claude --plugin-dir /opt/validator-bonds/plugins/validator-bonds
```

Once loaded, skills auto-trigger on relevant keywords (CPMPE, PSR, settlement,
SAM auction, etc.) or you can invoke them explicitly with `/marinade-sam-bond`,
`/find`, `/marinade-docs`, `/marinade-ecosystem`.

### Codex

**From this repo** — no install needed. Codex picks up `.agents/skills`
automatically when run from the repo root:

```sh
codex
```

**From anywhere** — clone and use the local plugin path:

```sh
git clone https://github.com/marinade-finance/validator-bonds /opt/validator-bonds
codex plugin add /opt/validator-bonds/plugins/validator-bonds
```

## Skills

### `marinade-sam-bond`

The core Validator Bonds context skill. Covers SAM (Stake Auction Marketplace) auction
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
you are looking for. Do not use it for ecosystem navigation or program overview
questions — those belong to `marinade-ecosystem` and `marinade-sam-bond`.

**Triggers:** research X, verify X, dig into the code, check the source,
confirm a claim, trace the logic, find out how X works, .refs/ ds-sam,
what do I know about X, recall, check the facts.

### `marinade-docs`

Index of documentation URLs, live API base URLs with endpoint lists, GCS bucket
paths, and clone commands for every public and private repo. Does not cover
Validator Bonds internals — use `marinade-sam-bond` for those.

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

Quality harness for the plugin's skills. Each `evals/cases/*.yml` asks Claude
a question via `claude -p` with the plugin loaded and checks required facts and
forbidden terms. See `evals/README.md` for commands and `evals/CLAUDE.md` for
case authoring rules.

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
│   ├── cases/               # one .yml per eval case (~70 cases)
│   └── report/              # run output (gitignored)
└── skills/
    ├── find/
    │   └── SKILL.md
    ├── marinade-docs/
    │   └── SKILL.md
    ├── marinade-ecosystem/
    │   └── SKILL.md
    └── marinade-sam-bond/
        ├── SKILL.md
        ├── institutional-staking.md
        └── sam-blacklist.md
```
