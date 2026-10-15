#!/usr/bin/env bash
# Hook Stop : garde-fou close-out (doctrine usage.md workflow 2) — empêche de terminer le tour
# en laissant des modifications de registres/ (et tickets/ si présent) non commitées.
# Ne se déclenche qu'une fois par arrêt (stop_hook_active) ; le travail en cours ailleurs ne bloque pas.

set -euo pipefail

payload=$(cat)
active=$(printf '%s' "$payload" | /usr/bin/python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("stop_hook_active", False))
except Exception:
    print(False)
' 2>/dev/null || echo False)
[ "$active" = "True" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

dirty=$(git status --porcelain -- registres tickets 2>/dev/null || true)
if [ -n "$dirty" ]; then
  echo "Close-out incomplet : des modifications de registres/ (ou tickets/) ne sont pas commitées :" >&2
  echo "$dirty" >&2
  echo "Finalise le close-out (ADR / LRN / TASKS / journal) et commite avant de t'arrêter." >&2
  exit 2
fi
exit 0
