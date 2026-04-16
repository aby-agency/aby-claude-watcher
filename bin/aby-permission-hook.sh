#!/usr/bin/env bash
# aby-permission-hook — Claude Code hook that notifies Aby Claude Watcher
# when Claude is waiting for user input (PreToolUse, Notification).
#
# Installed per-project under .claude/settings.local.json by the `cc` wrapper.
# Reads a JSON payload on stdin (Claude Code hook contract), extracts the
# session id and the hook event name, and pings the watcher's Unix socket.
# Always exits 0 so the hook never blocks tool execution.

SOCKET_PATH="/tmp/aby-claude-watcher.sock"

# Pass-through if the watcher isn't running
if [ ! -S "$SOCKET_PATH" ]; then
  exit 0
fi

PAYLOAD=$(cat)

# Extract session_id + hook_event_name — prefer jq, fallback to python3.
if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null)
  HOOK=$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // empty' 2>/dev/null)
elif command -v python3 >/dev/null 2>&1; then
  SID=$(printf '%s' "$PAYLOAD" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('session_id',''))
except: pass" 2>/dev/null)
  HOOK=$(printf '%s' "$PAYLOAD" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('hook_event_name',''))
except: pass" 2>/dev/null)
else
  exit 0
fi

[ -z "$SID" ] && exit 0

MSG="{\"action\":\"permission-pending\",\"sessionId\":\"$SID\",\"hookEvent\":\"$HOOK\"}"

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
