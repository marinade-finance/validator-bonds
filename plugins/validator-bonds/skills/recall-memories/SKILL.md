---
name: recall-memories
description: >
  Search validator-bonds stored knowledge — `facts/`, `.diary/` — for
  relevant content. Read-only. USE for technical questions, protocol
  lookups, recent-work context, "what do I know about X". NOT for live
  validator data (query the bonds API directly) or fresh research (use /find).
user-invocable: true
arg: <question>
---

# Recall Memories

## Protocol

Spawn an Explore subagent with the question. The subagent:

1. Greps `summary:` in `facts/*.md` across the project root
2. Also checks `.diary/*.md` for recent decisions and context
3. Reads each summary, judges relevance to the question
4. Returns matches: file path, why it matches

## After results

Deliberate in `<think>`: list matched files, what each says, whether it
answers, what gap remains. Verdict: use it, refresh via `/find`, or
research fresh.

**Weight corrections over conclusions.** Trust user corrections verbatim;
re-derive conclusions from source, never from a prior summary.

## facts/ structure

`facts/` contains 80+ pre-verified domain fact files. Each has YAML frontmatter:

```yaml
---
topic: <specific topic>
category: <sam-auction|settlement|on-chain|bond-lifecycle|scoring>
verified_at: <ISO timestamp>
sources:
  - <file:line or URL>
summary: >
  <one sentence — used for fast grep>
---
```

Grep `summary:` lines first for speed. Then read body of matches.
