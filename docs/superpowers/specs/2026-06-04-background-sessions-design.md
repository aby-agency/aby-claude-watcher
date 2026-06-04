# Background sessions — section dédiée

**Date :** 2026-06-04
**Statut :** validé (design approuvé par Paul)

## Problème

Le watcher détecte déjà les sessions headless (`claude -p`, lancées par exemple par les
workers Telegram aby-agents) : elles écrivent un `~/.claude/sessions/<pid>.json` comme
n'importe quelle session, donc `scan()` les ramasse. Mais rien ne les distingue des
sessions interactives :

- elles apparaissent mélangées aux sessions terminal dans la liste ;
- le clic-focus est cassé (pas de tty, pas de terminal à activer) ;
- elles déclenchent les mêmes notifications waiting/pending, en doublon des canaux
  propres aux workers (Telegram) ;
- plusieurs workers partagent le même cwd (`~/Project/aby-agents`) et s'affichent
  tous comme « aby-agents » sans distinction.

## Détection

Le `session.json` écrit par Claude Code contient un champ `entrypoint` :

| Valeur | Origine |
|--------|---------|
| `cli` | session interactive terminal |
| `sdk-cli` | `claude -p` headless / SDK |

**Règle :** `isBackground = !!entrypoint && entrypoint !== 'cli'`. Tout entrypoint
inconnu futur est classé background (lecture seule + silencieux) plutôt qu'interactif.
Si `entrypoint` est absent (vieille version de Claude Code), la session est traitée
comme interactive (comportement actuel inchangé).

Pas d'inspection de process (`ps -o tty`) : redondant, coûteux à chaque scan, fragile.

## Modèle (watcher.js)

- `scan()` destructure `entrypoint` en plus de `pid, sessionId, cwd, startedAt`
  et pose `session.isBackground` (mis à jour à chaque scan, resume-safe comme les
  autres champs).
- `persistSession()` sauvegarde `isBackground` ; la restauration au démarrage le relit.
- `migrateSession()` (après `/clear`) conserve le flag.
- State machine inchangée : les JSONL headless sont identiques, l'override
  « agent foreground bloquant » s'applique pareil.
- **Notifications :** dans `setState()`, l'émission `session-waiting` est supprimée
  pour les sessions background **sauf si** la cloche de la session est activée
  (`config.getNotificationPrefs(id).modal || .sound`). C'est une exception assumée à
  la règle v1.7.2 (« toast en compact même cloche off ») : ces sessions sont
  autonomes et notifiées par leurs propres canaux.

## UI (renderer.js + styles.css)

- `getSortedSessions()` partitionne en deux groupes : interactives d'abord,
  background ensuite, **sous les interactives**, derrière un séparateur
  « ⚙ Background (N) » repliable (état replié persisté dans la config,
  déplié par défaut).
- Présent en vue grid **et** compacte (séparateur fin en compact).
- Le séparateur n'apparaît pas quand il n'y a aucune session background.
- Cartes identiques (état, modèle, branche, tokens, dernier outil, renommage, croix,
  cloche) **sauf** : pas de clic-focus (curseur normal, pas d'action au clic carte).
- Drag-and-drop : réordonnancement au sein de chaque groupe uniquement
  (pas de déplacement inter-sections — le groupe est dicté par `isBackground`,
  pas par la position).
- Le renommage et la cloche persistent par sessionId — les workers utilisant
  `--resume` avec un id stable, « 🔧 Tech » / « 🎯 Prospection » survivent d'un
  run à l'autre.

## main.js / IPC

- `serializeSession()` expose `isBackground` au renderer.
- Aucun nouveau channel IPC.

## Config (config.js)

- Nouveau réglage UI : `backgroundSectionCollapsed: bool` (défaut `false`).
- Champ `isBackground` ajouté aux entrées `sessions` persistées.
- Pas de migration nécessaire : champ absent = `false` (interactif), comportement actuel.

## Hors périmètre

- Aucune action de contrôle sur les sessions background (kill, reprise en
  terminal) — lecture seule, décision explicite de Paul.
- Pas d'extraction du label worker (`--label 🔧 Tech`) depuis les args du process
  parent — le renommage manuel persistant suffit.
- Pas de réglage global « masquer les background » (YAGNI ; le repli de section
  couvre le besoin).

## Tests

- watcher : session.json avec `entrypoint: "sdk-cli"` → `isBackground: true` ;
  `"cli"` ou absent → `false` ; persistance + restauration ; conservation via
  `migrateSession`.
- notifications : background + cloche off → pas d'émission `session-waiting` ;
  background + cloche on → émission ; interactive → inchangé.
- renderer (si harnais existant le permet) : partition et ordre des groupes.

## Risques

- Nouveaux entrypoints Anthropic inconnus classés background : risque accepté
  (dégradation douce — la session reste visible, juste silencieuse et sans focus).
- `build.files` (package.json) : pas de nouveau module prévu, mais à revérifier si
  l'implémentation en crée un (piège connu du DMG).
