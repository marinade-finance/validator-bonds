# Eval System — Extension Guide

Eval harness for the `validator-bonds` Claude Code plugin. Tests whether the
plugin's skills cause Claude to produce correct, grounded answers.

## How it works

Each case in `cases/*.yaml` asks a question, lists **facts** that must appear
in the answer, and optionally lists **wrong_facts** that must not appear.

```
answer = claude -p question  (with --plugin-dir loaded)
for each fact:    exact substring match OR Haiku judge → must be YES
for each wrong:   exact substring match only            → must be absent
```

Facts use the Haiku judge as a fallback (paraphrase-aware). Wrong_facts are
exact-only — no judge — because the judge's lenient matching produces false
positives on adversarial terms.

Results go to `evals/report/<tag>/eval-<timestamp>.yml`.

## Running

```bash
# From repo root:
pnpm eval                                    # all cases, Sonnet
pnpm eval -- --model opus                    # all cases, Opus
pnpm eval -- -t mytag case1 case2            # specific cases, tagged
pnpm eval -- -l                              # list cases without running
pnpm eval -- -v case1                        # verbose: print full answer
pnpm eval -- --persist                       # keep facts written during run
```

The harness copies the repo to a temp dir for each run (facts written by the
`find` skill don't persist back). Pass `--persist` to keep them.

## Writing good cases

### Facts — use code identifiers, not prose

```yaml
# GOOD: deterministic, not paraphrase-sensitive
facts:
  - 'BidTooLowPenalty'
  - 'previous_bidPmpe'
  - '184 SOL'

# BAD: haiku judge decides this nondeterministically
facts:
  - 'validator lowers their bid'
  - 'roughly 184 SOL'
```

Rules:

- Enum variant names, struct field names, function names — these are exact
- Numeric results from calc questions — use the exact value the formula produces
- URL fragments (`/v1/validators`, `bonds/institutional`) rather than full URLs
- Never use a term that also appears in `wrong_facts` (self-defeating)

### Wrong_facts — guard against confident hallucinations

```yaml
wrong_facts:
  - 'always revoked' # knife-edge: correct answer may phrase it this way
  - 'penalty_markup_bps' # bad if the question body defines this term
  - '400 SOL' # good: wrong numeric result the model might produce
```

Rules:

- Use **numeric wrong results** (`'400 SOL'`) — robust, unambiguous
- Don't forbid terms the question prompt itself names — the correct answer will
  explain why the OTHER term applies, echoing the forbidden one
- Test the genuine wrong answer, not a synonym of the right one

### Source-grounding principle

Facts must correspond to something in the source code or skill. Before adding
a fact, verify it exists:

```bash
grep -r 'your_fact_string' settlement-distributions/ programs/ plugins/validator-bonds/skills/
```

If a fact exists only in a private `.refs/` repo (ds-sam, ds-scoring), mark
the case with a comment explaining why it's unverifiable from the main repo.

### Calc questions

The question body supplies all input values. The model computes; facts check
the intermediate steps and final result:

```yaml
question: >
  Given: X = 100, Y = 0.5. Compute X * Y.
facts:
  - '50' # result
  - 'formula_name' # the code identifier for this formula
```

Don't put the result in wrong_facts of a case that expects a different result —
keep wrong_facts to plausible wrong answers, not impossible ones.

### Navigation questions

Questions like "How do I find X?" or "What is the URL for Y?" test routing and
skill content. The model may answer from CLAUDE.md (repo context) rather than
from a specific skill — this is fine. Test what the model **actually produces**:

```bash
# Test first with -v to see the answer, then write facts from what comes out
pnpm eval -- -v -t probe my-new-case
```

## Adding a `verify` field (source staleness check)

Cases can include a `verify` field to assert that the source code still
contains the content the case tests. This catches stale cases when source
changes:

```yaml
question: 'What enum variant covers bid-too-low settlements?'
facts:
  - 'BidTooLowPenalty'
verify:
  - file: 'settlement-distributions/settlement-common/src/settlement_collection.rs'
    contains: 'BidTooLowPenalty'
```

The harness reads `verify[].file` from the repo root, checks `contains` is
present, and marks the case `stale` (not `fail`) if the source no longer
matches. A `stale` result is a maintenance signal — the case needs updating,
not the model.

_Note: `verify` is not yet implemented in eval.ts — add it when needed._

## Case categories

| Tag prefix        | What it tests                                  |
| ----------------- | ---------------------------------------------- |
| `calc-*`          | Arithmetic from source formulas                |
| `ecosystem-*`     | Program IDs, URLs, repo names (routing smoke)  |
| `institutional-*` | Select program, InstitutionalPayout mechanic   |
| everything else   | Protocol concepts, settlement types, lifecycle |

The `ecosystem-*` cases are routing smoke tests — they verify the skill loads
and returns the right address/URL, not that the model reasons about it.

## Diagnosing failures

```bash
pnpm eval -- -v -t debug failing-case-name
```

Look at the full answer (`--- answer ---`) and check:

- Which facts match (exact vs haiku)?
- Does the answer contain the wrong_fact? Why?
- Did the skill load? (Look for skill-specific vocabulary in the answer)
- Is the fact a code identifier that exists in source?
