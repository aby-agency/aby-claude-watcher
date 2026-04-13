# Claude Watch

> Dashboard desktop pour monitorer en temps réel toutes vos sessions Claude Code actives.

---

<!-- Screenshot placeholder -->
<!-- ![Claude Watch](assets/screenshot.png) -->

---

## Fonctionnalites

- **Detection automatique** des sessions via `~/.claude/sessions/` (polling toutes les 2s)
- **6 etats** inferres depuis les fichiers JSONL en temps reel
- **Vue grille et vue liste** avec bascule et reordonnancement par glisser-deposer
- **Always-on-top** — epingle la fenetre au premier plan (remplace le widget flottant)
- **Notifications par session** — modal in-app + son avec controle du volume
- **Focus terminal** — bascule vers le terminal de la session via AppleScript (iTerm2)
- **Reprendre une session** depuis l'interface
- **Lancer une nouvelle session** depuis l'interface
- **Indicateur Remote Control** — icone globe cliquable ouvrant l'URL
- **Tool pills** colores par categorie : Bash (vert), Read (bleu), Edit (ambre), Agent (violet)
- **Nom du modele** — Opus 4.6, Sonnet 4.6, etc.
- **Branche Git** par session
- **Estimation du cout** par session
- **Apercu du message** — 2 dernières lignes de la reponse de l'assistant
- **Barre de statut** — sessions actives, sessions en attente, tokens totaux, cout total
- **Icone systray** avec menu resumant les sessions
- **Badge Dock** — nombre de sessions en attente
- **Recherche / filtre** de sessions
- **Menu contextuel** au clic droit sur une card
- **Nettoyage automatique** des sessions terminees depuis plus de 7 jours
- **Configuration persistante** — sessions, position fenetre, ordre, preferences

---

## Installation

### Developpement

```bash
git clone <repo>
cd claude-watch
npm install
npm start
```

### Build / distribution

```bash
npm run build
# Genere un .dmg dans dist/
```

L'application est packagee avec **electron-builder**.

---

## Raccourcis clavier

| Raccourci         | Action                                      |
| ----------------- | ------------------------------------------- |
| `Cmd+1` a `Cmd+9` | Focus sur la session numero N               |
| `Cmd+G`           | Basculer entre vue grille et vue liste      |
| `Cmd+P`           | Epingler / desepingler (always-on-top)      |
| `Cmd+F`           | Ouvrir la recherche                         |
| `Escape`          | Fermer la recherche / fermer le modal       |

---

## Architecture

```
claude-watch/
├── main.js              # Electron main process, fenetres, IPC, tray, dock
├── watcher.js           # Scan ~/.claude/sessions/, parsing JSONL, etats
├── socket.js            # Serveur socket local (IPC avec cc / cwa)
├── focus.js             # Focus terminal (AppleScript iTerm2)
├── config.json          # Preferences utilisateur (persistees localement)
├── ui/
│   ├── index.html       # Fenetre principale (grille + liste)
│   └── styles.css
├── bin/
│   ├── cc               # Wrapper shell
│   └── cwa              # Script attach
└── assets/
    └── notification.wav # Son de notification
```

**Stack :** Electron + Node.js + HTML/CSS/JS vanilla (sans framework UI).

---

## Etats des sessions

| Etat       | Couleur    | Condition                                               |
| ---------- | ---------- | ------------------------------------------------------- |
| `thinking` | Violet     | Dernier event = `assistant` en cours de reflexion       |
| `running`  | Vert       | Dernier event = `tool_use` actif                        |
| `waiting`  | Bleu       | Session terminee cote assistant, attend une reponse     |
| `idle`     | Gris-bleu  | Aucune activite recente                                 |
| `error`    | Rouge      | Event contenant une exception ou une erreur             |
| `completed`| Gris fonce | Signal de fin de session propre detecte                 |

---

## Wrappers CLI

### `cc` — lancer Claude Code avec enregistrement

```bash
cc                  # equivalent a `claude` + enregistrement session
cc -p "prompt"      # avec prompt initial
```

Installe dans le PATH. Demarre Claude Code et notifie Claude Watch via socket locale pour activer le focus terminal.

### `cwa` — attacher une session existante

```bash
cwa
```

A executer dans un terminal Claude Code deja ouvert. Lit le `session_id` courant et l'associe au terminal pour activer le focus terminal.

---

## Hors scope (v1)

- Authentification / synchronisation multi-machine
- Historique des sessions passees
- Controle des agents (stop, pause, override)
- Support d'autres agents (Cursor, Codex, Gemini...)
- Interface web (localhost)

---

## Compatibilite

| OS        | Support                                       |
| --------- | --------------------------------------------- |
| macOS 12+ | Complet (focus terminal via AppleScript/iTerm2) |
| Windows   | Non supporte en v1                            |
| Linux     | Non supporte en v1                            |
