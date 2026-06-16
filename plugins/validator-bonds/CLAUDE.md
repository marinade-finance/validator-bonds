# Plugin Developer Notes

Plugin root: `plugins/validator-bonds/`

Manifests: `.claude-plugin/plugin.json` (Claude Code), `.codex-plugin/plugin.json` (Codex).
Both point at `skills/` — same skill files serve both runtimes.

Skills are not auto-triggered reliably. Claude Code matches `when_to_use` frontmatter
against the conversation. For evals, the harness loads the plugin via
`--plugin-dir plugins/validator-bonds`. For manual testing:
`claude --plugin-dir plugins/validator-bonds -p "question"`.

## Eval harness

`eval.ts` — runs cases from `evals/cases/*.yaml` against live Claude with the plugin loaded.
See `evals/CLAUDE.md` for case authoring, source-grounding rules, and failure diagnosis.

```sh
pnpm eval                        # all cases, Sonnet
pnpm eval -- --model opus        # Opus
pnpm eval -- -v failing-case     # verbose: print full answer
pnpm eval -- -t mytag case1 case2
```
