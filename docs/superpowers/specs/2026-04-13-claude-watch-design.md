# Claude Watch — Design Spec

## Vision

Application Electron desktop (Mac/Windows/Linux) qui surveille les sessions Claude Code en temps réel. Une seule fenêtre avec deux modes d'affichage (grille/liste) et option always-on-top.

## Stack

- Electron (main + renderer)
- Node.js (watcher, socket, focus)
- HTML / CSS / JS vanilla (UI)
- Unix socket (Mac/Linux) / Named pipe (Windows) pour IPC avec wrappers CLI

## Architecture

```
SessionWatcher ──┐
SocketServer  ───┼──► main.js ◄──IPC──► renderer (index.html)
FocusManager  ───┘
```

### Modules

1. **SessionWatcher** (`watcher.js`) — Scanne `~/.claude/sessions/*.json` toutes les 2s pour découvrir les sessions actives (PID vivant). Tail les JSONL correspondants dans `~/.claude/projects/` via `fs.watch`. Parse chaque nouvelle ligne pour inférer l'état.

2. **SocketServer** (`socket.js`) — Serveur IPC Unix socket (`/tmp/claude-watch.sock`) ou named pipe (`\\.\pipe\claude-watch`). Reçoit les enregistrements des wrappers `cc`/`cwa` : PID terminal, session ID, terminal app, terminal ID.

3. **FocusManager** (`focus.js`) — Focus terminal par OS. Mac : AppleScript pour iTerm2, Terminal.app, Warp. Windows : PowerShell. Fallback : ouvrir un nouveau terminal dans le dossier du projet.

4. **ConfigManager** (`config.js`) — Lecture/écriture de `config.json` pour les préférences de notifications par session.

## Machine à états

| État | Couleur | Condition |
|------|---------|-----------|
| `thinking` | Amber `#f59e0b` | Dernier event `assistant` avec contenu `thinking`, pas encore de `tool_use` |
| `running` | Bleu `#3b82f6` | Dernier event `assistant` avec `stop_reason: "tool_use"` |
| `waiting` | Rouge `#ef4444` | `stop_reason: "end_turn"` + aucun event `user` depuis > 10s |
| `idle` | Gris `#6b7280` | Aucune activité depuis > 2 min |
| `error` | Rouge foncé `#991b1b` | Event contenant une exception ou erreur |
| `completed` | Vert `#22c55e` | Event `last-prompt` ou PID mort |

### Transitions

- Tout état → `idle` après 2 min sans activité
- Tout état → `error` sur exception détectée
- Tout état → `completed` sur `last-prompt` ou PID mort
- `waiting` déclenché 10s après `end_turn` sans nouveau `user` event
- Notifications déclenchées au passage vers `waiting`

## Données par session

- `projectName` — déduit du chemin encodé du dossier parent
- `slug` — nom lisible (ex: "eager-purring-kazoo")
- `state` — état courant + couleur
- `lastTool` — nom du dernier `tool_use` (Bash, Read, Edit...)
- `duration` — depuis `startedAt` du fichier sessions
- `tokens` — somme cumulée `input_tokens` + `output_tokens`
- `terminalApp` — terminal associé (si enregistré via wrapper)
- `terminalId` — ID terminal pour focus

## Interface

### Fenêtre unique

**Barre d'outils :**
- Logo + "Claude Watch"
- Toggle grille/liste (icônes)
- Bouton pin (always-on-top)
- Bouton "+ Ajouter session"
- Compteur sessions actives

**Mode grille (défaut) :**
Cards en grid responsive (2-3 colonnes). Chaque card :
- Badge coloré d'état (pill)
- Nom du projet + slug
- Dernier outil utilisé
- Durée de la session
- Tokens consommés
- Bouton focus terminal (icône)
- Icône cloche (notifications)

**Mode liste compacte :**
Une ligne par session : pill d'état + nom court + dernier outil + durée. Clic = focus terminal. Idéal avec always-on-top.

### Thème dark développeur

- Fond : `#0d1117`
- Cards : `#161b22`, bordure `#30363d`
- Texte principal : `#e6edf3`
- Texte secondaire : `#8b949e`
- Police monospace pour données techniques
- Transitions fluides sur changements d'état

### Notifications (par session)

- 2 toggles indépendants : modal in-app / son
- Déclenchement au passage vers `waiting`
- Préférences dans `config.json` indexées par `sessionId`

## Wrappers CLI

### `cc` (Mac/Linux shell script)

```
cc [args...] →
  lance "claude [args...]"
  capture PID
  détecte $TERM_PROGRAM
  envoie {action:"register", pid, terminalApp, cwd} via socket
  proxy transparent (attend fin du process)
```

### `cwa` (Mac/Linux shell script)

```
cwa →
  lit ~/.claude/sessions/*.json
  filtre par PID vivant
  envoie {action:"attach", sessionId, terminalApp, terminalId} via socket
```

### `cc.bat` (Windows)

Même logique, batch/PowerShell, named pipe.

### Protocole socket

JSON sur newline :
```json
{"action":"register","pid":1234,"terminalApp":"iTerm2","terminalId":"tab-1","cwd":"/path"}
{"action":"attach","sessionId":"uuid","terminalApp":"Warp","terminalId":"pane-1"}
```

## Focus terminal

| Environnement | Méthode |
|---------------|---------|
| Mac + iTerm2 | AppleScript `tell application "iTerm2"` |
| Mac + Terminal.app | AppleScript `tell application "Terminal"` |
| Mac + Warp | AppleScript `tell application "Warp"` |
| Windows | PowerShell `SetForegroundWindow` |
| Fallback | Ouvrir nouveau terminal dans le dossier projet |

## Arborescence

```
claude-watch/
├── package.json
├── main.js
├── watcher.js
├── socket.js
├── focus.js
├── config.js
├── config.json
├── ui/
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
├── bin/
│   ├── cc
│   ├── cc.bat
│   └── cwa
└── assets/
    └── notification.wav
```

## Hors scope (v1)

- Auth / sync multi-machine
- Historique des sessions passées
- Contrôle des agents (stop, pause)
- Support autres agents (Cursor, Codex, Gemini)
- Interface web
