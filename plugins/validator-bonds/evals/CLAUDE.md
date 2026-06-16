# Eval System

This directory contains eval cases for the `validator-bonds` plugin. The runner
is [`../eval.ts`](../eval.ts), exposed from the repo root as `pnpm eval`.

## Commands

```bash
pnpm eval                         # all cases
pnpm eval -- -l                   # list cases without model calls
pnpm eval -- -v <case-name>       # debug one case
pnpm eval -- -t <tag> <case-name> # tagged run
pnpm eval -- --model opus         # aliases: opus, sonnet, haiku
pnpm eval -- --no-skills          # baseline
pnpm eval -- --persist            # run in the live checkout
```

Default runs copy the repo to `/tmp/vb-eval-*`, map the current working
directory plugin into that copy, run Claude there, write reports under
`evals/report/<tag>/`, and always remove the temp copy. Use `--persist` only
when live writes are intentional.

## Case Rules

Cases are YAML files in `cases/`:

```yaml
question: 'What triggers a BidTooLowPenalty settlement?'
facts:
  - 'BidTooLowPenalty'
  - 'reduces'
  - 'previous epoch'
wrong_facts:
  - 'below minimum threshold'
```

- `facts` must appear exactly or pass the Haiku semantic judge.
- `wrong_facts` are exact-only and must be absent.
- Prefer code identifiers, enum names, field names, URLs, and exact numbers.
- Avoid broad prose when a stable symbol exists.
- Do not put a term in `wrong_facts` if the prompt itself names it.

## Workflow

1. Add or edit one case.
2. Run `pnpm eval -- -v -t probe <case-name>`.
3. Keep facts minimal and grounded in `plugins/validator-bonds/skills/` or
   primary source files.
4. Add `wrong_facts` for likely regressions, especially stale constants and
   settlement-type confusion.
