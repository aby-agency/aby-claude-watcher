# Claude Watch

> Dashboard desktop cross-platform pour monitorer en temps réel toutes vos sessions Claude Code actives.

---

## Vision

Claude Watch est une application Electron qui surveille vos sessions Claude Code et affiche leur état en temps réel dans une interface épurée. Deux vues disponibles : une vue principale en cards et un widget compact always-on-top pour garder un œil sur vos agents sans quitter votre contexte de travail.

---

## Stack technique

- **Electron** — application desktop cross-platform (Mac / Windows / Linux)
- **Node.js** — watcher de fichiers JSONL, logique métier
- **Socket locale** — IPC Unix socket (Mac/Linux) ou named pipe (Windows) pour la communication wrapper ↔ app
- **HTML / CSS / JS vanilla** — UI, pas de framework

---

## Fonctionnalités

### Détection des sessions — 3 modes complémentaires

#### Mode passif (défaut)

Scan automatique de `~/.claude/projects/` toutes les 2 secondes. Zéro configuration, zéro friction. Toutes les sessions Claude Code existantes sont détectées automatiquement.

> **Limite :** sans information sur le terminal d'origine, le focus terminal au clic n'est pas disponible en mode passif seul.

#### Mode wrapper `cc`

Script shell (Mac/Linux) ou batch (Windows) installé dans le PATH. Remplace la commande `claude` par `cc`. Au lancement, le wrapper :

1. Démarre Claude Code normalement
2. Capture le PID du processus et l'identifiant du terminal
3. Notifie Claude Watch via socket locale
4. Active le focus terminal complet au clic dans l'UI

#### Mode attach `cwa`

Commande tapée dans un terminal Claude Code déjà en cours d'exécution. Le script :

1. Lit le `session_id` courant depuis le fichier JSONL le plus récent dans `~/.claude/projects/`
2. Envoie l'information à Claude Watch via socket locale
3. Associe la session au terminal courant → focus terminal activé

#### Bouton "+ Ajouter session" (UI)

Dans l'interface, un bouton permet d'attacher manuellement une session en collant un `session_id` ou un chemin vers un fichier JSONL.

---

### États détectés

Les états sont inférés en lisant les événements des fichiers JSONL de Claude Code en temps réel.

| État        | Couleur     | Condition de déclenchement                                       |
| ----------- | ----------- | ---------------------------------------------------------------- |
| `réflexion` | Amber       | Dernier event = `assistant` sans `tool_use`                      |
| `en cours`  | Bleu        | Dernier event = `tool_use` actif                                 |
| `attente`   | Rouge       | Session terminée côté assistant, aucun event `user` depuis > 10s |
| `idle`      | Gris        | Aucune activité depuis > 2 minutes                               |
| `erreur`    | Rouge foncé | Event contenant une exception ou une erreur                      |
| `terminé`   | Vert        | Signal de fin de session propre détecté                          |

**Informations affichées par session :**

- Nom du projet (déduit du chemin du dossier)
- État courant (badge coloré)
- Dernier outil utilisé (ex : `bash`, `edit`, `read`)
- Durée de la session en cours
- Tokens consommés (si disponible dans le JSONL)

---

### Interface

#### Vue principale (cards)

Fenêtre standard, une card par session active. Chaque card affiche les informations de la session et un bouton **↗ focus** pour basculer vers le terminal correspondant.

#### Vue widget (always-on-top)

Fenêtre compacte flottante, toujours visible au-dessus des autres fenêtres. Affiche une pill colorée par session avec le nom court du projet. Un clic sur une pill déclenche le focus terminal. Bascule entre les deux vues via un bouton dans la barre d'outils ou un raccourci clavier.

---

### Focus terminal

Implémentation best-effort selon l'OS et le terminal détecté.

| Environnement      | Méthode                                                          |
| ------------------ | ---------------------------------------------------------------- |
| Mac + iTerm2       | AppleScript `tell application "iTerm2" to select session by PID` |
| Mac + Terminal.app | AppleScript équivalent                                           |
| Windows            | `SetForegroundWindow` via PID (PowerShell)                       |
| Fallback universel | Ouvre un nouveau terminal positionné dans le dossier du projet   |

---

### Notifications

Les notifications sont configurées **par session**, directement depuis la card via une icône cloche. Il n'y a pas de réglage global.

**Par session, deux toggles indépendants :**

- **Modal in-app** — une petite fenêtre pop dans Claude Watch avec le nom de la session et un bouton focus direct
- **Son** — chime audio bundlé dans l'application

**Déclenchement :** passage en état `attente` (l'agent attend une réponse ou une permission).

**Persistance :** les préférences par session sont sauvegardées dans `config.json` en local, indexées par `session_id`.

---

## Installation

```bash
npm install -g claude-watch
claude-watch
```

Un assistant de configuration s'ouvre au premier lancement. Il :

1. Détecte l'OS
2. Propose d'installer les commandes `cc` et `cwa` dans le PATH
3. Teste la connexion socket locale
4. Vérifie la présence du dossier `~/.claude/projects/`

---

## Arborescence du projet

```
claude-watch/
├── main.js              # Electron main process, fenêtres, IPC
├── watcher.js           # Scan ~/.claude/projects/, parsing JSONL, états
├── socket.js            # Serveur socket local (IPC avec cc / cwa)
├── focus.js             # Focus terminal par OS (AppleScript, PowerShell, fallback)
├── config.json          # Préférences utilisateur (persistées localement)
├── ui/
│   ├── index.html       # Vue principale (cards)
│   ├── widget.html      # Vue widget (always-on-top)
│   └── styles.css
├── bin/
│   ├── cc               # Wrapper shell (Mac/Linux)
│   ├── cc.bat           # Wrapper batch (Windows)
│   └── cwa              # Script attach
└── assets/
    └── notification.wav # Son de notification bundlé
```

---

## Commandes disponibles

| Commande       | Description                                          |
| -------------- | ---------------------------------------------------- |
| `claude-watch` | Lance l'application                                  |
| `cc`           | Lance Claude Code + enregistre la session avec focus |
| `cwa`          | Attache la session Claude Code du terminal courant   |

---

## Hors scope (v1)

- Authentification / synchronisation multi-machine
- Historique des sessions passées
- Contrôle des agents (stop, pause, override)
- Support d'autres agents (Cursor, Codex, Gemini...)
- Interface web (localhost)

---

## Compatibilité

| OS                    | Support                               |
| --------------------- | ------------------------------------- |
| macOS 12+             | Complet (focus iTerm2 + Terminal.app) |
| Windows 10/11         | Complet (focus via PowerShell)        |
| Linux (Ubuntu/Debian) | Partiel (focus fallback)              |
