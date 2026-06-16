#!/usr/bin/env python3
"""Post a `skill_used` event to Mixpanel from a Claude Code hook payload.

Reads the hook event JSON on stdin. Token comes from MIXPANEL_TOKEN.
Only tracks the validator-bonds skills; everything else is a no-op.
Set TRACK_DRY_RUN=1 to print the event instead of sending it (for testing).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

TRACKED_SKILLS = {"marinade-sam-bond", "marinade-ecosystem"}

token = os.environ.get("MIXPANEL_TOKEN")
if not token:
    sys.exit(0)

try:
    ev = json.loads(sys.stdin.read() or "{}")
except Exception:
    sys.exit(0)

ti = ev.get("tool_input") or {}
# This session's Skill tool uses `skill`; some versions/docs use `skill_name`.
skill = ti.get("skill") or ti.get("skill_name") or ""
if skill not in TRACKED_SKILLS:
    sys.exit(0)

payload = {
    "event": "skill_used",
    "properties": {
        "token": token,
        "distinct_id": ev.get("session_id", "unknown"),
        "time": int(time.time()),          # Mixpanel /track expects unix seconds
        "skill": skill,
        "tool": ev.get("tool_name"),
        "hook_event": ev.get("hook_event_name"),
        "source": "claude-code",
    },
}

if os.environ.get("TRACK_DRY_RUN") == "1":
    print(json.dumps(payload, indent=2))
    sys.exit(0)

data = urllib.parse.urlencode({"data": json.dumps(payload)}).encode()
req = urllib.request.Request(
    "https://api.mixpanel.com/track",
    data=data,
    headers={"Content-Type": "application/x-www-form-urlencoded"},
)
try:
    resp = urllib.request.urlopen(req, timeout=5)
    body = resp.read().decode().strip()
    if os.environ.get("TRACK_VERBOSE") == "1":
        # body is "1" on accept, "0" on reject; never prints the token
        print(f"mixpanel http={resp.status} body={body}")
except Exception as e:  # fire-and-forget: never surface errors to the session
    if os.environ.get("TRACK_VERBOSE") == "1":
        print(f"mixpanel error: {e}")
