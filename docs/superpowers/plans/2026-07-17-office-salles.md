# Vue Office v3 — les salles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivoter la vue office de « une pièce par session » vers « 3 salles par fonction » (travail/pause/recherche) avec migration animée des persos entre salles.

**Architecture:** `ui/office-layout.js` v3 : `roomsFor(snapshot)` construit les 3 salles (géométrie extensible par salle, slots stables par salle) et les acteurs globaux migrent (leave porte A → enter porte B). `ui/office.js` : 3 canvases fixes, drawRoom généralisé (+ mini-étiquettes pixel, hit-test par acteur), la vue possède son container (plus de flux cartes-par-session dans renderer.js). Bake : +sofa.

**Tech Stack:** inchangé (vanilla, tests node purs, atlas LimeZu, CDP pour le visuel).

## Global Constraints

- Spec : docs/superpowers/specs/2026-07-17-office-salles-design.md (fait foi).
- Mêmes contraintes que les plans v2.x (zéro dépendance, timer 8 fps unique coupé vue inactive, zoom entier [1..4] par canvas, commits sans trailer, jamais de push, assets jamais commités).
- Répartition : Travail = running/thinking/pending/error ; Pause = waiting ; Recherche = subagents actifs + agents de workflows (dédup runId) + headless (coin sombre).
- Acquis v2.x à CONSERVER : bulles émotes et leurs priorités ; assise demi-tile -5px ; fauteuil #106 en overlay conditionnel (par acteur assis) ; LED d'état sur le moniteur secondaire de chaque poste ; hit-test CSS→pixels natifs ; étiquette pixel = nom projet tronqué 8 caractères sous le perso (`pixelTextOn`, couleur `#cfd2da`, fond optionnel sombre si illisible — à juger à l'œil).
- Slots stables PAR SALLE (plus petit libre, conservé tant que l'occupant reste dans la salle). Migration : leave → sortie porte salle A → l'acteur bascule de salle (teleport) → enter par la porte salle B → marche vers son slot.
- Les 3 salles toujours rendues, ordre fixe Travail/Pause/Recherche, footer « nom · N » (i18n fr/en : `room_work`, `room_break`, `room_research`).
- Clic = uniquement sur un perso (focus session ; subagents/meeting → focus de la session parente ; headless → pas de focus). Tooltip par perso.

## Géométrie des salles (référence — l'implémenteur ajuste ±1 à l'œil, invariants testés)

- **Travail** : cols 8 ; rangée 0 mur + porte (6,0)/spawn (6,1) ; postes en rangées de 2 (cellule 4 tuiles de large : setup+desk (0,1)+(4,1), persos (1,2)/(5,2)…), rangées ajoutées par paires de postes occupés (rows = 3 + 2·ceil(n/2), min 5) ; couloir central vertical col 3 + rangée basse. Slots : 0=(1,2), 1=(5,2), 2=(1,4), 3=(5,4)…
- **Pause** : cols 8, rows 5 fixes ; comptoir+tasse (0,1), fontaine (1,1), distributeur (7,1), canapés (2,3)/(5,3), plantes (7,4)/(0,4) ; porte (6,0)/spawn (6,1) ; places debout/assises : (2,2),(4,2),(6,2),(1,3),(4,3),(6,3)… (extensible par rangées si plein).
- **Recherche** : cols 8 ; table de réunion double (3,2)-(4,2), whiteboard mur (0,0)-(1,0), porte (6,0) ; sièges autour de la table (2,2),(5,2),(3,3),(4,3) pour les agents de workflow ; postes latéraux (sideDesk+laptop) col 0-1 rangées 3+ pour les subagents ; coin headless : colonnes 6-7 rangées 2+, sol assombri par un voile local (rect alpha 0.35 sur la zone), persos assis sans focus. rows = 4 + extension selon occupants.

## File Structure

- Rewrite: `ui/office-layout.js` (v3 salles) + Rewrite: `test/office-layout.test.js`
- Modify: `ui/office.js` (3 canvases, étiquettes, hit-test acteurs, tooltip/clic par perso)
- Modify: `ui/renderer.js` (vue office autonome : plus de viewItemHTML/fullRender pour office ; hooks notifyUpdate conservés), `ui/index.html`/`ui/styles.css` (containers salles), `i18n.js` (3 clés)
- Modify: `scripts/office-sprites.js` (+`sofa`), `test/bake-smoke.test.js`
- Modify: `CLAUDE.md` (bullet key decisions)

---

### Task 1: `office-layout.js` v3 — salles, slots par salle, migration (pur + tests)

**Interfaces produites (consommées par Task 2) :**
- `createState()` → `{ actors: Map, slots: { work: Map, break: Map, research: Map } }`
- `roomsFor(snapshot)` → `[{key, cols, rows, statics, doorSpawn:{tx,ty}, counter}]` (3 entrées, ordre travail/pause/recherche ; `counter` = occupants pour le footer). `snapshot = { interactive: [...], background: [...] }` (sessions du renderer).
- `syncActors(state, snapshot)` : diff global — acteur principal par session interactive (roomKey selon état), acteurs subagents/workflow/headless en salle recherche ; migration : changement de salle → leave (porte salle courante) puis, une fois `done`, réapparition porte salle cible avec path vers son slot (le basculement se fait dans tickActor ou syncActors — à toi de choisir, documente) ; slots par salle stables ; purge des sessions disparues (leave définitif).
- `actorsIn(state, roomKey)` triés par ty ; `tickActor` ; `animFor` ; `emoteFor` (inchangé) ; `labelFor(actor, session)` → nom tronqué 8 car.
- TDD : transposer les invariants v2 (spawn/leave, non-traversée des meubles par salle, slots stables, résurrection, dédup runId, MAX visibles + overflow par salle avec badge « +N ») + nouveaux : migration travail→pause sur waiting (l'acteur quitte, réapparaît porte pause, path vers slot pause) ; retour pause→travail ; un perso en migration qui re-change d'état repart vers la bonne salle sans téléportation visible (hors leave/enter).

Steps : tests d'abord (échec vérifié) → implémentation → `npm test` complet vert → commit `feat(office): layout v3 — salles par fonction, slots par salle, migration`.

### Task 2: Rendu 3 salles + intégration + bake sofa

**Interfaces consommées :** Task 1. **Produit :**
- Bake : frame `sofa` (choisir parmi singles 200-206 au preview, REGARDÉ) + smoke test.
- `ui/office.js` : `Office.renderRooms()` construit/possède le DOM du container (`#officeView` : 3 `.office-room-card` fixes avec canvas + footer nom/compteur) ; drawRoom généralisé (statics + acteurs + étiquettes pixel + bulles par acteur — la bulle redevient PAR acteur, plus par session unique) ; hit-test par acteur (rects écran, conversion CSS→natif) ; clic → `handleFocus(sessionId)` (headless : aucun) ; tooltip par perso.
- `renderer.js` : `viewItemHTML`/`fullRender` ne gèrent plus office — `render()` appelle `Office.renderRooms()` quand viewMode office (early path assumé et documenté) ; updateSession/removeSessionFromDOM → `Office.notifyUpdate()` simple. Retirer `Office.cardHTML`. `applyBellVisual`/bells : no-op en office (déjà tolérant).
- i18n `room_work`/`room_break`/`room_research` (fr/en), CSS `.office-room-card`.
- Vérification CDP OBLIGATOIRE avec sessions forgées : les 3 salles rendues ; une session forgée passe waiting → son perso QUITTE la salle travail et ENTRE en salle pause (screenshots de la migration REGARDÉS) ; retour running → migration inverse ; subagents forgés → persos en salle recherche avec étiquette du projet parent ; clic sur un perso → focus (spy) ; headless → coin sombre, pas de focus ; étiquettes lisibles à zoom 2 et 3 ; fenêtre étroite 400px. Nettoyage + relance dev.
- Commit `feat(office): v3 — rendu 3 salles, migration animée, étiquettes, focus par perso`.

### Task 3: Doc + clôture

- CLAUDE.md : bullet vue office mis à jour (v3 salles). `npm test` + `git status` propre (pas d'assets). Commit `docs(office): v3 salles dans les key decisions`.

## Hors plan
- Pas de release ici. Dette héritée listée au ledger. Le plan v3 assume la disparition des affordances par carte-session en vue office (cloche/rename/drag) — actées en spec.
