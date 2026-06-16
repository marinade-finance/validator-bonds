# Validator Bonds Skill Evals

Eval cases for the `validator-bonds` Claude Code plugin. The runner asks
Claude each question, then checks required `facts` and forbidden
`wrong_facts`.

## Run

From the repo root:

```bash
pnpm eval                         # all cases
pnpm eval -- -l                   # list cases, no model call
pnpm eval -- -v bidding-settlement # one case with full answer
pnpm eval -- -2                   # first two cases
pnpm eval -- --model opus         # model alias: opus, sonnet, haiku
pnpm eval -- --no-skills          # baseline without plugin skills
pnpm eval -- --persist            # run in the live checkout
```

Direct runner use:

```bash
cd plugins/validator-bonds
bun eval.ts -v bidding-settlement
```

Default runs copy the repo to `/tmp/vb-eval-*`, map the current working
directory plugin into that copy, run Claude there, and always remove the temp
copy afterward. Use `--persist` only when live writes are intentional.

Reports are written to `plugins/validator-bonds/evals/report/<tag>/`.

## Case Format

```yaml
question: 'What triggers a BidTooLowPenalty settlement?'
facts:
  - 'BidTooLowPenalty'
  - 'reduces'
  - 'previous epoch'
wrong_facts:
  - 'below minimum threshold'
```

`facts` pass by exact substring match or by Haiku semantic judge. `wrong_facts`
are exact-match only and must not appear in the answer.

## Writing Cases

Use facts that are grounded in the skill or source code:

- Good: enum variants, field names, function names, exact URLs, exact numeric results.
- Risky: broad prose that the judge can interpret several ways.
- Useful `wrong_facts`: plausible wrong answers, stale constants, wrong settlement types.

Before adding a case, run it verbosely:

```bash
pnpm eval -- -v -t probe <case-name>
```

Then keep the smallest fact set that proves the behavior and add `wrong_facts`
for regressions the model is likely to make.
