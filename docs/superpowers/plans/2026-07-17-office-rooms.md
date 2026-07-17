# Vue Office v2 — pièces-cartes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivoter la vue office de « un open-space unique » vers « une mini-pièce par session, présentée comme les cartes de la grille » — lisible dans toute forme de fenêtre.

**Architecture:** `ui/office-layout.js` est réécrit autour d'une API par pièce (`roomFor(session)`, géométrie fixe 10×8 tiles) en conservant la machine d'activité, les chemins et les invariants v1 transposés. `ui/office.js` devient un moteur multi-canvas : la vue office s'intègre au flux normal de `renderer.js` (fullRender/updateSession via `viewItemHTML`), chaque carte contient un canvas redessiné par un unique timer 8 fps. La teinte d'état et les papiers d'erreur sont dessinés programmatiquement (aucun changement d'atlas/bake).

**Tech Stack:** Vanilla JS, canvas 2D, zéro dépendance. Tests node purs (pattern du repo). Atlas LimeZu existant, inchangé.

## Global Constraints

- **Aucune dépendance npm nouvelle.** Atlas et bake **inchangés** (le mobilier nécessaire y est déjà).
- Couleurs d'état : thinking `#a78bfa`, running `#3b82f6`, waiting `#22c55e`, pending `#f59e0b`, error `#ef4444`.
- Pièce : **10×8 tiles** (16 px), zoom par vignette = plus grand entier tel que la pièce tient dans la largeur de la carte, **clampé à [1..4]**, `image-rendering: pixelated`.
- **Teinte d'éclairage** : voile plein-canvas couleur d'état à **12 %** d'opacité (headless : pas de teinte vive, voile sombre `#000` à 35 %).
- **Un seul timer 8 fps** (`setInterval` 125 ms) pour toutes les vignettes ; vue inactive = timer stoppé (zéro coût).
- Vignette = canvas + **nom renommable** (rename inline existant) + **cloche** (toggleNotif existant) ; détails au tooltip. Clic carte = focus (headless : pas de click-focus — `handleFocus` le gère déjà).
- Subagents : max **2** petits persos, « +N » au-delà. Workflow actif : coin réunion, max **4** persos (dédup runId, `running > 0`).
- Sortie : le perso quitte sa pièce par la porte, PUIS la vignette se retire.
- Commits format repo (`feat(office): …`), **SANS trailer Co-Authored-By**, sans mention de Claude. **Jamais de push.**
- i18n déjà en place (`view_office`) — aucune nouvelle string UI prévue.

## État actuel (base du pivot)

- `ui/office-layout.js` (v1, 297 lignes) : scène globale — slots, croissance, overflow, meeting global, café partagé. **Réécrit entièrement** (même chemin, même global `OfficeLayout`, pattern UMD conservé).
- `ui/office.js` (v1, 215 lignes) : canvas unique `#officeCanvas`, hit-test par rects. **Réécrit** en gardant : `probe()` (avec `probePromise`), `animFrameName`, le garde `sessions.size === 0` du tick, le pattern activate/deactivate.
- `ui/renderer.js` : branches office aux lignes 27, 82, 160-164, 330, 346, 677-682 (render), 737-739 (updateSession), 813-816 (removeSessionFromDOM). La v2 **intègre office au flux normal** : `viewContainer()`/`viewItemHTML()` gagnent un cas office, les early-returns spéciaux de render/updateSession disparaissent, celui de removeSessionFromDOM devient « garder la carte le temps de la sortie ».
- `ui/index.html` : `#officeView` garde son rôle de container ; le `<canvas id="officeCanvas">` unique disparaît ; `#officeTooltip` conservé.
- Atlas : frames `floor`, `floorDark`, `floorWood`, `wall`, `desk`, `deskSetup`, `chairBack`, `plant`, `poster`, `sideDesk`, `meetingTable`, anims `coffee`, `charN.*` — tout est déjà là.

## Géométrie de la pièce (fixée ici, en tiles, origine haut-gauche, cols 0-9, rows 0-7)

- Rangée 0 : `wall` sur toute la largeur ; **porte** = ouverture dessinée programmatiquement en (8,0) (rect sombre `#1a1a22` de 16×16 px).
- Sol : `floor` partout (rangées 1-7) ; coin café en `floorWood` : (1,5), (2,5), (1,6), (2,6).
- Meubles : `poster` (4,0) ; `desk` (2,3) + `deskSetup` (2,3) avec `screen` ; machine à café animée (1,6) ; `plant` (8,6).
- Positions acteurs : perso principal **(3,2)** (derrière le bureau) ; porte/spawn **(8,1)** ; point café **(2,6)** (regarde à gauche vers la machine) ; sièges subagents **(6,2)** et **(7,2)** avec `sideDesk` en (6,3) et (7,3) ; sièges réunion **(4,5), (6,5), (4,6), (6,6)** autour de `meetingTable` (5,5) — présents uniquement si workflow actif.
- Papiers d'erreur (état `error` uniquement) : marqueurs `_papers` en (4,4), (2,5) — rendus par office.js comme 3-4 petits rects pixel `#d8d3c3` posés au sol.

## File Structure

- Rewrite: `ui/office-layout.js` — API par pièce (global `OfficeLayout`, UMD)
- Rewrite: `test/office-layout.test.js` — invariants transposés
- Rewrite: `ui/office.js` — moteur multi-canvas + `Office.cardHTML`
- Modify: `ui/renderer.js` — office dans le flux normal des vues
- Modify: `ui/index.html` — retrait du canvas unique
- Modify: `ui/styles.css` — `.office-card` (grille), retrait des styles canvas unique
- Modify: `CLAUDE.md` — bullet « Key decisions » de la vue office mis à jour (Task 3)

---

### Task 1: `ui/office-layout.js` v2 — API par pièce (réécriture + tests)

**Files:**
- Rewrite: `ui/office-layout.js`
- Rewrite: `test/office-layout.test.js`

**Interfaces:**
- Consumes: rien (module pur UMD, global `OfficeLayout`, requis par node dans les tests).
- Produces (consommé par Task 2) :
  - `createState()` → `{ actors: Map }` (état persistant entre frames).
  - `ROOM_COLS = 10`, `ROOM_ROWS = 8`.
  - `roomFor(session)` → `{ cols, rows, statics, zones }`. `statics` = `[{frame, tx, ty, screen?}]` (ordre : murs+sol puis meubles ; `frame:'door'` et `frame:'_papers'` sont des marqueurs programmatiques, `frame:'coffeeMachine'` le marqueur d'anim café, comme en v1). `zones` = `{ door, deskChar, coffee, sideSeats: [..2], meetingSeats: [..4], subOverflow }` (tous `{tx,ty}` sauf `subOverflow` = entier ≥ 0).
  - `syncSession(state, session)` → crée/met à jour les acteurs de CETTE session (clés : `sid`, `` `${sid}:sub:${agentId}` ``, `` `${sid}:wf:${i}` ``).
  - `purge(state, liveIds)` → sessions absentes de `liveIds` (Set) : acteur principal passe en `leave` (retarget porte) ; acteurs sub/wf orphelins supprimés immédiatement.
  - `actorsFor(state, sessionId)` → acteurs de la session triés par `ty` (z-order).
  - `tickActor(actor, zones)`, `animFor(actor)`, `activityFor(stateName)`, `charIndexFor(name)`, `pathTo(from, to)` — mêmes signatures que v1 (`tickActor` avance 1 case tous les 2 ticks, met à jour `dir`, pose `done` quand un leaver atteint la porte).
  - `workflowRunning(session)` → total `running` des workflows de la session, dédup par `runId`, `running > 0` uniquement.

- [ ] **Step 1: Réécrire le test (invariants transposés)**

Remplacer intégralement `test/office-layout.test.js` par :

```js
// test/office-layout.test.js — Run: node test/office-layout.test.js
// v2 : une pièce par session (pièces-cartes).
const OL = require('../ui/office-layout.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

function sess(id, state, extra) {
  return Object.assign({ sessionId: id, projectName: `proj-${id}`, state: { name: state }, subagents: [], workflows: [] }, extra);
}

console.log('\ncharIndexFor / activityFor (inchangés):');
test('charIndexFor stable et borné [0,9]', () => {
  assertEq(OL.charIndexFor('aby-claude-watcher'), OL.charIndexFor('aby-claude-watcher'));
  for (const n of ['a', 'x/y', '']) { const i = OL.charIndexFor(n); assert(i >= 0 && i <= 9); }
});
test('mapping complet des activités', () => {
  assertEq(OL.activityFor('thinking'), 'think');
  assertEq(OL.activityFor('running'), 'work');
  assertEq(OL.activityFor('waiting'), 'coffee');
  assertEq(OL.activityFor('pending'), 'call');
  assertEq(OL.activityFor('error'), 'down');
});

console.log('\nroomFor (géométrie):');
test('dimensions fixes 10×8', () => {
  const r = OL.roomFor(sess('a', 'running'));
  assertEq(r.cols, 10); assertEq(r.rows, 8);
});
test('zones aux positions spécifiées', () => {
  const z = OL.roomFor(sess('a', 'running')).zones;
  assertEq(z.deskChar.tx, 3); assertEq(z.deskChar.ty, 2);
  assertEq(z.door.tx, 8); assertEq(z.door.ty, 1);
  assertEq(z.coffee.tx, 2); assertEq(z.coffee.ty, 6);
  assertEq(z.sideSeats.length, 2);
});
test('statics : desk avec screen, machine café, porte', () => {
  const st = OL.roomFor(sess('a', 'running')).statics;
  assert(st.some(x => x.frame === 'deskSetup' && x.screen === 'a'), 'pas de screen');
  assert(st.some(x => x.frame === 'coffeeMachine'), 'pas de machine');
  assert(st.some(x => x.frame === 'door'), 'pas de porte');
});
test('papiers uniquement en erreur', () => {
  const err = OL.roomFor(sess('a', 'error')).statics.filter(x => x.frame === '_papers');
  const run = OL.roomFor(sess('a', 'running')).statics.filter(x => x.frame === '_papers');
  assert(err.length >= 2, 'pas de papiers en erreur');
  assertEq(run.length, 0);
});
test('coin réunion présent seulement si workflow actif', () => {
  const w = sess('a', 'running', { workflows: [{ runId: 'wf1', name: 'r', running: 3 }] });
  assert(OL.roomFor(w).statics.some(x => x.frame === 'meetingTable'));
  assertEq(OL.roomFor(w).zones.meetingSeats.length, 4);
  assert(!OL.roomFor(sess('a', 'running')).statics.some(x => x.frame === 'meetingTable'));
});
test('subOverflow compte les subagents au-delà de 2', () => {
  const s = sess('a', 'running', { subagents: [{ agentId: 'g1' }, { agentId: 'g2' }, { agentId: 'g3' }, { agentId: 'g4' }] });
  assertEq(OL.roomFor(s).zones.subOverflow, 2);
});

console.log('\nworkflowRunning (dédup runId):');
test('somme des running, dédup par runId', () => {
  const wf = { runId: 'dup', name: 'r', running: 3 };
  const s = sess('a', 'running', { workflows: [wf, { runId: 'dup', name: 'r', running: 3 }, { runId: 'w2', name: 'x', running: 2 }] });
  assertEq(OL.workflowRunning(s), 5);
});
test('workflows terminés (running 0) ignorés', () => {
  assertEq(OL.workflowRunning(sess('a', 'running', { workflows: [{ runId: 'w', running: 0 }] })), 0);
});

console.log('\nsyncSession / purge / tickActor:');
test('nouvelle session → acteur spawn à la porte, path vers la chaise', () => {
  const st = OL.createState();
  const s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  assert(a, 'pas d\'acteur');
  assertEq(a.tx, 8); assertEq(a.ty, 1);
  const dest = a.path[a.path.length - 1];
  assertEq(dest.tx, 3); assertEq(dest.ty, 2);
});
test('l\'acteur atteint sa chaise en marchant', () => {
  const st = OL.createState();
  const s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const zones = OL.roomFor(s).zones;
  for (let i = 0; i < 100 && a.path.length > 0; i++) OL.tickActor(a, zones);
  assertEq(a.tx, 3); assertEq(a.ty, 2);
});
test('waiting → path vers le café ; retour running en route → demi-tour vers la chaise', () => {
  const st = OL.createState();
  let s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const zones = OL.roomFor(s).zones;
  while (a.path.length > 0) OL.tickActor(a, zones);
  OL.syncSession(st, sess('a', 'waiting'));
  assert(a.path.length > 0, 'pas de départ café');
  OL.tickActor(a, zones); OL.tickActor(a, zones);
  OL.syncSession(st, sess('a', 'running'));
  const dest = a.path[a.path.length - 1];
  assertEq(dest.tx, 3); assertEq(dest.ty, 2);
});
test('un acteur en erreur ne marche pas', () => {
  const st = OL.createState();
  OL.syncSession(st, sess('a', 'running'));
  const a = st.actors.get('a');
  const zones = OL.roomFor(sess('a', 'error')).zones;
  while (a.path.length > 0) OL.tickActor(a, zones);
  OL.syncSession(st, sess('a', 'error'));
  assertEq(a.path.length, 0);
  assertEq(a.activity, 'down');
});
test('purge → leave, done à la porte', () => {
  const st = OL.createState();
  const s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const zones = OL.roomFor(s).zones;
  while (a.path.length > 0) OL.tickActor(a, zones);
  OL.purge(st, new Set());
  assertEq(a.activity, 'leave');
  for (let i = 0; i < 100 && !a.done; i++) OL.tickActor(a, zones);
  assert(a.done, 'jamais done');
});
test('subagents → 2 acteurs max, aux sièges latéraux', () => {
  const st = OL.createState();
  const s = sess('a', 'running', { subagents: [{ agentId: 'g1' }, { agentId: 'g2' }, { agentId: 'g3' }] });
  OL.syncSession(st, s);
  const subs = [...st.actors.values()].filter(x => x.kind === 'subagent');
  assertEq(subs.length, 2);
  const seats = OL.roomFor(s).zones.sideSeats;
  assertEq(subs[0].tx, seats[0].tx);
});
test('subagent disparu → acteur supprimé au syncSession suivant', () => {
  const st = OL.createState();
  OL.syncSession(st, sess('a', 'running', { subagents: [{ agentId: 'g1' }] }));
  assert(st.actors.has('a:sub:g1'));
  OL.syncSession(st, sess('a', 'running'));
  assert(!st.actors.has('a:sub:g1'));
});
test('workflow → min(running, 4) acteurs meeting', () => {
  const st = OL.createState();
  OL.syncSession(st, sess('a', 'running', { workflows: [{ runId: 'w', running: 6 }] }));
  assertEq([...st.actors.values()].filter(x => x.kind === 'meeting').length, 4);
});
test('workflow terminé → acteurs meeting supprimés', () => {
  const st = OL.createState();
  OL.syncSession(st, sess('a', 'running', { workflows: [{ runId: 'w', running: 3 }] }));
  OL.syncSession(st, sess('a', 'running', { workflows: [{ runId: 'w', running: 0 }] }));
  assertEq([...st.actors.values()].filter(x => x.kind === 'meeting').length, 0);
});
test('purge supprime immédiatement subs/meeting de la session partie', () => {
  const st = OL.createState();
  OL.syncSession(st, sess('a', 'running', { subagents: [{ agentId: 'g1' }], workflows: [{ runId: 'w', running: 2 }] }));
  OL.purge(st, new Set());
  assert(!st.actors.has('a:sub:g1'));
  assertEq([...st.actors.values()].filter(x => x.kind === 'meeting').length, 0);
  assertEq(st.actors.get('a').activity, 'leave');
});
test('actorsFor trie par ty et ne renvoie que la session', () => {
  const st = OL.createState();
  OL.syncSession(st, sess('a', 'running', { subagents: [{ agentId: 'g1' }] }));
  OL.syncSession(st, sess('b', 'running'));
  const list = OL.actorsFor(st, 'a');
  assert(list.every(x => x.sessionId === 'a'));
  for (let i = 1; i < list.length; i++) assert(list[i].ty >= list[i - 1].ty, 'pas trié');
});

console.log('\nanimFor:');
test('en mouvement → walk.<dir>', () => {
  assertEq(OL.animFor({ charIdx: 3, activity: 'coffee', path: [{ tx: 5, ty: 2 }], dir: 'left' }), 'char3.walk.left');
});
test('work → idle.down, call → phone.right, down → hurt', () => {
  assertEq(OL.animFor({ charIdx: 0, activity: 'work', path: [], dir: 'down' }), 'char0.idle.down');
  assertEq(OL.animFor({ charIdx: 1, activity: 'call', path: [], dir: 'down' }), 'char1.phone.right');
  assertEq(OL.animFor({ charIdx: 1, activity: 'down', path: [], dir: 'down' }), 'char1.hurt');
});
test('coffee arrivé → idle.left (machine à gauche du point café)', () => {
  assertEq(OL.animFor({ charIdx: 1, activity: 'coffee', path: [], dir: 'left' }), 'char1.idle.left');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run — vérifier l'échec**

Run: `node test/office-layout.test.js`
Expected: FAIL — l'API v1 n'a ni `roomFor` ni `createState` (TypeError).

- [ ] **Step 3: Réécrire `ui/office-layout.js`**

Remplacer intégralement par :

```js
// ui/office-layout.js — logique pure de la vue office v2 : une mini-pièce
// par session (pièces-cartes). Géométrie fixe 10×8, machine d'activité,
// chemins en L. Aucune dépendance DOM/canvas → testable en node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const ROOM_COLS = 10, ROOM_ROWS = 8;
  const DESK_CHAR = { tx: 3, ty: 2 };
  const DOOR = { tx: 8, ty: 1 };
  const COFFEE = { tx: 2, ty: 6 };
  const SIDE_SEATS = [{ tx: 6, ty: 2 }, { tx: 7, ty: 2 }];
  const MEETING_SEATS = [{ tx: 4, ty: 5 }, { tx: 6, ty: 5 }, { tx: 4, ty: 6 }, { tx: 6, ty: 6 }];
  const MAX_SUBS = 2;

  function createState() { return { actors: new Map() }; }

  function charIndexFor(projectName) {
    let h = 0;
    const s = String(projectName || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 10;
  }

  function activityFor(stateName) {
    switch (stateName) {
      case 'thinking': return 'think';
      case 'running': return 'work';
      case 'waiting': return 'coffee';
      case 'pending': return 'call';
      case 'error': return 'down';
      default: return 'work';
    }
  }

  // Total `running` des workflows de la session, dédup par runId.
  function workflowRunning(session) {
    const seen = new Map();
    for (const w of session.workflows || []) {
      if (w.running > 0 && !seen.has(w.runId)) seen.set(w.runId, w.running);
    }
    let n = 0;
    for (const v of seen.values()) n += v;
    return n;
  }

  function roomFor(session) {
    const subs = (session.subagents || []).length;
    const hasMeeting = workflowRunning(session) > 0;
    const zones = {
      door: { ...DOOR },
      deskChar: { ...DESK_CHAR },
      coffee: { ...COFFEE },
      sideSeats: SIDE_SEATS.map(p => ({ ...p })),
      meetingSeats: hasMeeting ? MEETING_SEATS.map(p => ({ ...p })) : [],
      subOverflow: Math.max(0, subs - MAX_SUBS),
    };

    const statics = [];
    for (let x = 0; x < ROOM_COLS; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < ROOM_ROWS; y++) {
      for (let x = 0; x < ROOM_COLS; x++) {
        const wood = x >= 1 && x <= 2 && y >= 5 && y <= 6;
        statics.push({ frame: wood ? 'floorWood' : 'floor', tx: x, ty: y });
      }
    }
    statics.push({ frame: 'door', tx: 8, ty: 0 });   // marqueur programmatique
    statics.push({ frame: 'poster', tx: 4, ty: 0 });
    statics.push({ frame: 'desk', tx: 2, ty: 3 });
    statics.push({ frame: 'deskSetup', tx: 2, ty: 3, screen: session.sessionId });
    statics.push({ frame: 'coffeeMachine', tx: 1, ty: 6 });
    statics.push({ frame: 'plant', tx: 8, ty: 6 });
    for (let i = 0; i < Math.min(subs, MAX_SUBS); i++) {
      statics.push({ frame: 'sideDesk', tx: SIDE_SEATS[i].tx, ty: SIDE_SEATS[i].ty + 1 });
    }
    if (hasMeeting) statics.push({ frame: 'meetingTable', tx: 5, ty: 5 });
    if (session.state && session.state.name === 'error') {
      statics.push({ frame: '_papers', tx: 4, ty: 4 });
      statics.push({ frame: '_papers', tx: 2, ty: 5 });
    }
    return { cols: ROOM_COLS, rows: ROOM_ROWS, statics, zones };
  }

  function pathTo(from, to) {
    const path = [];
    let { tx, ty } = from;
    while (tx !== to.tx) { tx += Math.sign(to.tx - tx); path.push({ tx, ty }); }
    while (ty !== to.ty) { ty += Math.sign(to.ty - ty); path.push({ tx, ty }); }
    return path;
  }

  function targetFor(activity, zones) {
    if (activity === 'coffee') return zones.coffee;
    if (activity === 'leave') return zones.door;
    return zones.deskChar;
  }

  function retarget(actor, target) {
    if (!target) return;
    const last = actor.path.length ? actor.path[actor.path.length - 1] : { tx: actor.tx, ty: actor.ty };
    if (last.tx === target.tx && last.ty === target.ty) return;
    actor.path = pathTo({ tx: actor.tx, ty: actor.ty }, target);
  }

  function syncSession(state, session) {
    const sid = session.sessionId;
    const zones = roomFor(session).zones;
    const activity = activityFor(session.state.name);

    let actor = state.actors.get(sid);
    if (!actor) {
      actor = { id: sid, sessionId: sid, kind: 'session',
                charIdx: charIndexFor(session.projectName), activity,
                tx: zones.door.tx, ty: zones.door.ty, path: [], dir: 'down',
                animFrame: 0, done: false };
      state.actors.set(sid, actor);
      retarget(actor, targetFor(activity, zones));
    } else if (actor.activity !== activity) {
      actor.activity = activity;
      actor.animFrame = 0;
      if (activity === 'down') actor.path = [];   // un perso en erreur ne marche pas
      else retarget(actor, targetFor(activity, zones));
    }

    // Subagents : max MAX_SUBS acteurs assis aux sièges latéraux.
    const wanted = new Set();
    (session.subagents || []).slice(0, MAX_SUBS).forEach((sub, i) => {
      const aid = `${sid}:sub:${sub.agentId}`;
      wanted.add(aid);
      if (!state.actors.has(aid)) {
        state.actors.set(aid, { id: aid, sessionId: sid, kind: 'subagent',
          charIdx: charIndexFor(sub.agentId), activity: 'work',
          tx: zones.sideSeats[i].tx, ty: zones.sideSeats[i].ty,
          path: [], dir: 'down', animFrame: 0, done: false });
      }
    });
    // Meeting : min(workflowRunning, 4) sitters.
    const nSeats = Math.min(workflowRunning(session), zones.meetingSeats.length || MEETING_SEATS.length);
    for (let i = 0; i < nSeats; i++) {
      const aid = `${sid}:wf:${i}`;
      wanted.add(aid);
      if (!state.actors.has(aid)) {
        const seat = MEETING_SEATS[i];
        state.actors.set(aid, { id: aid, sessionId: sid, kind: 'meeting',
          charIdx: (charIndexFor(sid) + i + 1) % 10, activity: 'work',
          tx: seat.tx, ty: seat.ty, path: [], dir: seat.ty === 5 ? 'down' : 'up',
          animFrame: 0, done: false });
      }
    }
    // Subs/meeting de cette session qui ne sont plus voulus → suppression.
    for (const [aid, a] of state.actors) {
      if (a.sessionId === sid && a.kind !== 'session' && !wanted.has(aid)) state.actors.delete(aid);
    }
  }

  // Sessions absentes de liveIds : le perso principal sort ; subs/meeting
  // disparaissent immédiatement. Les acteurs done sont supprimés par l'appelant.
  function purge(state, liveIds) {
    for (const [aid, a] of state.actors) {
      if (liveIds.has(a.sessionId)) continue;
      if (a.kind !== 'session') { state.actors.delete(aid); continue; }
      if (a.activity !== 'leave') {
        a.activity = 'leave';
        retarget(a, { tx: DOOR.tx, ty: DOOR.ty });
      }
    }
  }

  function actorsFor(state, sessionId) {
    return [...state.actors.values()]
      .filter(a => a.sessionId === sessionId)
      .sort((a, b) => a.ty - b.ty);
  }

  function tickActor(actor, zones) {
    const door = (zones && zones.door) || DOOR;
    if (actor.path.length === 0) {
      if (actor.activity === 'leave' && actor.tx === door.tx && actor.ty === door.ty) {
        actor.done = true;
      }
      return false;
    }
    actor._step = (actor._step || 0) + 1;
    if (actor._step % 2) return false;
    const next = actor.path.shift();
    actor.dir = next.tx > actor.tx ? 'right' : next.tx < actor.tx ? 'left' : next.ty > actor.ty ? 'down' : 'up';
    actor.tx = next.tx; actor.ty = next.ty;
    return true;
  }

  function animFor(actor) {
    const c = `char${actor.charIdx}`;
    if (actor.path.length > 0) return `${c}.walk.${actor.dir}`;
    switch (actor.activity) {
      case 'call': return `${c}.phone.right`;
      case 'down': return `${c}.hurt`;
      case 'coffee': return `${c}.idle.left`;  // machine à gauche du point café
      default: return `${c}.idle.down`;
    }
  }

  return { createState, roomFor, syncSession, purge, actorsFor, tickActor,
           animFor, activityFor, charIndexFor, pathTo, workflowRunning,
           ROOM_COLS, ROOM_ROWS };
});
```

- [ ] **Step 4: Run — vérifier que tout passe**

Run: `node test/office-layout.test.js`
Expected: PASS — `24 passed, 0 failed`. Un échec = corriger l'implémentation, pas le test (les invariants viennent de la spec).

Note : `npm test` complet est ATTENDU ROUGE à ce stade si quelque chose d'autre importait l'ancienne API — vérifier avec `grep -rn "OfficeLayout\." ui/ --include="*.js" | grep -v office-layout` que seul `ui/office.js` la consomme (il est réécrit en Task 2). Ne lancer que la suite office-layout ici.

- [ ] **Step 5: Commit**

```bash
git add ui/office-layout.js test/office-layout.test.js
git commit -m "feat(office): layout v2 — une pièce par session (pièces-cartes)"
```

---

### Task 2: `ui/office.js` v2 multi-canvas + intégration au flux des vues

**Files:**
- Rewrite: `ui/office.js`
- Modify: `ui/renderer.js` (lignes actuelles : 677-684 render, 737-741 updateSession, 813-817 removeSessionFromDOM, + `viewContainer()`/`viewItemHTML()` vers ~697-707)
- Modify: `ui/index.html` (retrait du canvas unique)
- Modify: `ui/styles.css`

**Interfaces:**
- Consumes: API `OfficeLayout` v2 de Task 1 (signatures exactes du bloc Interfaces de Task 1) ; globals de renderer.js à l'exécution : `sessions`, `getSortedSessions`, `getRenderableSessions`, `handleCardClick`, `handleFocus`, `getStateLabel`, `formatDuration`, `formatModel`, `esc`, `escAttr`, `t`, `startInlineRename`, `toggleNotif`, `onDragStart/onDragOver/onDrop/onDragEnd`, `render`, `updateStatusBar`, `ICONS`.
- Produces: global `Office` avec `probe()`, `cardHTML(s)` (fonction de rendu d'item pour `viewItemHTML`), `onDomRendered()` (sync + draw + démarre le timer — appelé par render/updateSession en mode office), `deactivate()`, `notifyRemoved(sessionId)`, `isAvailable()`.

- [ ] **Step 1: Réécrire `ui/office.js`**

```js
// ui/office.js — moteur de rendu de la vue office v2 : une mini-pièce par
// session, un canvas par carte, UN SEUL timer 8 fps pour toutes les vignettes.
// Chargé APRÈS office-layout.js, AVANT renderer.js (les globals de renderer
// ne sont touchés qu'à l'exécution). Vue inactive = timer stoppé (zéro coût).
const Office = (() => {
  const TICK_MS = 125;
  const SCALE_MIN = 1, SCALE_MAX = 4;
  const TINT_ALPHA = 0.12;
  const STATE_COLORS = { thinking: '#a78bfa', running: '#3b82f6', waiting: '#22c55e', pending: '#f59e0b', error: '#ef4444' };

  let atlas = null, manifest = null;
  let available = null;
  let probePromise = null;
  let state = null;          // OfficeLayout.createState()
  let timer = null;
  let tickCount = 0;
  let tooltip = null;

  function probe() {
    if (available !== null) return Promise.resolve(available);
    if (probePromise) return probePromise;
    probePromise = (async () => {
      try {
        const res = await fetch('office-assets/atlas.json');
        if (!res.ok) throw new Error(res.status);
        manifest = await res.json();
        atlas = new Image();
        await new Promise((ok, ko) => { atlas.onload = ok; atlas.onerror = ko; atlas.src = 'office-assets/atlas.png'; });
        available = true;
      } catch (e) {
        console.warn('[office] atlas indisponible:', e.message || e);
        available = false;
      }
      return available;
    })();
    return probePromise;
  }

  // ─── Carte-vignette (item de vue, appelé par viewItemHTML de renderer.js) ───
  function cardHTML(s) {
    const sid = escAttr(s.sessionId);
    const stateName = s.state.name;
    return `
      <div class="office-card${s.isBackground ? ' bg-session' : ''}" data-state="${stateName}" data-session="${sid}"
           draggable="${!searchQuery}"
           ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)"
           onclick="handleCardClick(event, '${sid}')">
        <canvas class="office-canvas" data-room="${sid}"></canvas>
        <div class="office-card-footer">
          <div class="office-card-name editable-name" onclick="event.stopPropagation(); startInlineRename(event, '${sid}')" title="${t('action_rename_hint')}">
            <span class="project-name-text">${esc(s.customName || s.projectName)}</span>
            <span class="edit-hint">${ICONS.edit}</span>
          </div>
          <button class="card-btn notif-btn ${s.notifEnabled ? 'notif-on' : ''}" onclick="event.stopPropagation(); toggleNotif(event, '${sid}')" title="${t('action_notifications')}">
            ${s.notifEnabled ? ICONS.bell : ICONS.bellOff}
          </button>
        </div>
      </div>
    `;
  }

  // ─── Rendu d'une pièce dans son canvas ───
  function drawFrameOn(c2d, name, px, py, scale) {
    const f = manifest.frames[name];
    if (!f) return;
    c2d.drawImage(atlas, f.x, f.y, f.w, f.h, px, py - (f.h - 16) * scale, f.w * scale, f.h * scale);
  }

  function animFrameName(animName, frameIdx) {
    const a = manifest.anims[animName];
    if (!a) return null;
    return a.loop ? a.frames[frameIdx % a.frames.length]
                  : a.frames[Math.min(frameIdx, a.frames.length - 1)];
  }

  function drawRoom(canvas, s) {
    const room = OfficeLayout.roomFor(s);
    const cardW = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth;
    const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.floor(cardW / (room.cols * 16)) || SCALE_MIN));
    const w = room.cols * 16 * scale, h = room.rows * 16 * scale;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c2d = canvas.getContext('2d');
    c2d.imageSmoothingEnabled = false;
    c2d.clearRect(0, 0, w, h);

    const stateName = s.state.name;
    for (const st of room.statics) {
      const px = st.tx * 16 * scale, py = st.ty * 16 * scale;
      if (st.frame === 'coffeeMachine') {
        drawFrameOn(c2d, animFrameName('coffee', tickCount >> 1), px, py, scale);
        continue;
      }
      if (st.frame === 'door') { c2d.fillStyle = '#1a1a22'; c2d.fillRect(px, py, 16 * scale, 16 * scale); continue; }
      if (st.frame === '_papers') {
        c2d.fillStyle = '#d8d3c3';
        c2d.fillRect(px + 3 * scale, py + 6 * scale, 5 * scale, 3 * scale);
        c2d.fillRect(px + 9 * scale, py + 10 * scale, 4 * scale, 3 * scale);
        continue;
      }
      drawFrameOn(c2d, st.frame, px, py, scale);
      if (st.screen) {
        const color = STATE_COLORS[stateName];
        if (color && stateName !== 'waiting') {
          c2d.fillStyle = color;
          c2d.globalAlpha = (stateName === 'running' && (tickCount & 4)) ? 0.4 : 0.9;
          c2d.fillRect((st.tx * 16 + 3) * scale, (st.ty * 16 - 6) * scale, 6 * scale, 4 * scale);
          c2d.globalAlpha = 1;
        }
      }
    }

    for (const a of OfficeLayout.actorsFor(state, s.sessionId)) {
      const fi = a.activity === 'think' ? (a.animFrame >> 2) : a.animFrame;
      const fname = animFrameName(OfficeLayout.animFor(a), fi);
      const px = a.tx * 16 * scale, py = a.ty * 16 * scale;
      if (fname) drawFrameOn(c2d, fname, px, py, scale);
      if (a.kind === 'session') {
        if (stateName === 'thinking') pixelTextOn(c2d, '…', px + 4 * scale, py - 20 * scale, STATE_COLORS.thinking, scale);
        if (stateName === 'pending') pixelTextOn(c2d, '!', px + 6 * scale, py - 20 * scale, STATE_COLORS.pending, scale);
      }
    }
    if (room.zones.subOverflow > 0) {
      pixelTextOn(c2d, `+${room.zones.subOverflow}`, 7.5 * 16 * scale, 4 * 16 * scale, '#9ca3af', scale);
    }

    // Teinte d'éclairage : l'état en vision périphérique.
    if (s.isBackground) {
      c2d.fillStyle = '#000';
      c2d.globalAlpha = 0.35;
      c2d.fillRect(0, 0, w, h);
      c2d.globalAlpha = 1;
    } else {
      const color = STATE_COLORS[stateName];
      if (color) {
        c2d.fillStyle = color;
        c2d.globalAlpha = TINT_ALPHA;
        c2d.fillRect(0, 0, w, h);
        c2d.globalAlpha = 1;
      }
    }
  }

  function pixelTextOn(c2d, txt, x, y, color, scale) {
    c2d.font = `${7 * scale}px monospace`;
    c2d.fillStyle = color;
    c2d.fillText(txt, x, y);
  }

  function container() { return document.getElementById('officeView'); }

  function drawAll() {
    const cont = container();
    if (!cont) return;
    for (const canvas of cont.querySelectorAll('canvas[data-room]')) {
      const s = sessions.get(canvas.dataset.room);
      if (s) drawRoom(canvas, s);
    }
  }

  // ─── Sync + boucle ───
  function syncAll() {
    if (!state) state = OfficeLayout.createState();
    const live = getSortedSessions();
    for (const s of live) OfficeLayout.syncSession(state, s);
    OfficeLayout.purge(state, new Set(live.map(s => s.sessionId)));
  }

  function tick() {
    tickCount++;
    const doneSids = [];
    for (const a of state.actors.values()) {
      a.animFrame++;
      // zones : la géométrie est fixe, la porte est la même pour toutes les pièces
      OfficeLayout.tickActor(a, null);
      if (a.done) { state.actors.delete(a.id); doneSids.push(a.sessionId); }
    }
    // Acteur sorti → sa carte (session déjà purgée) se retire du DOM.
    for (const sid of doneSids) {
      const el = container().querySelector(`[data-session="${sid}"]`);
      if (el && !sessions.has(sid)) el.remove();
    }
    if (sessions.size === 0 && state.actors.size === 0) { render(); return; }
    drawAll();
  }

  // ─── Hooks appelés par renderer.js ───
  // Après un fullRender / patch de carte en mode office : sync, redraw
  // immédiat (pas de canvas blanc pendant 125 ms), timer garanti.
  function onDomRendered() {
    if (available !== true) return;
    syncAll();
    drawAll();
    wireTooltip();
    if (!timer) timer = setInterval(tick, TICK_MS);
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
    if (tooltip) tooltip.style.display = 'none';
  }

  // Session purgée : l'acteur sort par la porte, la carte reste le temps
  // de la marche (retirée par tick() quand l'acteur est done).
  function notifyRemoved(sessionId) {
    if (!state) return;
    syncAll();
    void sessionId; // la purge se fait sur l'ensemble — l'id est déjà absent de sessions
  }

  function wireTooltip() {
    const cont = container();
    if (!cont || cont._tipWired) return;
    cont._tipWired = true;
    tooltip = document.getElementById('officeTooltip');
    cont.addEventListener('mousemove', (ev) => {
      const card = ev.target.closest && ev.target.closest('.office-card');
      if (!card) { tooltip.style.display = 'none'; return; }
      const s = sessions.get(card.dataset.session);
      if (!s) return;
      tooltip.innerHTML = `
        <div class="office-tip-name">${esc(s.customName || s.projectName)}</div>
        <div class="office-tip-row">${esc(getStateLabel(s))} · ${esc(s.gitBranch || '—')}</div>
        <div class="office-tip-row">${esc(formatModel(s.model))} · ${formatDuration(s.startedAt)}</div>`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(ev.clientX + 12, window.innerWidth - 220)}px`;
      tooltip.style.top = `${Math.min(ev.clientY + 12, window.innerHeight - 80)}px`;
    });
    cont.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  }

  return { probe, cardHTML, onDomRendered, deactivate, notifyRemoved, isAvailable: () => available === true };
})();
```

- [ ] **Step 2: `ui/renderer.js` — office dans le flux normal**

1. `viewContainer()` (~ligne 697) devient :
```js
function viewContainer() {
  if (viewMode === 'grid') return $gridView;
  if (viewMode === 'compact') return $compactView;
  if (viewMode === 'office') return document.getElementById('officeView');
  return $microView;
}
```
2. `viewItemHTML()` (juste en dessous) devient :
```js
function viewItemHTML() {
  if (viewMode === 'grid') return cardHTML;
  if (viewMode === 'compact') return compactItemHTML;
  if (viewMode === 'office') return Office.cardHTML;
  return microItemHTML;
}
```
3. Dans `render()` (lignes 677-684 actuelles), remplacer le bloc office par :
```js
  const showOffice = showItems && viewMode === 'office';
  const $officeView = document.getElementById('officeView');
  $officeView.style.display = showOffice ? 'grid' : 'none';
  if (viewMode === 'office' && !showOffice) Office.deactivate();
```
(plus de early-return : `fullRender()` construit les cartes office comme les autres) — puis, à la FIN de `render()` juste avant `updateStatusBar()` :
```js
  if (showOffice) Office.onDomRendered();
```
4. Dans `updateSession()` (lignes 737-741 actuelles) : **SUPPRIMER entièrement le bloc early-return office** — le flux générique (patch `replaceWith` + bell/toast handoff) s'applique tel quel aux cartes office. Puis ajouter en fin de fonction, juste avant le `updateStatusBar()` final :
```js
  if (viewMode === 'office') Office.onDomRendered();
```
Vérification nommée : `applyBellVisual` doit tolérer une carte office (sélecteurs d'indicateurs absents → no-op sans crash). Lire la fonction ; si elle suppose un élément non-nul, garder ses accès derrière des null-checks.
5. Dans `removeSessionFromDOM()` (lignes 813-817 actuelles), remplacer le bloc office par :
```js
  if (viewMode === 'office') {
    clearBell(sessionId);
    Office.notifyRemoved(sessionId);   // l'acteur sort, tick() retirera la carte
    updateStatusBar();
    return;
  }
```

- [ ] **Step 3: `ui/index.html` — retirer le canvas unique**

Remplacer :
```html
    <div class="office-view" id="officeView" style="display:none;">
      <canvas id="officeCanvas"></canvas>
    </div>
```
par :
```html
    <div class="office-view" id="officeView" style="display:none;"></div>
```
(`#officeTooltip` et l'ordre des scripts ne changent pas)

- [ ] **Step 4: `ui/styles.css` — grille de vignettes**

Remplacer le bloc `/* ═══ Office view ═══ */` existant par :
```css
/* ═══ Office view (v2 : pièces-cartes) ═══ */
.office-view {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  padding: 12px;
  align-content: start;
}
.office-card {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  cursor: pointer;
}
.office-card canvas {
  image-rendering: pixelated;
  width: 100%;
  display: block;
}
.office-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  min-width: 0;
}
.office-card-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.office-card.bg-session { opacity: 0.75; cursor: default; }
.office-tooltip {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11px;
  max-width: 210px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.office-tip-name { font-weight: 600; margin-bottom: 3px; }
.office-tip-row { color: var(--text-secondary); }
```
(vérifier `--bg-tertiary`/`--border`/`--text-secondary` contre les variables réellement définies — ce sont celles utilisées par la v1 après review)

- [ ] **Step 5: Suite complète**

Run: `npm test`
Expected: 13 suites vertes (office-layout v2 inclus).

- [ ] **Step 6: Vérification CDP**

Flow habituel (kill Electron d'abord — `feedback_dev_relaunch` ; CDP + sessions forgées — `reference_cdp_verification`). Points à vérifier avec screenshots REGARDÉS :
1. Vue office = grille de vignettes qui wrappe ; chaque vignette montre sa pièce (bureau, écran coloré, café animé) + nom dessous.
2. Fenêtre étroite (~400 px) : 1-2 colonnes, pièces zoomées, lisibles — LE cas qui motivait le pivot. Puis redimensionner la fenêtre en direct (étroite → large) : les vignettes re-wrappent et les canvases se rescalent (≤125 ms, via le redraw du tick), sans étirement flou.
3. Session waiting → le perso va au coin café de SA pièce ; teinte verte sombre.
4. Session error forgée → teinte rouge + papiers au sol + perso affalé.
5. Clic vignette → focus terminal (spy handleFocus, bon sessionId) ; hover → tooltip ; vignette background : pas de focus, voile sombre.
6. Purge d'une session forgée → perso sort par la porte, la vignette disparaît ensuite ; dernière session partie → empty state, timer coupé.
7. Retour vue grid → cartes normales intactes (pas de régression), timer office coupé.

Nettoyer les sessions forgées, killer le dev, relancer l'app **depuis le repo** (`npm start`, PAS l'app de /Applications).

- [ ] **Step 7: Commit**

```bash
git add ui/office.js ui/renderer.js ui/index.html ui/styles.css
git commit -m "feat(office): v2 pièces-cartes — une mini-pièce par session, multi-canvas"
```

---

### Task 3: Documentation + clôture des dettes réglées

**Files:**
- Modify: `CLAUDE.md` (bullet vue office dans « Key decisions »)

**Interfaces:**
- Consumes: rien. Produces: rien (docs).

- [ ] **Step 1: Mettre à jour CLAUDE.md**

Dans la section « Key decisions », remplacer le contenu du bullet commençant par « Vue office » s'il existe, sinon ajouter à la fin :
```markdown
- Vue office (v2) : une mini-pièce pixel-art LimeZu **par session** (pièces-cartes, 10×8 tiles, zoom entier [1..4] par carte) — pas d'open-space global. La pièce raconte l'état : perso animé + props (écran, café, papiers) + teinte 12 % couleur d'état. Un canvas par carte, UN timer 8 fps commun, coupé vue inactive. Assets jamais commités (licence LimeZu, repo public) : `npm run bake` régénère `ui/office-assets/` (gitignoré) — À FAIRE AVANT tout build DMG. Intégré au flux normal des vues (viewItemHTML → `Office.cardHTML`) ; purge = le perso sort par la porte puis la carte se retire.
```

- [ ] **Step 2: Vérification finale**

Run: `npm test` → tout vert. `git status --short` → aucun fichier `ui/office-assets/*`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(office): v2 pièces-cartes dans les key decisions"
```

---

## Hors plan (rappels)

- Pas de release ici (flow « mettre en prod » séparé, avec bake avant build — cf. mémoire `release_process`).
- Dettes v1 réglées par le pivot, à retirer du suivi : empilement au point café partagé ; slots réassignés sous filtre de recherche.
- Dette conservée : tooltip figé pendant un survol continu (le contenu ne se rafraîchit qu'au changement de carte survolée).
