# Détection des workflows — design

Date : 2026-06-04
Statut : validé par Paul

## Contexte

Claude Code peut lancer des workflows multi-agents (tool `Workflow`, ex. `deep-research`) qui
font tourner des dizaines de subagents en tâche de fond. Le watcher ne les voit pas : son
scanner subagents (`subagents.js`) ne lit que `<sessionDir>/subagents/agent-*.jsonl` à plat et
ignore le sous-dossier `subagents/workflows/`. Résultat : une session qui orchestre 100+ agents
apparaît comme une session ordinaire.

Cas observé (session « Fafa », run `wf_bcb66db1-c51`) : 103 agents, 6 min, 1,37 M tokens —
invisible dans l'UI.

## Sources de données (observées sur disque)

Pour une session, avec `<sessionDir> = <projectDir>/<sessionId>` :

1. **`<sessionDir>/subagents/workflows/wf_<runId>/journal.jsonl`** — écrit en continu pendant
   le run. Événements pertinents : `{"type":"started","agentId":...}` et
   `{"type":"result","agentId":...}`. Permet de compter lancés / terminés / en cours.
   Les transcripts `agent-<id>.jsonl` + `agent-<id>.meta.json` y vivent aussi (même format que
   les subagents classiques) mais on ne les parse pas — le journal suffit.
2. **`<sessionDir>/workflows/scripts/<name>-wf_<runId>.js`** — script persisté dès le
   lancement. Le nom du workflow s'extrait du filename (préfixe avant `-wf_`).
3. **`<sessionDir>/workflows/wf_<runId>.json`** — fichier d'état riche (`status`,
   `workflowName`, `agentCount`, `durationMs`, `totalTokens`). Observé écrit en **fin de run**
   uniquement (mtime = completion) → sert de signal de terminaison + stats pour la notif, pas
   de source live. Peut être gros (161 Ko observé) : lecture lazy, une fois par runId.

## Design

### 1. Scanner — `subagents.js`

Nouvelle fonction exportée `scanWorkflows(sessionDir)` :

- Liste `<sessionDir>/subagents/workflows/`, retient les entrées `wf_*`.
- Pour chaque run : lit `journal.jsonl` en entier (taille modeste, ~60 Ko pour 103 agents ;
  pas de tail nécessaire), compte les `started` / `result` par `agentId`.
- Nom : scan de `<sessionDir>/workflows/scripts/` pour un fichier `*-<runId>.js` → préfixe.
  Fallback : `runId` brut.
- Statut : si `<sessionDir>/workflows/<runId>.json` existe → le parser (une seule fois par
  runId, cache mémoire) et reprendre `status`, `agentCount`, `durationMs`. Sinon `running`.
- Retour : `[{runId, name, started, done, running, lastActivityTs, status, stats?}]` où
  `lastActivityTs` = mtime du journal et `stats` = `{agentCount, durationMs}` si terminé.
- Le snapshot exposé à l'UI exclut les runs terminés (comme les subagents `completed`),
  mais `scanWorkflows` les retourne — la détection de fin de run en a besoin (§4).

### 2. Sérialisation — `main.js`

- `serializeSession()` ajoute `workflows: [...]` (runs actifs uniquement), à côté de
  `subagents`.
- **Aucun changement** à `hasBlockingForegroundAgent` ni à l'override pending→running : les
  agents de workflow tournent dans une task background, ils ne bloquent pas le parent et ne
  doivent pas muter ses états/notifications. Ils restent hors du snapshot subagents.

### 3. Rafraîchissement live — `main.js`

Le snapshot n'est recalculé que sur `session-updated`, or le JSONL parent peut rester
silencieux pendant tout le run (Claude a fini son tour, le workflow tourne détaché).

→ Interval de **2 s** dans `main.js` : pour chaque session dont le dernier snapshot contenait
au moins un workflow actif, re-sérialiser et pousser `session-updated` au renderer. L'interval
tourne en permanence mais ne fait rien (et ne touche pas le disque) quand aucun workflow n'est
suivi. C'est ce tick qui détecte aussi l'apparition de nouveaux runs pendant un long tour et la
transition running→completed.

Amorçage : le premier `session-updated` naturel (l'appel `Workflow` écrit dans le JSONL parent)
fait entrer la session dans le suivi.

### 4. Notification fin de run — `main.js`

- Détection : au tick (§3), un runId précédemment `running` passe `completed` (ou disparaît
  avec un fichier d'état completed).
- One-shot par `runId` : `Set` en mémoire des runs déjà notifiés. Pas de cooldown 30 s — un
  run ne se termine qu'une fois.
- Canal existant : `sendToRenderer('show-notification', {kind: 'workflow-done', ...})` +
  `play-sound` selon les prefs de la session parent.
- Texte : « ⚡ deep-research terminé — 103 agents, 6 min » (i18n via `i18n.js`).
- Le badge disparaît au même tick.

### 5. Badge UI — `ui/renderer.js` + `ui/styles.css`

- `workflowRowHTML(wf)` : `⚡ <name> — <running> agents actifs (<done>/<started>)`, spinner
  tant que `running > 0`. Rendu au-dessus du bloc subagents, dans les deux vues (grid +
  compact), même pattern que `subagentRowHTML`/`subagentsBlockHTML`.
- Pas d'interaction (pas de dépliage des agents — écarté au cadrage).
- Style aligné sur `.subagent-row`.

## Décisions de cadrage (validées)

- Affichage : **badge agrégé** par workflow, pas la liste des agents individuels.
- Fin de run : **notification + badge disparaît**.
- Approche données : **hybride** — journal pour le live, script filename pour le nom, fichier
  d'état pour la fin + stats (approche A ; « tout journal » écarté car heuristique de fin
  fragile, « tout fichier d'état » écarté car aveugle pendant le run).

## Cas limites

- Journal absent ou illisible → run ignoré (pas de badge, pas de crash).
- Pas de script file correspondant au runId → nom = runId.
- Fichier d'état présent mais JSON invalide/tronqué (écriture en cours) → retenter au tick
  suivant, ne pas cacher l'échec.
- Plusieurs workflows simultanés dans une session → un badge par run.
- Run abandonné (kill) : si le fichier d'état n'est jamais écrit, le badge reste tant que le
  dossier existe. Garde-fou : journal mtime > 30 min sans nouvel événement → badge retiré
  silencieusement (pas de notif « terminé » — on n'a pas de preuve de succès).
- Watcher démarré en cours de run → le `session-added` initial sérialise la session, donc le
  run est découvert et entre dans le suivi du tick ; s'il est déjà terminé au démarrage, pas
  de notif rétroactive (un run découvert déjà completed n'est jamais entré dans le suivi des
  runs actifs, donc la transition running→completed n'est jamais observée).

## Tests

- Nouveau `test/workflows.test.js` (ou extension de `subagents.test.js`) avec fixtures :
  - journal nominal → compteurs corrects ;
  - journal avec dernière ligne tronquée → ligne ignorée, pas de crash ;
  - runId sans script file → nom fallback ;
  - fichier d'état completed → statut + stats ;
  - état JSON tronqué → pas de cache, retenté ;
  - one-shot notif (deux ticks completed → une seule notif) ;
  - run stale (> 30 min) → exclu.

## Rappels build

- Si nouveau module `.js` → l'ajouter à `package.json` `build.files` (whitelist — le DMG
  crashe sinon, invisible en dev).
