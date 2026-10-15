#!/usr/bin/env bash
# Hook Stop : auto-commit si on est sur une branche dédiée claude-auto/* et que le tree est dirty.
# Silencieux sinon (pas d'effet sur les autres branches).

set -euo pipefail

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  exit 0
fi

branch=$(git branch --show-current 2>/dev/null || echo "")

case "$branch" in
  claude-auto/*)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A
      git commit -m "auto: WIP fin de session $(date +%Y-%m-%d_%H-%M)" --no-verify > /dev/null 2>&1 || true
      echo "auto-commit-stop.sh : WIP commit créé sur $branch" >&2
    fi
    ;;
  *)
    exit 0
    ;;
esac

exit 0
