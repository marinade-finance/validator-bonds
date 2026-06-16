# Validator Bonds Skill Evals

Automated eval runner for Claude Code skill routing. Asks Claude questions and
checks that answers contain expected facts — testing whether skills trigger and
surface the right content.

## Quick Start

From the repo root:

```bash
# List all cases with questions (no API calls)
pnpm eval -- -l

# Run all cases (default: ./cases/; plugin auto-loaded via package.json)
pnpm eval

# Run only first 2 cases
pnpm eval -- -2

# Single case (with full answer printed)
pnpm eval -- -v cases/bidding-settlement.yaml

# Baseline — disable all skills for comparison
pnpm eval -- --no-skills

# Override which plugin is loaded (default comes from package.json)
pnpm eval -- --plugin-dir some/other/plugin

# Custom output tag (default: YYYYMMDD)
pnpm eval -- -t baseline-20260527

# Keep the copied tree after the run (default: fresh tmpdir, cleaned up)
pnpm eval -- --persist
```

Or run `bun eval.ts` directly from `plugins/validator-bonds/evals/`.

**Flags:** `-l` / `--list` (list only), `-v` / `--verbose` (print full answer),
`-N` / `--limit N` (run first N cases, shorthand `-N` e.g. `-3`),
`-t <tag>` (output tag), `--no-skills` (baseline), `--plugin-dir <path>`,
`--persist` (keep the copied tree; default is an ephemeral tmpdir, cleaned up).

Output: pass/fail per case, missing facts printed inline, detailed YAML log at
`./report/<tag>/eval-<timestamp>.yml`.

## Clean Isolation (dockbox)

`claude -p` in the project dir picks up `~/.claude/skills/` (global skills).
To test only validator-bonds skills, run in dockbox — fresh home directory
means no global skills load, only `--plugin-dir` content.

```bash
dockbox run --env ANTHROPIC_API_KEY -v $(pwd):/repo \
  bun /repo/plugins/validator-bonds/evals/eval.ts \
    --plugin-dir /repo/plugins/validator-bonds
```

## Case Format

```yaml
question: >
  What is a Bidding settlement? Which staker population receives it,
  how is the payout determined, and what backs the payment?
facts:
  - Bidding
  - active_delegation_lamports
  - auction_effective_static_bid_pmpe
  - bond
wrong_facts:
  - some claim that must NOT appear
```

`facts` are checked case-insensitively (substring). Misses go to Haiku as a
semantic judge. A case passes only when all facts pass and no wrong_facts appear.

Facts must be grounded in the skill's SKILL.md — if the content isn't there,
the model can't be expected to produce it from skill routing alone.

## Adding Cases

1. Create `cases/<name>.yaml` with `question` and `facts`.
2. Verify the facts appear verbatim or semantically in
   `skills/marinade-sam-bond/SKILL.md` or `skills/marinade-ecosystem/SKILL.md`.
3. Run the single case to confirm it passes.

## Log Format

```yaml
meta:
  mode: plugin:plugins/validator-bonds # or 'no-skills' or 'default'
  flags: [--plugin-dir, plugins/validator-bonds]
  plugin_dir: plugins/validator-bonds
  tag: '20260527'
  started_at: 2026-05-27T10:00:00.000Z
cases:
  - case: bidding-settlement
    result: pass # pass | fail | error
    question: '...'
    answer: '...'
    facts:
      - fact: Bidding
        passed: true
        method: exact # exact | haiku | error
      - fact: ValidatorBond
        passed: true
        method: haiku
        haiku_verdict: YES
```
