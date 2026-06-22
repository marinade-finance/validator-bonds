#!/usr/bin/env python3
"""Track validator-bonds skill usage in Mixpanel.

Single-file Claude Code hook, wired as a **Stop** hook (see ../hooks/hooks.json).

Why Stop (not PostToolUse): the `Skill` tool is prompt expansion and does NOT fire
Pre/PostToolUse hooks (anthropics/claude-code#43630). But each Skill invocation IS
recorded in the session transcript as a `tool_use` block, so on every Stop we scan
`transcript_path` and report a `skill_used` event per invocation.

Dedup is server-side: each event sets Mixpanel `$insert_id` to the invocation's
immutable `tool_use` id, so re-scanning the transcript on later Stop calls is
harmless (Mixpanel drops duplicates) — no local state file needed.

Token: MIXPANEL_PROJECT_TOKEN is a Mixpanel *project* token — write-only ingestion,
safe to ship public. Override with the MIXPANEL_TOKEN env var.

The launcher re-execs itself detached (`start_new_session`) so the Mixpanel call
never blocks the session; the detached worker installs a SIGALRM handler and arms a
WORKER_TIMEOUT_SECONDS alarm, so it self-terminates rather than lingering.

Test:
  echo '{"transcript_path":"/abs/path.jsonl","session_id":"t1"}' \
    | TRACK_VERBOSE=1 python3 track-mixpanel.py
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from itertools import islice

try:
    from itertools import batched  # Python 3.12+
except ImportError:  # fallback for older runtimes (e.g. system python 3.9)
    def batched(iterable, n):
        it = iter(iterable)
        while chunk := tuple(islice(it, n)):
            yield chunk

MIXPANEL_PROJECT_TOKEN = "c5c1dd7c6d81894e620f333e0cc937ba"
TOKEN = os.environ.get("MIXPANEL_TOKEN", MIXPANEL_PROJECT_TOKEN)
TRACKED_SKILLS = {"marinade-sam-bond", "marinade-ecosystem", "marinade-docs", "find"}
VERBOSE = os.environ.get("TRACK_VERBOSE") == "1"
WORKER_TIMEOUT_SECONDS = 10
MIXPANEL_BATCH = 50  # Mixpanel /track accepts up to 50 events per request


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
                msg = rec.get("message")
                if not isinstance(msg, dict):
                    continue
                for b in msg.get("content") or []:
                    if (
                        isinstance(b, dict)
                        and b.get("type") == "tool_use"
                        and b.get("name") == "Skill"
                    ):
                        skill = (b.get("input") or {}).get("skill", "")
                        tid = b.get("id")
                        if skill and tid:
                            yield tid, skill
    except OSError:
        return


def iter_events(ev):
    """Yield a Mixpanel `skill_used` event for each tracked skill invocation."""
    sid = ev.get("session_id", "unknown")
    now = int(time.time())
    for tid, skill in skill_invocations(ev.get("transcript_path")):
        if skill in TRACKED_SKILLS:
            yield {
                "event": "skill_used",
                "properties": {
                    "token": TOKEN,
                    "distinct_id": sid,
                    "$insert_id": tid,  # server-side dedup key
                    "time": now,
                    "skill": skill,
                    "tool_use_id": tid,
                    "hook_event": "Stop",
                    "source": "claude-code",
                },
            }


def post(events):
    """POST a batch of events to Mixpanel in one request."""
    data = urllib.parse.urlencode({"data": json.dumps(events)}).encode()
    req = urllib.request.Request(
        "https://api.mixpanel.com/track",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        if VERBOSE:
            body = resp.read().decode().strip()
            print(f"posted {len(events)} event(s): http={resp.status} body={body}")
    except Exception as e:
        if VERBOSE:
            print(f"mixpanel error: {e}")


def run(raw):
    if not TOKEN:
        return
    try:
        ev = json.loads(raw or "{}")
    except Exception:
        return
    if not ev.get("transcript_path"):
        return
    for batch in batched(iter_events(ev), MIXPANEL_BATCH):
        post(list(batch))


def _expire(_signum, _frame):
    os._exit(0)  # hard-exit a timed-out detached worker; no lingering process


def main():
    raw = sys.stdin.read()

    # Worker (and verbose/testing) path: do the work under a hard self-timeout so a
    # detached worker can never hang around.
    if VERBOSE or os.environ.get("_TRACK_WORKER"):
        try:
            signal.signal(signal.SIGALRM, _expire)
            signal.alarm(WORKER_TIMEOUT_SECONDS)
        except (ValueError, AttributeError, OSError):
            pass  # no SIGALRM (e.g. Windows / non-main thread)
        run(raw)
        return

    # Launcher: detach a worker and return immediately. If we can't detach, drop it
    # rather than block the session (a synchronous POST is not worth the stall).
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
        pass


if __name__ == "__main__":
    main()
