# Chip « Chrome » + fix session fantôme au resume + durcissement readNewLines

Date : 2026-08-04
Statut : validé par Paul (brainstorming), en attente de relecture du spec

## Contexte et problème

Paul utilise l'extension Claude in Chrome (tools MCP `mcp__claude-in-chrome__*`) sur la
session « Agnès Guédeu - Artiste Peintre ». Symptôme rapporté : la carte reste « Inactif »
tout le long, impossible de savoir quand une action est attendue dans Chrome (accepter une
URL, reconnecter l'extension…).

Le diagnostic live (2026-08-04, session `0e56aa95`) a révélé DEUX causes distinctes :

### Cause 1 (majeure) — session fantôme au resume

Reconstitution vérifiée sur les logs et le disque :

1. 10:14:5x — l'ancien process Claude meurt (quit). Le watcher retire `0e56aa95`
   (`markCompleted` → `removeSession`, tous deux muets).
2. 10:15:42 — nouveau `claude` (PID 51320). Au démarrage, le CLI écrit `session.json`
   avec un sessionId **provisoire** (`d87478e8`) — alloué avant le choix du resume.
3. Le scan crée une session `d87478e8` ; son JSONL n'existe pas (et n'existera jamais)
   → pas de file watcher.
4. Paul resume → le CLI bascule sur `0e56aa95` et met à jour `session.json`.
5. Chaque scan suivant : trackedId par (pid, cwd) = `d87478e8` ; `_isSidStale` répond
   `false` pour un JSONL **absent** (« missing JSONL: not stale, just absent »,
   watcher.js:421) → `effectiveId = trackedId` pour toujours. Le vrai JSONL `0e56aa95`
   n'est plus jamais lu. Carte figée « Inactif », zéro notif, zéro ligne de log.

Preuves : `config.sessions` de l'app contient `d87478e8` (pid 51320) et plus `0e56aa95` ;
aucun `d87478e8*.jsonl` sur disque ; aucune occurrence de `d87478e8` dans main.log ;
plus aucune transition `0e56aa95` après 10:14:49 alors que son JSONL grossit jusqu'à 10:36+.

Ce bug n'a AUCUN lien avec Chrome : n'importe quel quit → relance → resume dans un même
cwd le déclenche. Claude in Chrome n'a fait que le rendre visible (sessions longues,
attentes fréquentes côté navigateur).

### Cause 2 (mineure, latente) — events perdus sur ligne partielle

`readNewLines` avance `fileOffsets` à `stat.size` puis parse ligne à ligne en skippant
les malformées. Si le poll (250 ms) tombe pendant l'écriture d'un gros event, la dernière
ligne du chunk est tronquée → parse fail → event PERDU (l'offset a déjà avancé). Les
tool_results de Claude in Chrome (screenshots base64, 100-400 KB mesurés) rendent la
fenêtre de collision non négligeable. Perdre un `tool_result` ou un `end_turn` = transition
d'état ratée.

### Besoin produit (à l'origine de la conversation)

Même une fois le bug corrigé, une session qui pilote Chrome et rend la main
(« Inactif ») ne dit pas que l'action attendue est côté navigateur. Paul veut un
indicateur : le chip « Chrome ».

## Design

### Volet A — adoption du vrai sessionId au resume (watcher.js, scan())

Dans la branche `if (trackedId)` de `scan()`, distinguer « JSONL absent » de « stale » :

- Nouveau helper `_jsonlExists(sid, cwd)` (statSync sur `<projDir>/<sid>.jsonl`, bool).
- Règle ajoutée EN TÊTE de la branche : si `!_jsonlExists(trackedId, cwd)` ET
  `sessionId !== trackedId` ET `_jsonlExists(sessionId, cwd)` → `effectiveId = sessionId`
  (session.json sait mieux : le trackedId n'a jamais eu / n'a plus de JSONL).
- La mécanique existante (ligne ~272) fait le reste : `migrateSession(trackedId →
  sessionId)` préserve nom custom, prefs notifs, position, et switche le file watcher.
- Le cas légitime « JSONL pas encore créé » (session neuve avant le premier prompt)
  est protégé : `session.json` rapporte alors le MÊME sid provisoire →
  `sessionId !== trackedId` est faux, rien ne change.
- `_isSidStale` garde son contrat actuel (absent → false) : c'est la décision
  d'attribution qui apprend à distinguer, pas le helper existant.

Observabilité (leçon du diagnostic — tout ce chemin était muet) :
- log info `[watcher] resume adopt <old8> → <new8> (pid=…)` au moment de l'adoption ;
- log info dans `removeSession` (`[watcher] removed <id8> (<raison si connue>)`).

Vérifier au passage que `migrateSession` recale bien l'état depuis le JSONL cible
(fastInitialLoad ou équivalent) — sinon l'appeler explicitement après le switch.

### Volet B — readNewLines résistant aux lignes partielles (watcher.js)

- Chercher le dernier `\n` (byte 0x0A) DANS LE BUFFER (positions en bytes, pas après
  décodage UTF-8) ; ne parser que `buffer[0 .. lastNL]` ; avancer `fileOffsets` à
  `currentOffset + lastNL + 1` seulement.
- Chunk sans aucun `\n` → offset inchangé, on attend le prochain poll.
- Garde-fou : chunk sans `\n` au-delà de 16 Mo (aligné sur MAX_TAIL) → avancer quand
  même l'offset (ligne pathologique, on préfère perdre 1 event que boucler à vie).
- Zéro état supplémentaire (pas de map de restes partiels).

### Volet C — chip « Chrome » (usage récent, 5 min)

Sémantique choisie par Paul : « usage récent », pas persistant — le but est de savoir
que ça se passe dans Chrome MAINTENANT (et, combiné à « Inactif », que l'action
attendue est probablement côté navigateur).

- **Détection (watcher.js)** : dans `processAssistantEvent`, tout content block
  `tool_use` dont `name` commence par `mcp__claude-in-chrome__` pose
  `session.chromeLastUsedAt` = timestamp de l'event JSONL (champ `timestamp` ISO,
  jamais `Date.now()` — resume-safe). Helper pur exporté `isChromeToolUse(name)`.
- **Restauration** : `fastInitialLoad` repère ces tool_use dans le tail et restaure
  `chromeLastUsedAt`. Pas de persistance config : TTL 5 min, un usage hors fenêtre
  de tail est expiré ou négligeable (dégradation gracieuse, même choix que bgTasks).
- **Exposition** : `serializeSession` ajoute `chromeLastUsedAt` (epoch ms ou null).
  Le main ne calcule rien — l'expiration vit côté renderer.
- **Rendu** : chip « Chrome » cyan, même gabarit que le chip « N bg process », cartes
  grid + compact. Le ticker 1 s existant (`updateDurations`) masque le chip quand
  `now − chromeLastUsedAt > CHROME_RECENT_MS` (300 000 ms) — écriture DOM au
  changement seulement. Helper pur testable `chromeChipVisible(lastUsedAt, now)`.
  Île, micro, toasts : exclus.
- **Aucun nouvel état, aucune notif ni mute** : une session `waiting` notifie comme
  avant ; le chip encore visible contextualise (« va voir Chrome »).

## Hors scope

- Détection fine « action requise dans Chrome » par pattern-matching des messages
  d'erreur de l'extension (« Browser extension is not connected », permission d'URL) :
  jugée fragile (strings non contractuelles), reportée — à réévaluer à l'usage une
  fois les volets A/B/C en place.
- Les sessions Claude côté claude.ai/app desktop qui pilotent Chrome : elles n'écrivent
  rien dans `~/.claude`, invisibles par construction.

## Tests

- **A** : session trackée sans JSONL + session.json rapportant un sid différent avec
  JSONL existant → adoption + migration (prefs préservées, watcher switché) ; session
  neuve (même sid provisoire, JSONL absent) → aucun changement de comportement.
- **B** : chunk se terminant en pleine ligne → l'event est parsé au poll suivant,
  aucun perdu ; chunk sans `\n` → offset inchangé ; garde-fou 16 Mo.
- **C** : `isChromeToolUse` ; détection dans `processAssistantEvent` ; restauration
  tail dans `fastInitialLoad` ; `chromeChipVisible` (bornes du TTL) ; `serializeSession`
  expose le champ.
- Piège connu : tout nouveau module .js ajouté → `build.files` du package.json.

## Rappel opérationnel

La session Agnès actuellement gelée se resynchronise dès le prochain redémarrage de
l'app watcher (la re-découverte au boot lit le bon sid depuis session.json) — pas
besoin d'attendre le fix pour la débloquer.
