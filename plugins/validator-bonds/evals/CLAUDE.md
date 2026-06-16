# Eval Case Authoring

See `README.md` for run commands.

## Case Rules

```yaml
question: 'What triggers a BidTooLowPenalty settlement and what is the threshold formula?'
facts:
  - 'previous_bidPmpe'
  - 'isNegativeBiddingChange'
wrong_facts:
  - 'below minimum threshold'
  - 'commission increase'
```

- `facts` must appear exactly (case-insensitive substring) or pass the Haiku semantic judge.
- `wrong_facts` are exact-only and must be absent.
- Prefer code identifiers, struct field names, function names, exact numbers over prose.
- Do not put a term in `wrong_facts` if the question body names it (it will appear in any correct answer).
- **No file paths in questions.** Ask what you want to know; the model discovers where to look.
- **No regurgitation cases.** If ALL facts appear verbatim in a SKILL.md, the case tests copy-paste, not reasoning. Add at least one fact that requires reading source code, computing a value, or connecting multiple concepts.
- For calculations: give only the input values; never state the formula or the expected result in the question.

## Workflow

1. Write the question in plain language — no file paths, no formula hints.
2. Run `pnpm eval -- -v -t probe <case-name>` and read the actual answer.
3. Set `facts` to identifiers the model reliably produces when correct.
4. Add `wrong_facts` for plausible regressions (wrong settlement type, stale constants, wrong direction of an inequality).
