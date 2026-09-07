# Présence CLI — `status` de session.json comme autorité d'état

Date : 2026-09-07
Statut : validé par Paul (brainstorming, approche A), en attente de relecture du spec

## Contexte et problème

Depuis toujours, le watcher **reconstruit** l'état d'une session à partir du JSONL de
transcript (dernier event `user` → thinking, `assistant stop_reason: tool_use` → running,
`end_turn` + 2 s → waiting) et d'un hook (`PermissionRequest` → pending). Cette
reconstruction est la source des faux positifs remontés par Etienne (« depuis toujours les
status sont jamais vraiment justes ») : pending fantômes, « Inactif » pendant qu'une
délégation tourne, pending perdu au redémarrage (d'où l'ancrage `pendingMarks`).

Le check des nouveautés Claude Code du 2026-09-07 (CLI 2.1.263, changelog 2.1.220 → 2.1.263
lu en entier, binaire fouillé) révèle que le CLI **publie lui-même sa présence** dans
`~/.claude/sessions/<pid>.json`, réécrit à chaque rendu React (« session presence »,
présent au moins depuis 2.1.260, absent en 2.1.191). Champs vérifiés dans le binaire :

| Champ | Valeurs | Dérivation côté CLI |
|---|---|---|
| `status` | `busy` | `isLoading \|\| delegatedActive` — un tour en cours OU des tâches déléguées actives (agents locaux/distants, teammates in-process non idle, workflows, monitors, mcp_task…) |
| | `idle` | ni l'un ni l'autre, aucune tâche Bash de fond |
| | `shell` | `idle` mais au moins une tâche `local_bash` non terminée |
| | `waiting` | un dialogue bloque : voir `waitingFor` |
| `waitingFor` | `permission prompt` | prompt de permission d'outil (valeur par défaut, `fk[kind].waitingFor ?? "permission prompt"`) |
| | `input needed` | elicitation MCP, setup teammate |
| | `sandbox request` | commande sandboxée demandant le réseau |
| | `worker request` | requête d'un worker background |
| | `goal proposal` | Claude propose un objectif de session |
| | `dialog open` | commande JSX locale ouverte (`/model`, `/config`…) ET quelques dialogues « Session paused » (fallback modèle, crédits) |
| `statusUpdatedAt` | epoch ms | posé à chaque écriture d'un `status` |
| `updatedAt` | epoch ms | toute écriture du fichier |
| `kind` | `interactive` \| `bg` \| `daemon` \| `daemon-worker` | nature du process |
| `parkedJobId` | string | l'original « stalled » d'une session passée en arrière-plan (`Ctrl+B`, `/background`, `--bg`) — `claude agents` MASQUE ces lignes |
| `spare` | `true` | worker pré-chauffé par l'agent view, jamais de JSONL |
| `nameSource` | + `peer`, `collision`, `hook` | nouvelles valeurs (déjà compatibles : `explicitSessionName` filtre par exclusion) |

Ce modèle recouvre exactement le nôtre : `busy` ≈ thinking/running/delegating, `idle` ≈
waiting, `waiting` ≈ pending, `shell` ≈ waiting + chip « bg process ». La différence :
c'est le CLI qui le calcule, depuis son état interne, pas une déduction.

Le même changelog signale que les sous-agents tournent désormais **en arrière-plan par
défaut** (2.1.232) : le parent rend la main pendant qu'ils travaillent, le cas
« délégation » devient la norme, ce qui rend la déduction JSONL encore plus fragile.

## Décisions de cadrage (Paul, 2026-09-07)

1. **Présence = autorité sur l'état gros grain** quand le champ `status` est présent et
   valide. Le JSONL ne sert plus qu'à raffiner `busy` en thinking/running et aux
   métadonnées (modèle, tokens, branche, slug, chip Chrome). CLI ancien (pas de `status`)
   = comportement actuel, inchangé.
2. **Ambre « Action requise »** pour tout `waiting` SAUF `dialog open`, qui reste vert
   avec un libellé discret « Dialogue ouvert » et sans notification.
3. **Périmètre** : présence + masquage du jumeau `parkedJobId` + `kind`/`spare`.
   Hors scope : mute `/loop`/`ScheduleWakeup`, chip Remote Control, focus tmux, hooks
   `SessionStart`/`Stop`, modèle et effort par sous-agent.
4. **Le hook `PermissionRequest` reste** : il pose le pending instantanément ; la présence
   le confirme ou l'infirme au scan suivant.

## Design

### Volet A — module pur `presence.js` (nouveau, testé)

Double export node/window inutile (main process seulement) : `module.exports` classique.

```js
const PRESENCE_STATUSES = ['busy', 'shell', 'idle', 'waiting'];
const DIALOG_OPEN = 'dialog open';

// session.json brut → { status, waitingFor, statusUpdatedAt } | null
// null = pas de présence exploitable (CLI ancien, status inconnu, statusUpdatedAt absent
// ou non numérique). Un futur status inconnu → null, JAMAIS une interprétation.
function readPresence(data)

// Décision pure, aucun effet : que faire de cette présence pour une session donnée ?
// Entrées : presence (non null), currentState (nom), stateSince (ms|null),
//           watcherStartedAt (ms), pendingByHookAt (ms|null)
// Sortie : { target: 'waiting'|'pending'|'running'|null, trigger, at, silent, mute,
//            dialogOpen, shell, waitingFor }
function presenceDecision({ presence, currentState, stateSince, watcherStartedAt })
```

Règles de `presenceDecision` (toutes testées une par une) :

| `status` | `waitingFor` | état courant | décision |
|---|---|---|---|
| `idle` | — | thinking / running / pending | `target: waiting`, trigger `presence:idle` |
| `idle` | — | waiting | `target: null` (no-op), `mute: false` |
| `shell` | — | thinking / running / pending | `target: waiting`, trigger `presence:shell`, `shell: true`, `mute: true` |
| `shell` | — | waiting | `target: null`, `shell: true`, `mute: true` |
| `waiting` | ≠ `dialog open` | thinking / running / waiting | `target: pending`, trigger `presence:waiting`, `waitingFor` |
| `waiting` | ≠ `dialog open` | pending | `target: null`, `waitingFor` (mise à jour du libellé) |
| `waiting` | `dialog open` | thinking / running / pending | `target: waiting`, trigger `presence:dialog`, `dialogOpen: true`, `mute: true` |
| `waiting` | `dialog open` | waiting | `target: null`, `dialogOpen: true`, `mute: true` |
| `busy` | — | pending | `target: running`, trigger `presence:busy` (la question a été traitée) |
| `busy` | — | waiting | `target: null`, `mute: true` (délégation : tour fini, délégués au travail) |
| `busy` | — | thinking / running | `target: null` |

Garde d'ordre temporel, appliquée AVANT le tableau : si `presence.statusUpdatedAt <
stateSince` et que l'état courant est `pending` (posé par le hook), la présence est
**antérieure** à l'événement qui a posé l'état → `target: null`. Ça couvre la course hook
→ pending → scan qui relit un `busy` écrit avant l'apparition du prompt. Pas de garde dans
l'autre sens : une présence plus récente que l'état gagne toujours, c'est le principe.

`at` = `presence.statusUpdatedAt` (vraie date de la transition côté CLI, jamais
`Date.now()`) — alimente `stateSince` et donc « Inactif · 12 min ».

`silent` = `presence.statusUpdatedAt < watcherStartedAt` : la transition a eu lieu avant
le lancement de l'app → appliquée avec `isInitial = true`, **aucune notif rétroactive**
(règle établie). C'est aussi ce qui **restaure le pending au démarrage** pour les CLI
récents, sans passer par `pendingMarks` (conservé tel quel comme fallback CLI ancien ;
la présence s'applique après `fastInitialLoad` et prime).

### Volet B — application dans `scan()` (watcher.js)

Dans la branche « session déjà trackée » de `scan()` (après la relecture du nom), et
juste après la création dans la branche « découverte » :

1. `session.presence = readPresence(data)` (null si CLI ancien). Persisté ? NON — relu à
   chaque scan, 2 s, aucune valeur à survivre.
2. Si `presence` non null ET PID vivant : `decision = presenceDecision(...)`.
   - `session.shellBusy = decision.shell`, `session.dialogOpen = decision.dialogOpen`,
     `session.waitingFor = decision.waitingFor || null` ; émission `session-updated` si
     l'un des trois change (comme pour `sessionName` : rien dans le JSONL ne le dira).
   - Si `decision.target` : `clearWaitingTimer` + `clearPendingTimer`, puis
     `setState(id, STATES[target], decision.silent, decision.trigger, decision.at)`.
   - Mémoire de mute : `session.presenceMuted = true` quand `decision.mute` a empêché
     une notif (voir C) ; quand la présence repasse `idle` avec l'état `waiting` et
     `presenceMuted` vrai → `maybeNotifyWaiting` (bannière tardive, comme la purge
     bg-stale) puis `presenceMuted = false`.
3. Si PID mort : rien (le chemin `markCompleted` existant s'en charge).

Fréquence : `SCAN_INTERVAL` reste à 2 s. Le pending instantané vient du hook ; la présence
est une confirmation à ≤ 2 s. Les cas sans hook (message inter-session à approuver,
sandbox, worker) attendent ≤ 2 s : acceptable.

### Volet C — gardes dans la machine JSONL (watcher.js)

La présence prime : les transitions JSONL vers `waiting`/`pending` sont **filtrées** quand
elle dit autre chose.

- `startWaitingTimer` au tir : si `session.presence?.status === 'busy'` → ne PAS passer
  waiting (rester running), log `[state] … end_turn ignoré (presence busy)`. Le passage à
  waiting viendra de la présence `idle` (volet B). Sans présence : inchangé.
- `setState` — mute de notif : la condition actuelle
  `newState === waiting && hasOpenBgTask` devient
  `newState === waiting && (hasOpenBgTask || session.shellBusy || session.dialogOpen
  || session.presence?.status === 'busy')`, log `[notif] muet (<raison>)`, et pose
  `session.presenceMuted = true` quand la raison vient de la présence.
- `markPending` (hook) : inchangé. Le hook pose le pending, le scan suivant (≤ 2 s) le
  corrige si la présence dit autre chose ET est plus récente (garde d'ordre du volet A).
  Le son différé de 5 s (`schedulePendingAlert`, main.js) relit déjà l'état au tir → une
  correction par présence en < 5 s annule le son, comme une approbation rapide.
- `hook:idle-reminder` : inchangé (déjà idempotent sur waiting).
- `fastInitialLoad` : inchangé. La présence s'applique au premier `scan()` qui suit.

### Volet D — `kind`, `spare`, `parkedJobId` (watcher.js, scan())

Avant toute attribution dans la boucle `liveSessions` :

- `data.spare === true` → `continue` (worker pré-chauffé, pas de JSONL, carte fantôme).
- `data.parkedJobId` défini → `continue`, et si un `trackedId` existait pour ce (pid, cwd)
  → `removeSession(trackedId)` avec log `[watcher] parked <sid> masqué (job <parkedJobId>)`.
  C'est exactement le filtre de `claude agents`. La copie qui travaille apparaît par son
  propre `session.json` (`kind: bg` ou `daemon-worker`).
- `isBackground = (!!kind && kind !== 'interactive') || (!!entrypoint && entrypoint !== 'cli')`.
  Champ `kind` absent → règle `entrypoint` seule (CLI ancien).

### Volet E — surfaces (main.js, renderer, i18n)

`serializeSession` expose :
- `bgTaskCount` = `session.bgTasks.size || (session.shellBusy ? 1 : 0)` — la présence dit
  « au moins une », le JSONL donne le compte quand il l'a.
- `dialogOpen` (bool) et `waitingFor` (string | null).
- État : inchangé (`session.state` + overrides existants). `delegating` s'affiche déjà
  quand `waiting` + agents vivants ; on ajoute `|| session.presence?.status === 'busy'`
  dans la condition de `serializeSession` ET `effectiveStateName` (même `hasLiveDelegation`
  ne voit pas les teammates in-process ni les agents distants — la présence, si).

Renderer (grid + compact) :
- chip « Dialogue ouvert » (`dialog_chip`, fr/en « Dialogue ouvert » / « Dialog open »),
  même gabarit que `.bg-chip`, rendu à côté du chip bg quand `dialogOpen`.
- tooltip du badge pending : `waitingFor` brut quand présent (« permission prompt »,
  « input needed »…), sinon le titre actuel.

Île, micro, toasts : rien de nouveau (ils consomment `state`).

### Volet F — observabilité

- Chaque transition par présence est logguée par `setState` avec son trigger
  `presence:<status>` (déjà le cas pour tout trigger).
- Log `[presence] <sid> status=<s> waitingFor=<w> ignoré (antérieur au pending)` pour la
  garde d'ordre, et `[state] <sid> end_turn ignoré (presence busy)` (volet C).
- CLAUDE.md : nouveau paragraphe « Présence CLI » dans Key decisions, mise à jour du
  tableau States (source de vérité), correction `/name` → `/rename`.

## Hors scope (noté pour plus tard)

- Mute `/loop` / `ScheduleWakeup` (bannière à chaque itération).
- Chip Remote Control (`bridgeSessionId`), focus tmux exact (`tmux`).
- `claude attach <id>` pour les sessions background (à la place de `--resume`).
- Hooks `SessionStart`/`SessionEnd`/`Stop`/`PostModelSwitch` (transitions instantanées).
- Modèle + effort par sous-agent, `formatModel` pour `mythos`.
- Migration du `customName` après `/clear` (le nom `/rename` survit, pas notre alias).

## Tests

`test/presence.test.js` (nouveau, ajouté au script `npm test`) :
- `readPresence` : status valide → objet ; absent / inconnu (`"foo"`) / `statusUpdatedAt`
  manquant → null ; `waitingFor` non string → undefined.
- `presenceDecision` : une assertion par ligne du tableau du volet A, plus la garde
  d'ordre (busy antérieur à un pending → null ; busy postérieur → running) et `silent`
  (statusUpdatedAt < watcherStartedAt → true).

`test/watcher.test.js` (scan avec `session.json` forgés, pattern existant) :
- présence `waiting` + `permission prompt` → pending, `waitingFor` exposé, notif émise
  (`session-waiting`) quand statusUpdatedAt > démarrage ; silencieuse sinon.
- présence `waiting` + `dialog open` → waiting, `dialogOpen`, aucune notif.
- présence `busy` sur une session pending posée par le hook APRÈS `statusUpdatedAt` →
  reste pending ; avec `statusUpdatedAt` postérieur → running.
- présence `shell` → waiting, `shellBusy`, notif muette ; puis `idle` → bannière tardive
  une seule fois.
- `end_turn` JSONL avec présence `busy` → reste running ; présence `idle` ensuite → waiting.
- `parkedJobId` → session retirée, `spare` → jamais créée, `kind: bg` → `isBackground`.
- CLI ancien (pas de `status`) → aucun des champs posés, comportement inchangé (les tests
  existants le couvrent déjà, ils doivent rester verts sans modification).

Vérification en live (Paul a demandé un test local) : lancer l'app en dev sur une session
réelle, déclencher un prompt de permission, ouvrir `/model`, lancer un `Bash` en fond, un
sous-agent, et relire main.log : chaque transition doit porter un trigger `presence:*` ou
un « ignoré (presence busy) » cohérent.

## Rappel opérationnel

- Commits signés Paul uniquement, pas de push sans demande.
- `npm test` vert avant chaque commit ; build DMG non requis pour le test local (`npm run dev`).
