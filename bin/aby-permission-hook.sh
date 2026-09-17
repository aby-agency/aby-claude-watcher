#!/usr/bin/env bash
# aby-permission-hook — Claude Code hook that notifies Aby Claude Watcher
# when Claude is waiting for user input (PermissionRequest, Notification).
#
# Installed globally in ~/.claude/settings.json by the app (install-hooks.js).
# Reads a JSON payload on stdin (Claude Code hook contract), extracts what the
# watcher needs, and pings its Unix socket. Always exits 0 so the hook never
# blocks tool execution.
#
# The whole message is built by jq (or python3 as a fallback) rather than by
# string interpolation: tool names and tool inputs are values, and a quote in a
# value must not be able to break the JSON we send.
#
# ABY_WATCHER_SOCKET overrides the socket path — used by test/permission-hook.test.js
# to run this exact script against a throwaway socket.

SOCKET_PATH="${ABY_WATCHER_SOCKET:-/tmp/aby-claude-watcher.sock}"

# Pass-through if the watcher isn't running
if [ ! -S "$SOCKET_PATH" ]; then
  exit 0
fi

PAYLOAD=$(cat)

# toolTarget: what the request is ABOUT, in one short string. The order carries
# the decision — the description Claude writes for a Bash call ("Remove
# node_modules directory") beats the raw command, so the card shows intent
# rather than a bare `rm -rf`. Capped at 200 chars here: a Write tool_input can
# carry a whole file, and none of it should reach the socket.
# notification_type is whitelisted to [a-z_]; anything else becomes "".
if command -v jq >/dev/null 2>&1; then
  MSG=$(printf '%s' "$PAYLOAD" | jq -c '
    (if (.tool_input | type) == "object" then .tool_input else {} end) as $ti
    | {
        action: "permission-pending",
        sessionId: (.session_id // ""),
        hookEvent: (.hook_event_name // ""),
        toolName: (.tool_name // ""),
        toolTarget: (
          [ $ti.description,
            $ti.file_path,
            ($ti.questions | if type == "array" then (.[0].question? // empty) else empty end),
            $ti.url,
            $ti.command ]
          | map(select(type == "string" and length > 0))
          | (first // "")
          | .[0:200]
        ),
        idle: ((((.message // "") | contains("waiting for your input")) or ((.notification_type // "") == "idle_prompt"))),
        notificationType: ((.notification_type // "") | if test("^[a-z_]+$") then . else "" end)
      }' 2>/dev/null)
elif command -v python3 >/dev/null 2>&1; then
  MSG=$(printf '%s' "$PAYLOAD" | python3 -c "
import sys, json, re
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = d.get('tool_input')
if not isinstance(ti, dict):
    ti = {}
qs = ti.get('questions')
question = qs[0].get('question') if isinstance(qs, list) and qs and isinstance(qs[0], dict) else None
target = ''
for v in (ti.get('description'), ti.get('file_path'), question, ti.get('url'), ti.get('command')):
    if isinstance(v, str) and v:
        target = v[:200]
        break
ntype = d.get('notification_type') or ''
if not re.match(r'^[a-z_]+\$', ntype):
    ntype = ''
msg = d.get('message') or ''
print(json.dumps({
    'action': 'permission-pending',
    'sessionId': d.get('session_id') or '',
    'hookEvent': d.get('hook_event_name') or '',
    'toolName': d.get('tool_name') or '',
    'toolTarget': target,
    'idle': ('waiting for your input' in msg) or (ntype == 'idle_prompt'),
    'notificationType': ntype,
}))
" 2>/dev/null)
else
  exit 0
fi

[ -z "$MSG" ] && exit 0

# Send asynchronously so the hook returns fast (Claude waits on us).
(
  if command -v nc >/dev/null 2>&1; then
    printf '%s\n' "$MSG" | nc -U -w 1 "$SOCKET_PATH" >/dev/null 2>&1
  else
    python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX)
s.settimeout(1)
try:
    s.connect(sys.argv[1])
    s.sendall((sys.argv[2] + '\n').encode())
except: pass
finally: s.close()
" "$SOCKET_PATH" "$MSG" 2>/dev/null
  fi
) &

exit 0
