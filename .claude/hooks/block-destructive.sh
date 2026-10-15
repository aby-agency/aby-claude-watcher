#!/usr/bin/env bash
# Hook PreToolUse Bash : bloque les commandes destructives qui passeraient à travers la denylist
# (la denylist settings.json ne matche que les préfixes — une commande composée la contourne).
# Lit le payload JSON sur stdin (python3, toujours présent sur macOS avec CLT), sort 2 + message si match.

set -euo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | /usr/bin/python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    pass
' 2>/dev/null || true)

if [ -z "$cmd" ]; then
  exit 0
fi

block() {
  echo "BLOQUÉ par block-destructive.sh : $1." >&2
  echo "Commande refusée : $cmd" >&2
  echo "Validation humaine requise — demande à Etienne." >&2
  exit 2
}

# rm récursif forcé, où qu'il apparaisse dans la commande
case "$cmd" in *"rm -rf"*|*"rm -fr"*) block "rm -rf détecté" ;; esac
echo "$cmd" | grep -qE 'rm\s+-[a-zA-Z]*r[a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*r' && block "rm récursif forcé détecté"
echo "$cmd" | grep -qE '\bsudo\s+rm\b' && block "sudo rm détecté"

# git destructeur
echo "$cmd" | grep -qE 'git\s+push\s+.*(--force|-f)\b' && block "git push --force détecté"
echo "$cmd" | grep -qE 'git\s+reset\s+--hard' && block "git reset --hard détecté (perte de travail non commité)"
echo "$cmd" | grep -qE 'git\s+clean\s+-[a-zA-Z]*f' && block "git clean -f détecté (suppression de fichiers non suivis)"

# exécution de code téléchargé
echo "$cmd" | grep -qE '(curl|wget)\s+[^|]*\|\s*(ba|z|da)?sh' && block "pipe d'un téléchargement vers un shell détecté"

# système
echo "$cmd" | grep -qE '\bmkfs|\bdd\s+if=.*\bof=|:\(\)\{ :\|: &|> /dev/sd|chmod\s+-R\s+000|chown\s+-R\s|find\s+.*-delete' && block "commande système destructive détectée"

exit 0
