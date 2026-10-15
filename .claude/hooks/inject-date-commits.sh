#!/usr/bin/env bash
# Hook UserPromptSubmit : injecte date du jour + 3 derniers commits comme contexte additionnel.
# Sortie sur stdout sera concaténée au contexte Claude.

set -euo pipefail

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

echo "## Contexte injecté par hook"
echo "- Date : $(date +%Y-%m-%d)"
echo "- Heure : $(date +%H:%M)"

if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "- 3 derniers commits :"
  git log --oneline -3 2>/dev/null | sed 's/^/  - /' || echo "  (pas de commit)"
  echo "- Branche : $(git branch --show-current 2>/dev/null || echo 'detached')"
fi

exit 0
