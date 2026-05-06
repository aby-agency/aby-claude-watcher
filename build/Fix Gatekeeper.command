#!/bin/bash
# Retire l'attribut "quarantaine" macOS pour Aby Claude Watcher.
# A double-cliquer si macOS refuse d'ouvrir l'app apres l'installation.

set -e

APP="/Applications/Aby Claude Watcher.app"

clear
echo "============================================"
echo "  Aby Claude Watcher — Fix Gatekeeper"
echo "============================================"
echo ""

if [ ! -d "$APP" ]; then
  echo "L'app n'est pas dans /Applications."
  echo ""
  echo "Glissez d'abord 'Aby Claude Watcher' dans le dossier"
  echo "Applications, puis relancez ce script."
  echo ""
  read -p "Appuyez sur Entree pour fermer..." _
  exit 1
fi

echo "Deverrouillage de Aby Claude Watcher..."
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "Termine."
echo ""
echo "Lancement..."
open "$APP"
sleep 1
exit 0
