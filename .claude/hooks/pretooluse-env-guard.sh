#!/bin/bash
# PreToolUse Edit|Write — bloque toute écriture sur un fichier dotenv (.env, .env.*),
# SAUF les templates versionnés sans secret (.env.example, .env.sample, .env.template,
# .env.dist). Complète la denylist settings.json : un glob ne sait pas exprimer
# "tout .env* sauf l'exemple", un hook si (constitution §2, RES-027 ; revue sécurité Socle T-006).
# Exit 2 = blocage, le message stderr est renvoyé à Claude.

INPUT=$(cat)

FILE=$(printf '%s' "$INPUT" | /usr/bin/python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("tool_input", {}).get("file_path", ""))
except Exception:
    pass
')

[ -z "$FILE" ] && exit 0

BASE=$(basename "$FILE")

case "$BASE" in
  .env.example|.env.sample|.env.template|.env.dist)
    exit 0 ;;
  .env|.env.*)
    echo "BLOQUÉ (hook Aby) : écriture sur fichier de secrets $BASE. Validation humaine requise." >&2
    exit 2 ;;
esac

exit 0
