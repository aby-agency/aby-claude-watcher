# Vue Office v2.1 — pièce adaptative — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la pièce fixe 10×8 par une pièce adaptative — base 7×5, +1 colonne si subagents, +2 rangées si workflow actif.

**Architecture:** Seul `ui/office-layout.js` change substantiellement : `roomFor(session)` calcule `cols/rows` et les positions depuis l'activité. `ui/office.js` lit déjà `room.cols/rows` par pièce — aucun changement requis (vérifier qu'aucune constante 10/8 n'y traîne). Tests de géométrie mis à jour.

**Tech Stack:** inchangé (vanilla, tests node purs).

## Global Constraints

- Mêmes contraintes globales que le plan `2026-07-17-office-rooms.md` (couleurs, timer unique, zoom [1..4], teintes, commits sans trailer, jamais de push).
- Géométrie amendée (spec § Amendement 2026-07-17) :
  - **Base 7×5** (cols 0-6, rows 0-4) : mur rangée 0, porte (5,0), poster (2,0) ; `deskChar` (2,1) ; `desk`+`deskSetup` (1,2) ; machine à café (1,4) ; `coffee` (2,4) ; `plant` (5,4) ; `door` spawn (5,1). `floorWood` sous le coin café : (1,3), (2,3), (1,4), (2,4).
  - **Subagents ≥ 1** → cols = 8 : `sideSeats` (6,1) et (6,3), `sideDesk` (6,2) et (6,4).
  - **Workflow actif** (`workflowRunning > 0`) → rows = 7 : `meetingTable` (3,5), `meetingSeats` (2,5), (4,5), (2,6), (4,6).
  - Papiers d'erreur : `_papers` (3,3) et (2,2) (dans la zone visible de la base).
  - `ROOM_COLS`/`ROOM_ROWS` deviennent `BASE_COLS = 7` / `BASE_ROWS = 5` (exportés) ; `roomFor` retourne les dimensions effectives.

---

### Task 1: Géométrie adaptative dans `office-layout.js`

**Files:**
- Modify: `ui/office-layout.js` (constantes de géométrie, `roomFor`, `syncSession` — positions des sièges)
- Modify: `test/office-layout.test.js` (tests de géométrie + un test « adaptatif »)
- Modify: `docs/…` : rien d'autre.

**Interfaces:**
- Consumes: l'API v2 existante.
- Produces: `roomFor(session)` → `{cols: 7|8, rows: 5|7, statics, zones}` (mêmes clés de zones qu'avant : door, deskChar, coffee, sideSeats, meetingSeats, subOverflow). Exports : `BASE_COLS = 7`, `BASE_ROWS = 5` (remplacent ROOM_COLS/ROOM_ROWS — vérifier par grep qu'aucun consommateur externe ne référence les anciens noms ; `ui/office.js` ne doit lire que `room.cols/rows`).

- [ ] **Step 1: Adapter les tests de géométrie**

Dans `test/office-layout.test.js`, remplacer les assertions de géométrie par les nouvelles positions (bloc Global Constraints ci-dessus) et ajouter :

```js
test('pièce de base 7×5, sans sièges latéraux ni réunion', () => {
  const r = OL.roomFor(sess('a', 'running'));
  assertEq(r.cols, 7); assertEq(r.rows, 5);
  assert(!r.statics.some(x => x.frame === 'sideDesk'));
  assert(!r.statics.some(x => x.frame === 'meetingTable'));
});
test('subagents → +1 colonne (8 de large)', () => {
  const r = OL.roomFor(sess('a', 'running', { subagents: [{ agentId: 'g1' }] }));
  assertEq(r.cols, 8); assertEq(r.rows, 5);
  assert(r.statics.some(x => x.frame === 'sideDesk'));
});
test('workflow actif → +2 rangées (7 de haut)', () => {
  const r = OL.roomFor(sess('a', 'running', { workflows: [{ runId: 'w', running: 2 }] }));
  assertEq(r.cols, 7); assertEq(r.rows, 7);
  assert(r.statics.some(x => x.frame === 'meetingTable'));
});
test('subagents + workflow → 8×7', () => {
  const r = OL.roomFor(sess('a', 'running', { subagents: [{ agentId: 'g1' }], workflows: [{ runId: 'w', running: 2 }] }));
  assertEq(r.cols, 8); assertEq(r.rows, 7);
});
test('le mur et le sol couvrent les dimensions effectives', () => {
  const r = OL.roomFor(sess('a', 'running', { subagents: [{ agentId: 'g1' }], workflows: [{ runId: 'w', running: 2 }] }));
  assertEq(r.statics.filter(x => x.frame === 'wall').length, r.cols);
  const floor = r.statics.filter(x => x.frame === 'floor' || x.frame === 'floorWood');
  assertEq(floor.length, r.cols * (r.rows - 1));
});
```
Mettre à jour les tests existants qui assertent les anciennes coordonnées (deskChar 3,2 → 2,1 ; door 8,1 → 5,1 ; coffee 2,6 → 2,4 ; etc.) et les destinations de chemins dans les tests de marche (chaise = (2,1)).

- [ ] **Step 2: Run — vérifier l'échec**

Run: `node test/office-layout.test.js`
Expected: FAIL sur les nouvelles assertions (géométrie encore fixe 10×8).

- [ ] **Step 3: Implémenter la géométrie adaptative**

Dans `ui/office-layout.js` : remplacer les constantes par la géométrie du bloc Global Constraints (BASE_COLS/BASE_ROWS + positions), faire calculer à `roomFor` `cols = hasSubs ? 8 : 7` et `rows = hasMeeting ? 7 : 5`, générer mur/sol sur les dimensions effectives, ne pousser sideDesks/meetingTable/seats que si présents. `syncSession` lit les positions depuis les mêmes constantes (sièges latéraux, sièges réunion). `_papers` aux nouvelles positions.

- [ ] **Step 4: Run — tout vert**

Run: `node test/office-layout.test.js` puis `npm test`
Expected: PASS complet. Vérifier aussi : `grep -n "ROOM_COLS\|ROOM_ROWS" ui/ test/ -r` → plus aucune référence aux anciens exports hors office-layout lui-même.

- [ ] **Step 5: Vérification CDP rapide**

Flow habituel (kill, dev, sessions forgées, screenshots REGARDÉS) :
1. Session simple → pièce 7×5, nettement plus zoomée qu'avant dans la même carte.
2. Session forgée avec subagents (ou workflow) → sa vignette est visiblement plus grande ; retrait → la pièce rétrécit proprement (perso toujours à sa place, pas hors murs).
3. Acteur en route quand la pièce rétrécit (ex. subagent parti pendant que le perso va au café) → pas d'acteur hors murs (le path reste dans la base 7×5 : positions base toutes < 7×5, OK par construction — vérifier visuellement quand même).
Nettoyer, relancer `npm start` depuis le repo.

- [ ] **Step 6: Commit**

```bash
git add ui/office-layout.js test/office-layout.test.js
git commit -m "feat(office): pièce adaptative — base 7×5, +1 col subagents, +2 rangées réunion"
```
