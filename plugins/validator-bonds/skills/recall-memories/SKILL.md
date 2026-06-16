---
name: recall-memories
description: Read-only lookup of validator-bonds stored knowledge already written to `facts/` and `.diary/`. NOT for fresh code research against source (use find), live validator data (query the bonds API), or doc/repo navigation (use marinade-docs).
when_to_use: what do I know about X, do we have a fact on, did we already research, recall, look up stored knowledge, check the facts, check the diary, recent decisions, prior context, what was decided, have we covered this, search facts, search notes
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
