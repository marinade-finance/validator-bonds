# Validator Bonds Skill Evals

Automated eval runner for Claude Code skill routing. Asks Claude questions and
checks that answers contain expected facts — testing whether skills trigger and
surface the right content.

## Quick Start

```bash
cd plugins/validator-bonds/evals

# Run all cases (default: ./cases/)
bun runner.ts

# Run only first 2 cases
bun runner.ts -2

# Single case
bun runner.ts cases/bidding-settlement.yaml

# Baseline — disable all skills for comparison
bun runner.ts --no-skills

# Explicit plugin dir — override which plugin is loaded
bun runner.ts --plugin-dir ../../..

# Custom output tag (default: YYYYMMDD)
bun runner.ts -t baseline-20260527
```

Output: pass/fail per case, missing facts printed inline, detailed YAML log at
`./report/<tag>/eval-<timestamp>.yml`.

## Clean Isolation (dockbox)

`claude -p` in the project dir picks up `~/.claude/skills/` (global skills).
To test only validator-bonds skills, run in dockbox — fresh home directory
means no global skills load, only `--plugin-dir` content.

```bash
dockbox run --env ANTHROPIC_API_KEY -v $(pwd)/../../../:/repo \
  bun /repo/plugins/validator-bonds/evals/runner.ts \
    --plugin-dir /repo/plugins/validator-bonds
```

## Case Format

```yaml
question: >
  What is a Bidding settlement? Which staker population receives it,
  how is the payout determined, and what backs the payment?
facts:
  - Bidding
  - native stakers
  - effective_bid_pmpe
  - bond
```

`facts` are checked case-insensitively (substring). Misses go to Haiku as a
semantic judge. A case passes only when all facts pass.

Facts must be grounded in the skill's SKILL.md — if the content isn't there,
the model can't be expected to produce it from skill routing alone.

## Adding Cases

1. Create `cases/<name>.yaml` with `question` and `facts`.
2. Verify the facts appear verbatim or semantically in
   `skills/marinade-sam-bond/SKILL.md` or `skills/marinade-ecosystem/SKILL.md`.
3. Run the single case to confirm it passes.

Question inspiration: `skills/marinade-sam-bond/evals/questions.md` and
`skills/marinade-ecosystem/evals/questions.md`.

## Log Format

```yaml
meta:
  mode: plugin:../../.. # or 'no-skills' or 'default'
  flags: [--plugin-dir, ../../..]
  plugin_dir: ../../..
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
