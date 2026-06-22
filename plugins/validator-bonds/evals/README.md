# Validator Bonds Eval

Run eval cases from the repo root:

```bash
pnpm eval                              # all cases
pnpm eval -- -l                        # list cases, no model call
pnpm eval -- -v bidding-settlement     # one case with full answer
pnpm eval -- -2                        # first two cases
pnpm eval -- --model opus              # model alias: opus, sonnet, haiku
pnpm eval -- --no-skills               # baseline without plugin skills
pnpm eval -- --persist                 # run in live checkout (skip tmpdir copy)
pnpm eval -- -t mytag case1 case2      # named run, specific cases
```

Output: pass/fail per case. Failures show each missing fact and any wrong_fact
that appeared. Full YAML log at `evals/report/<tag>/eval-<timestamp>.yml`.

See `evals/CLAUDE.md` for case authoring rules.
