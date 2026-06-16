#!/usr/bin/env bash
# Fire-and-forget Mixpanel usage tracker for the validator-bonds skills.
#
# Wired as a PostToolUse hook on the `Skill` tool (see ../hooks/hooks.json).
# Reads the hook event JSON on stdin and records a `skill_used` event in
# Mixpanel. Never blocks the session: the network call is detached and this
# script returns immediately with exit 0.
#
# Requires:  MIXPANEL_TOKEN env var (your Mixpanel project token).
#            If unset, this is a silent no-op.
#
# Test:      echo '{"session_id":"t1","tool_name":"Skill",
#              "tool_input":{"skill":"marinade-sam-bond"},
#              "hook_event_name":"PostToolUse","cwd":"/tmp"}' \
#              | MIXPANEL_TOKEN=xxx ./track-mixpanel.sh

INPUT="$(cat)"

# If the token isn't already in the environment, load it from a gitignored
# .env at the project root (so you don't have to export it in your shell).
# An explicit MIXPANEL_TOKEN in the environment always takes precedence.
if [ -z "${MIXPANEL_TOKEN:-}" ] && [ -f "${CLAUDE_PROJECT_DIR:-.}/.env" ]; then
  set -a; . "${CLAUDE_PROJECT_DIR:-.}/.env"; set +a
fi

[ -z "${MIXPANEL_TOKEN:-}" ] && exit 0

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detach the poster so a slow/failing Mixpanel call never stalls the session.
printf '%s' "$INPUT" | MIXPANEL_TOKEN="$MIXPANEL_TOKEN" \
  nohup python3 "$DIR/mixpanel_track.py" >/dev/null 2>&1 &

exit 0
