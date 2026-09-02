#!/usr/bin/env bash
# aby-permission-hook — Claude Code hook that notifies Aby Claude Watcher
# when Claude is waiting for user input (PermissionRequest, Notification).
#
# Installed globally in ~/.claude/settings.json by the app (install-hooks.js).
# Reads a JSON payload on stdin (Claude Code hook contract), extracts the
# session id and the hook event name, and pings the watcher's Unix socket.
# Always exits 0 so the hook never blocks tool execution.

SOCKET_PATH="/tmp/aby-claude-watcher.sock"

# Pass-through if the watcher isn't running
if [ ! -S "$SOCKET_PATH" ]; then
  exit 0
fi

PAYLOAD=$(cat)

# Extract session_id, hook_event_name, tool_name, notification_type — prefer jq,
# fallback to python3. tool_name is only present on PermissionRequest; empty for
# Notification. notification_type is only present on Notification.
if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null)
  HOOK=$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // empty' 2>/dev/null)
  TOOL=$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)
  NMSG=$(printf '%s' "$PAYLOAD" | jq -r '.message // empty' 2>/dev/null)
  NTYPE=$(printf '%s' "$PAYLOAD" | jq -r '.notification_type // empty' 2>/dev/null)
elif command -v python3 >/dev/null 2>&1; then
  SID=$(printf '%s' "$PAYLOAD" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('session_id',''))
except: pass" 2>/dev/null)
  HOOK=$(printf '%s' "$PAYLOAD" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('hook_event_name',''))
except: pass" 2>/dev/null)
  TOOL=$(printf '%s' "$PAYLOAD" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('tool_name',''))
except: pass" 2>/dev/null)
  NMSG=$(printf '%s' "$PAYLOAD" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('message',''))
except: pass" 2>/dev/null)
  NTYPE=$(printf '%s' "$PAYLOAD" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('notification_type',''))
except: pass" 2>/dev/null)
else
  exit 0
fi

[ -z "$SID" ] && exit 0

# Notification fires for real permission prompts, MCP elicitations, the 60s idle
# reminder ("Claude is waiting for your input"), and non-blocking events
# (auth_success, agent_completed, quota_*…). Forward `notification_type` so the
# watcher can route each one; keep the `idle` boolean for the message-based
# fallback on CLIs that don't send the type. The type is whitelisted to
# [a-z_] before being interpolated — anything else is dropped, never quoted in.
case "$NTYPE" in
  ''|*[!a-z_]*) NTYPE="" ;;
esac
case "$NMSG" in
  *"waiting for your input"*) IDLE=true ;;
  *) IDLE=false ;;
esac
[ "$NTYPE" = "idle_prompt" ] && IDLE=true

MSG="{\"action\":\"permission-pending\",\"sessionId\":\"$SID\",\"hookEvent\":\"$HOOK\",\"toolName\":\"$TOOL\",\"idle\":$IDLE,\"notificationType\":\"$NTYPE\"}"

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
