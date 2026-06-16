#!/usr/bin/env python3
"""Track validator-bonds skill usage in Mixpanel.

Single-file Claude Code hook, wired as a **Stop** hook (see ../hooks/hooks.json).

Why Stop (not PostToolUse): the `Skill` tool is handled as prompt expansion and
does NOT fire Pre/PostToolUse hooks (anthropics/claude-code#43630). But each Skill
invocation IS recorded in the session transcript as a `tool_use` block. So on every
Stop we scan `transcript_path` for Skill invocations and emit one `skill_used` event
per new invocation, deduped by the immutable `tool_use` id across the per-turn Stop
calls. Switch to a PostToolUse/`Skill` matcher once #43630 ships.

Token: MIXPANEL_PROJECT_TOKEN is a Mixpanel *project* token — write-only ingestion,
safe to ship public. Override with the MIXPANEL_TOKEN env var.

The launcher re-execs itself detached (`start_new_session`) so a slow Mixpanel call
never blocks the session.

Test against a real transcript:
  echo '{"transcript_path":"/abs/path.jsonl","session_id":"t1"}' \
    | TRACK_VERBOSE=1 python3 track-mixpanel.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

MIXPANEL_PROJECT_TOKEN = "c5c1dd7c6d81894e620f333e0cc937ba"
TOKEN = os.environ.get("MIXPANEL_TOKEN", MIXPANEL_PROJECT_TOKEN)
TRACKED_SKILLS = {"marinade-sam-bond", "marinade-ecosystem", "marinade-docs", "find"}
VERBOSE = os.environ.get("TRACK_VERBOSE") == "1"


def skill_invocations(transcript_path):
    """Yield (tool_use_id, skill_name) for every Skill tool-use in the transcript."""
    try:
        with open(transcript_path, encoding="utf-8") as fh:
            for line in fh:
                if '"Skill"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                msg = rec.get("message") or {}
                content = msg.get("content") if isinstance(msg, dict) else None
                for b in content or []:
                    if (
                        isinstance(b, dict)
                        and b.get("type") == "tool_use"
                        and b.get("name") == "Skill"
                    ):
                        skill = (b.get("input") or {}).get("skill", "")
                        if skill:
                            yield (b.get("id") or skill), skill
    except OSError:
        return


def seen_path(session_id):
    safe = "".join(c for c in (session_id or "unknown") if c.isalnum() or c in "-_")
    return os.path.join(tempfile.gettempdir(), f"mp-skill-track-{safe}.json")


def post(session_id, skill, tid):
    payload = {
        "event": "skill_used",
        "properties": {
            "token": TOKEN,
            "distinct_id": session_id or "unknown",
            "time": int(time.time()),
            "skill": skill,
            "tool_use_id": tid,
            "hook_event": "Stop",
            "source": "claude-code",
        },
    }
    if VERBOSE:
        print(f"emit skill_used skill={skill} tid={tid}")
    data = urllib.parse.urlencode({"data": json.dumps(payload)}).encode()
    req = urllib.request.Request(
        "https://api.mixpanel.com/track",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        if VERBOSE:
            print(f"  mixpanel http={resp.status} body={resp.read().decode().strip()}")
    except Exception as e:
        if VERBOSE:
            print(f"  mixpanel error: {e}")


def run(raw):
    if not TOKEN:
        return
    try:
        ev = json.loads(raw or "{}")
    except Exception:
        return
    tpath = ev.get("transcript_path")
    sid = ev.get("session_id", "unknown")
    if not tpath:
        return
    sp = seen_path(sid)
    try:
        with open(sp) as fh:
            seen = set(json.load(fh))
    except Exception:
        seen = set()
    changed = False
    for tid, skill in skill_invocations(tpath):
        if skill in TRACKED_SKILLS and tid not in seen:
            post(sid, skill, tid)
            seen.add(tid)
            changed = True
    if changed:
        try:
            with open(sp, "w") as fh:
                json.dump(sorted(seen), fh)
        except OSError:
            pass


raw = sys.stdin.read()

# Verbose (testing) and the detached worker both run inline.
if VERBOSE or os.environ.get("_TRACK_WORKER"):
    run(raw)
    sys.exit(0)

# Launcher: re-exec self detached so the Mixpanel call never blocks the session.
try:
    p = subprocess.Popen(
        [sys.executable, __file__],
        env={**os.environ, "_TRACK_WORKER": "1"},
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    p.stdin.write(raw.encode())
    p.stdin.close()
except Exception:
    run(raw)  # fallback: run inline if we can't detach
sys.exit(0)
