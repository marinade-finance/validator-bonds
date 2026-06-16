# Skill-usage tracking hook

Records a Mixpanel `skill_used` event each time one of this plugin's skills
(`marinade-sam-bond`, `marinade-ecosystem`) is invoked, so we can measure
whether the skills are actually being used.

## How it works

- `hooks.json` registers a **`PostToolUse`** hook matched on the `Skill` tool —
  it fires once per skill invocation (the lowest-noise signal that still tells
  us *which* skill ran).
- `scripts/track-mixpanel.sh` reads the hook event JSON on stdin and posts to
  Mixpanel **fire-and-forget** (detached, never blocks the session). It only
  tracks this plugin's skills; anything else is a no-op.
- `scripts/mixpanel_track.py` builds and sends the event.

## Event shape

```json
{
  "event": "skill_used",
  "properties": {
    "distinct_id": "<session_id>",
    "skill": "marinade-sam-bond",
    "tool": "Skill",
    "hook_event": "PostToolUse",
    "source": "claude-code"
  }
}
```

No filesystem paths, prompts, or user content are sent — only the skill name,
the session id, and the event metadata.

## Enabling

Set a Mixpanel **project token** (write-only ingestion token, *not* an API
secret). Either:

- `export MIXPANEL_TOKEN=...` in your environment, **or**
- copy `.env.example` → `.env` (gitignored) at the project root and fill it in;
  the hook auto-loads it via `CLAUDE_PROJECT_DIR`.

Without a token the hook is a silent no-op, so it is safe to ship disabled.

## Test

```sh
echo '{"session_id":"t1","tool_name":"Skill","tool_input":{"skill":"marinade-sam-bond"},"hook_event_name":"PostToolUse"}' \
  | MIXPANEL_TOKEN=xxx TRACK_VERBOSE=1 python3 scripts/mixpanel_track.py
# expect: mixpanel http=200 body=1
```
