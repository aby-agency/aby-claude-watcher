// test/office-layout.test.js — Run: node test/office-layout.test.js
// v4 : UNE salle « open-space », zonée en quadrants (lounge/agents/deep-
// research/headless) reliés par un couloir central. Remplace les 3 salles
// v3. Voir docs/superpowers/specs/2026-07-19-office-open-space-design.md
// (fait foi) et le plan associé (Task 2). Transpose les invariants v2/v3 qui
// survivent (activité, émotes+priorités, règle cloche, étiquettes, slots
// stables, dimensionnement jamais sous les occupants réels — familles
// C1/C2/C3 — purge/résurrection/flip isBackground) + nouveaux invariants v4
// (zones/quadrants, adjacence subagents, couloir central, marche visible
// lounge↔poste sans téléport).
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
function snap(interactive, background) { return { interactive: interactive || [], background: background || [] }; }
function many(prefix, n, state, extraFn) {
  return Array.from({ length: n }, (_, i) => sess(`${prefix}${i}`, state, extraFn ? extraFn(i) : undefined));
}

// Meubles COLLIDABLES (largeur en tuiles, dérivée des bbox atlas Task 1) —
// tout le reste (wall/floor/door/chairOrange/chairBlack/sideSetup90 [même
// tuile que sideDesk90]/laptop) est walkable, cf. tête de module.
const COLLISION_WIDTH = {
  stationConsole: 1, // single 130 (16×14, 1 tuile) depuis 2026-07-21 — le 227 (32px) couvrait 2 tuiles
  desk: 1,           // surface du poste (single 262, 16×16, 1 tuile), sous l'écran depuis 2026-07-21
  sofaCornerA: 2, sofaCornerB: 2, sofaCornerC: 1, sofaCornerD: 1,
  coffeeTable: 2, sideDesk90: 1, tv: 2, plant: 1,
};
function furnitureTiles(statics) {
  const set = new Set();
  for (const st of statics) {
    const w = COLLISION_WIDTH[st.frame];
    if (!w) continue;
    for (let i = 0; i < w; i++) set.add(`${st.tx + i},${st.ty}`);
  }
  return set;
}
// La DERNIÈRE tuile du chemin est la destination (poste/siège) : pour les 3
// sièges canapé du lounge, elle coïncide DÉLIBÉRÉMENT avec un fragment de
// canapé (s'asseoir SUR le canapé, transposé de la convention `chairOver` v3
// où le siège n'était jamais dans la liste des meubles bloquants) — ce n'est
// pas une « traversée », c'est l'arrivée. Seules les tuiles de TRANSIT sont
// vérifiées.
function assertPathClear(path, statics, label) {
  const blocked = furnitureTiles(statics);
  const transit = path.slice(0, -1);
  for (const p of transit) assert(!blocked.has(`${p.tx},${p.ty}`), `${label} : (${p.tx},${p.ty}) traverse un meuble`);
}
function walkToRest(a, state) { for (let i = 0; i < 400 && a.path.length > 0; i++) OL.tickActor(a, state); }
function fullyExit(sessionId, st) {
  const a = st.actors.get(sessionId);
  for (let i = 0; i < 400 && !a.done; i++) OL.tickActor(a, st);
  assert(a.done, `${sessionId} jamais done`);
  st.actors.delete(sessionId);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\ncharIndexFor / activityFor / zoneForState:');
test('charIndexFor stable et borné [0,9]', () => {
  assertEq(OL.charIndexFor('aby-claude-watcher'), OL.charIndexFor('aby-claude-watcher'));
  for (const n of ['a', 'x/y', '']) { const i = OL.charIndexFor(n); assert(i >= 0 && i <= 9); }
});
test('mapping des activités : waiting → relax (quitte le poste pour le lounge)', () => {
  assertEq(OL.activityFor('thinking'), 'think');
  assertEq(OL.activityFor('running'), 'work');
  assertEq(OL.activityFor('waiting'), 'relax');
  assertEq(OL.activityFor('pending'), 'call');
  assertEq(OL.activityFor('error'), 'down');
});
test('zoneForState : agents = thinking/running/pending/error, lounge = waiting (sans cloche)', () => {
  assertEq(OL.zoneForState('thinking'), 'agents');
  assertEq(OL.zoneForState('running'), 'agents');
  assertEq(OL.zoneForState('pending'), 'agents');
  assertEq(OL.zoneForState('error'), 'agents');
  assertEq(OL.zoneForState('waiting', false), 'lounge');
  assertEq(OL.zoneForState('waiting', true), 'agents'); // cloche active → reste au poste
  assertEq(OL.zoneForState(undefined), 'agents'); // défaut
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nworkflowRunning (dédup runId, inchangé):');
test('somme des running, dédup par runId', () => {
  const wf = { runId: 'dup', name: 'r', running: 3 };
  const s = sess('a', 'running', { workflows: [wf, { runId: 'dup', name: 'r', running: 3 }, { runId: 'w2', name: 'x', running: 2 }] });
  assertEq(OL.workflowRunning(s), 5);
});
test('workflows terminés (running 0) ignorés', () => {
  assertEq(OL.workflowRunning(sess('a', 'running', { workflows: [{ runId: 'w', running: 0 }] })), 0);
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nroomFor : forme, salle unique, zones fixes:');
test('forme de base : cols=16, 4 zones nommées, chacune {counter, overflow:{total}, box}', () => {
  const room = OL.roomFor(snap([]));
  assertEq(room.cols, 16);
  assert(Array.isArray(room.statics));
  assert(typeof room.rows === 'number');
  for (const key of ['lounge', 'agents', 'dr', 'headless']) {
    const z = room.zones[key];
    assert(z, `zone ${key} absente`);
    assertEq(typeof z.counter, 'number');
    assertEq(typeof z.overflow.total, 'number');
    assert(z.box && typeof z.box.tx === 'number' && typeof z.box.ty === 'number' && typeof z.box.cols === 'number' && typeof z.box.rows === 'number');
  }
});
test('roomFor sans state (2e paramètre omis) reste une fonction pure du snapshot', () => {
  const room = OL.roomFor(snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]));
  assertEq(room.zones.agents.counter, 3);
  assertEq(room.zones.agents.box.rows, 2); // 3 sessions = 1 groupe plein → rows = 1*3-1 = 2
});
test('salle vide : décor des boîtes FIXES visible (jamais 0 mobilier lounge/dr, quel que soit l\'occupant)', () => {
  const room = OL.roomFor(snap([]));
  assert(room.statics.some(s => s.frame === 'sofaCornerB'), 'pas de canapé lounge');
  assert(room.statics.some(s => s.frame === 'coffeeTable'), 'pas de table basse');
  assert(room.statics.some(s => s.frame === 'sideDesk90'), 'pas de poste deep-research décor');
  assert(room.statics.some(s => s.frame === 'tv'), 'pas de TV');
  assert(room.statics.some(s => s.frame === 'door'), 'pas de porte');
});
// Fix F1 (revue Task 3) : agents/headless sont des zones DYNAMIQUES
// (« slots créés en fonction du besoin ») — contrairement au lounge/dr
// (boîtes fixes ci-dessus), leur mobilier ne doit JAMAIS apparaître sans
// occupant réel. Avant le fix, `headlessGroups(0)`/`agentsGroups(0)`
// planchaient à 1 groupe plein (3 consoles + 3 fauteuils) même à 0 session.
test('salle sans agents/headless : AUCUN poste/fauteuil orange ou noir (sol nu, pas de mobilier orphelin)', () => {
  const room = OL.roomFor(snap([]));
  assert(!room.statics.some(s => s.frame === 'stationConsole'), 'un poste décor est apparu sans occupant');
  assert(!room.statics.some(s => s.frame === 'chairOrange'), 'un fauteuil orange est apparu sans occupant');
  assert(!room.statics.some(s => s.frame === 'chairBlack'), 'un fauteuil noir est apparu sans occupant');
});
test('agents : le mobilier suit exactement les slots tenus (pas d\'arrondi par groupe de 3)', () => {
  const room = OL.roomFor(snap([sess('a', 'running')]));
  const consoles = room.statics.filter(s => s.frame === 'stationConsole');
  const chairs = room.statics.filter(s => s.frame === 'chairOrange');
  assertEq(consoles.length, 1, '1 session → 1 seul poste meublé, pas le groupe de 3 entier');
  assertEq(chairs.length, 1);
  assertEq(consoles[0].tx, 0); assertEq(chairs[0].tx, 0);
});
test('C2 (mobilier) : fragmentation — seul le slot le plus haut encore tenu reste meublé, pas ses voisins vides', () => {
  const st = OL.createState();
  const five = many('r', 5, 'running');
  OL.syncActors(st, snap(five));
  for (const s of five) walkToRest(st.actors.get(s.sessionId), st);
  OL.syncActors(st, snap([sess('r4', 'running')]));
  for (const s of five) if (s.sessionId !== 'r4') fullyExit(s.sessionId, st);
  assertEq(st.slots.agents.size, 1); // fragmentation confirmée
  const room = OL.roomFor(snap([sess('r4', 'running')]), st);
  const consoles = room.statics.filter(s => s.frame === 'stationConsole');
  // r4 tient le slot 4 (groupe1, within1, c=2) : SEUL ce poste est meublé,
  // même si le dimensionnement (rows=5, cf. test C2 existant) réserve la
  // place pour 2 groupes entiers.
  assertEq(consoles.length, 1, 'des postes vides sont restés meublés après le départ des voisins');
  assertEq(consoles[0].tx, 2);
  assertEq(room.zones.agents.box.rows, 5, 'le dimensionnement (C2) ne doit pas changer');
});
test('le mur (rangée 0) et le sol couvrent les dimensions effectives', () => {
  const room = OL.roomFor(snap([sess('a', 'running'), sess('b', 'waiting')]));
  assertEq(room.statics.filter(s => s.frame === 'wall').length, room.cols);
  assertEq(room.statics.filter(s => s.frame === 'floor').length, room.cols * (room.rows - 1));
});
test('couloir central (colonnes 6-9) toujours libre de tout mobilier, à toute hauteur', () => {
  const rooms = [
    OL.roomFor(snap([])),
    OL.roomFor(snap(many('a', 12, 'running'))),
    OL.roomFor(snap(many('w', 10, 'waiting'))),
    OL.roomFor(snap([], many('h', 8, 'running'))),
  ];
  for (const room of rooms) {
    for (const st of room.statics) {
      if (st.frame === 'wall' || st.frame === 'floor' || st.frame === 'door') continue; // porte = accès au couloir, attendu
      assert(st.tx < 6 || st.tx > 9, `${st.frame} en (${st.tx},${st.ty}) empiète sur le couloir central`);
    }
  }
});
test('boîtes fixes : lounge (rows1-4) et deep-research (rows1-4) ne redimensionnent JAMAIS, quel que soit le nombre de sessions', () => {
  for (const n of [0, 1, 5, 20]) {
    const room = OL.roomFor(snap(many('w', n, 'waiting')));
    assertEq(room.zones.lounge.box.rows, 4);
    assertEq(room.zones.dr.box.rows, 4);
  }
});
// Fix écrasement (2026-07-21, constaté au CDP en conditions réelles) : les
// étiquettes pixel des debout du lounge (row 4) se dessinent une rangée SOUS
// eux — pile sur la première rangée de consoles agents quand AGENTS_TOP
// collait la boîte lounge (perso assis + console ensevelis, illisible). Même
// géométrie côté droit (debout dr row 4 / consoles headless). Le mockup v4
// montre du sol libre entre les quadrants haut et bas : la rangée juste sous
// les boîtes fixes doit rester SANS mobilier, des deux côtés.
test('respiration : aucun mobilier sur la rangée juste sous les boîtes fixes (lounge/dr)', () => {
  const breather = OL.LOUNGE_TOP + OL.LOUNGE_ROWS; // première rangée après les boîtes fixes
  assert(OL.AGENTS_TOP > breather, 'AGENTS_TOP doit laisser une rangée de respiration sous le lounge');
  assert(OL.HEADLESS_TOP > breather, 'HEADLESS_TOP doit laisser une rangée de respiration sous deep-research');
  const rooms = [
    OL.roomFor(snap([...many('w', 8, 'waiting'), ...many('a', 3, 'running')], many('h', 6, 'running'))),
    OL.roomFor(snap(many('a', 12, 'running'))),
  ];
  for (const room of rooms) {
    for (const st of room.statics) {
      if (st.frame === 'wall' || st.frame === 'floor' || st.frame === 'door') continue;
      assert(st.ty !== breather, `${st.frame} en (${st.tx},${st.ty}) colle la boîte fixe (rangée de respiration)`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nagents : croissance par rangées de 3 postes (aucun cap):');
test('rows grandit par groupes de 3 postes occupés (min 1 groupe, jamais 0)', () => {
  const rows = n => OL.roomFor(snap(many('a', n, 'running'))).zones.agents.box.rows;
  assertEq(rows(0), 2); assertEq(rows(1), 2); assertEq(rows(3), 2);
  assertEq(rows(4), 5); assertEq(rows(6), 5);
  assertEq(rows(7), 8); assertEq(rows(20), 20); // groups(20)=7 → 7*3-1=20
});
test('agents : pas de cap, overflow.total ne compte QUE les subagents en trop (jamais les sessions)', () => {
  const room = OL.roomFor(snap(many('a', 50, 'running')));
  assertEq(room.zones.agents.counter, 50);
  assertEq(room.zones.agents.overflow.total, 0);
});

console.log('\nheadless : croissance par rangées de 3, cap 6 + overflow:');
test('rows grandit avec le compte, jusqu\'au cap (6 → 2 groupes → rows 5), overflow au-delà', () => {
  const rows = n => OL.roomFor(snap([], many('h', n, 'running'))).zones.headless.box.rows;
  assertEq(rows(0), 2); assertEq(rows(3), 2);
  assertEq(rows(4), 5); assertEq(rows(6), 5);
  assertEq(rows(9), 5); // cap atteint, ne grandit plus
  const room = OL.roomFor(snap([], many('h', 9, 'running')));
  assertEq(room.zones.headless.overflow.total, 3);
  assertEq(room.zones.headless.counter, 9); // counter = compte logique réel, pas le compte rendu
});

console.log('\ndeep-research : boîte fixe, cap 8 + overflow (dédup runId):');
test('overflow au-delà de 8 agents de workflow, dédup par runId', () => {
  const room = OL.roomFor(snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 11 }] })]));
  assertEq(room.zones.dr.counter, 11);
  assertEq(room.zones.dr.overflow.total, 3);
  assertEq(room.zones.dr.box.rows, 4); // boîte fixe même en overflow
});
// Fix reviewer final (fragmentation dr, même famille que le test C2-mobilier
// agents ci-dessus) : session A (workflow running:3, slots 0-2) + session B
// (workflow running:3, slots 3-5) → A se termine → B garde les slots 3-5.
// Le mobilier doit suivre ces indices RÉELLEMENT tenus, pas un remplissage
// [0..2] (qui meublerait des postes vides tout en laissant les acteurs de B
// sans bureau, cf. repro reviewer).
test('dr : fragmentation — le mobilier suit les slots réellement tenus, pas 0..n-1', () => {
  const st = OL.createState();
  const a = sess('a', 'running', { workflows: [{ runId: 'wa', running: 3 }] });
  const b = sess('b', 'running', { workflows: [{ runId: 'wb', running: 3 }] });
  OL.syncActors(st, snap([a, b]));
  const aDone = sess('a', 'running', { workflows: [{ runId: 'wa', running: 0 }] });
  OL.syncActors(st, snap([aDone, b])); // a se termine → libère les slots 0,1,2
  const heldIdxs = [...st.slots.dr.values()].map(v => v.idx).sort((x, y) => x - y);
  assertEq(heldIdxs.join(','), '3,4,5', 'fragmentation confirmée : b tient les slots hauts');
  const room = OL.roomFor(snap([aDone, b]), st);
  const desks = room.statics.filter(s => s.frame === 'sideDesk90');
  assertEq(desks.length, 3, 'des bureaux vides sont restés meublés après le départ de a');
  const positions = desks.map(d => `${d.tx},${d.ty}`).sort();
  // idx 3→(13,2) idx 4→(10,3) idx 5→(13,3), desk = tx+1 (cf. buildDR)
  assertEq(positions.join(' | '), '11,3 | 14,2 | 14,3');
});

console.log('\nlounge : boîte fixe, cap 8 + overflow:');
test('overflow au-delà de 8 sessions waiting', () => {
  const room = OL.roomFor(snap(many('w', 11, 'waiting')));
  assertEq(room.zones.lounge.counter, 11);
  assertEq(room.zones.lounge.overflow.total, 3);
  assertEq(room.zones.lounge.box.rows, 4);
});
test('le compteur logique compte le waiting-à-cloche EN AGENTS, pas en lounge', () => {
  const room = OL.roomFor(snap([Object.assign(sess('a', 'waiting'), { bellActive: true }), sess('b', 'waiting')]));
  assertEq(room.zones.agents.counter, 1);
  assertEq(room.zones.lounge.counter, 1);
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nsyncActors : spawn, slots stables, non-traversée générique:');
test('nouvelle session running → acteur en zone agents, spawn (7,1), poste (0,7)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  assert(a, 'pas d\'acteur');
  assertEq(a.zone, 'agents');
  assertEq(a.tx, 7); assertEq(a.ty, 1); // spawn
  const dest = a.path[a.path.length - 1];
  assertEq(dest.tx, 0); assertEq(dest.ty, 7);
});
test('nouvelle session waiting (sans cloche) → acteur en zone lounge', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  assertEq(st.actors.get('a').zone, 'lounge');
});
test('spawn/leave ne traversent jamais un meuble (agents)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  const room1 = OL.roomFor(snap([sess('a', 'running')]), st);
  assertPathClear(a.path, room1.statics, 'spawn agents');
  walkToRest(a, st);
  OL.syncActors(st, snap([]));
  const room2 = OL.roomFor(snap([]), st);
  assertPathClear(a.path, room2.statics, 'leave agents');
});
test('spawn/leave ne traversent jamais un meuble (lounge, canapé+table)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  const a = st.actors.get('a');
  const room1 = OL.roomFor(snap([sess('a', 'waiting')]), st);
  assertPathClear(a.path, room1.statics, 'spawn lounge');
  walkToRest(a, st);
  OL.syncActors(st, snap([]));
  const room2 = OL.roomFor(snap([]), st);
  assertPathClear(a.path, room2.statics, 'leave lounge');
});
test('3 postes agents occupés → slots stables (0,2,4 en colonne), inchangés au resync', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]));
  for (const id of ['a', 'b', 'c']) walkToRest(st.actors.get(id), st);
  const txs = ['a', 'b', 'c'].map(id => st.actors.get(id).tx).sort((x, y) => x - y);
  assertEq(JSON.stringify(txs), JSON.stringify([0, 2, 4]));
  OL.syncActors(st, snap([sess('a', 'thinking'), sess('b', 'running'), sess('c', 'running')]));
  assertEq(st.actors.get('a').tx, 0); assertEq(st.actors.get('a').ty, 7);
});
test('un 4e occupant après le départ du 1er réutilise le plus petit slot libre', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  walkToRest(st.actors.get('a'), st);
  OL.syncActors(st, snap([]));
  fullyExit('a', st);
  OL.syncActors(st, snap([sess('c', 'running')]));
  const c = st.actors.get('c');
  walkToRest(c, st);
  assertEq(c.tx, 0); assertEq(c.ty, 7); // réutilise le slot 0 libéré
});
test('purge → activity leave, done une fois au spawn', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  walkToRest(st.actors.get('a'), st);
  OL.syncActors(st, snap([]));
  const a = st.actors.get('a');
  assertEq(a.activity, 'leave');
  walkToRest(a, st);
  for (let i = 0; i < 10 && !a.done; i++) OL.tickActor(a, st);
  assert(a.done, 'jamais done');
});
test('un acteur en erreur ne marche pas (path vidé), reste en zone agents', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([sess('a', 'error')]));
  assertEq(a.path.length, 0);
  assertEq(a.activity, 'down');
  assertEq(a.zone, 'agents');
});

console.log('\nrésurrection:');
test('résurrection AVANT la sortie effective (slot encore tenu) → même poste exact', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  const originalPos = { tx: a.tx, ty: a.ty };
  OL.syncActors(st, snap([]));
  assertEq(a.activity, 'leave');
  OL.syncActors(st, snap([sess('a', 'running')]));
  assertEq(a.done, false);
  const dest = a.path.length ? a.path[a.path.length - 1] : { tx: a.tx, ty: a.ty };
  assertEq(dest.tx, originalPos.tx); assertEq(dest.ty, originalPos.ty);
});
test('résurrection APRÈS la sortie effective (slot libéré) → nouvelle allocation valide', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  walkToRest(st.actors.get('a'), st);
  OL.syncActors(st, snap([]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  for (let i = 0; i < 10 && !a.done; i++) OL.tickActor(a, st);
  assert(a.done, 'jamais done');
  OL.syncActors(st, snap([sess('a', 'running')]));
  assertEq(a.done, false);
  assertEq(a.zone, 'agents');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nmigration lounge <-> agents (marche visible intra-salle, pas de téléport):');
test('running → waiting : l\'acteur MIGRE vers lounge, tuile par tuile (tx/ty évoluent), jamais de saut', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  assertEq(a.zone, 'agents');
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  assertEq(a.migratingTo, 'lounge');
  assertEq(a.zone, 'agents'); // toujours physiquement en agents, en train de sortir

  let prev = { tx: a.tx, ty: a.ty };
  let ticks = 0, sawMove = false;
  while (a.zone === 'agents' && ticks < 300) {
    OL.tickActor(a, st);
    const dtx = Math.abs(a.tx - prev.tx), dty = Math.abs(a.ty - prev.ty);
    assert(dtx + dty <= 1, `saut détecté : (${prev.tx},${prev.ty}) → (${a.tx},${a.ty})`);
    if (dtx + dty === 1) sawMove = true;
    prev = { tx: a.tx, ty: a.ty };
    ticks++;
  }
  assert(sawMove, 'aucun mouvement observé avant le passage en lounge (téléport direct ?)');
  assertEq(a.zone, 'lounge');
  assertEq(a.migratingTo, null);
  walkToRest(a, st);
  const seatOk = OL.LOUNGE_TOP <= a.ty && a.ty < OL.LOUNGE_TOP + OL.LOUNGE_ROWS;
  assert(seatOk, `poste lounge invalide (${a.tx},${a.ty})`);
});
test('waiting → running : migration retour lounge → agents, marche visible', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  const a = st.actors.get('a');
  walkToRest(a, st); // laisse l'acteur atteindre son siège avant de le faire migrer
  assertEq(a.zone, 'lounge');
  OL.syncActors(st, snap([sess('a', 'running')]));
  assertEq(a.migratingTo, 'agents');
  assert(a.path.length > 0, 'devrait marcher vers la sortie du lounge');
  let ticks = 0;
  while (a.zone === 'lounge' && ticks < 300) { OL.tickActor(a, st); ticks++; }
  assertEq(a.zone, 'agents');
  walkToRest(a, st);
  assertEq(a.tx, 0); assertEq(a.ty, 7);
});
test('migration en cours annulée AVANT d\'avoir quitté la zone → retour au même poste, aucun téléport', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  const originalPos = { tx: a.tx, ty: a.ty };
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  assertEq(a.migratingTo, 'lounge');
  assert(a.path.length > 0, 'devrait marcher vers la sortie');
  OL.syncActors(st, snap([sess('a', 'running')]));
  assertEq(a.migratingTo, null, 'migration annulée');
  assertEq(a.zone, 'agents', 'jamais changé de zone : pas de téléportation visible');
  walkToRest(a, st);
  assertEq(a.tx, originalPos.tx); assertEq(a.ty, originalPos.ty);
});
test('migration : le trajet (sortie agents vers lounge) ne traverse aucun meuble d\'AUCUNE zone', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  walkToRest(st.actors.get('a'), st);
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  const a = st.actors.get('a');
  const room = OL.roomFor(snap([sess('a', 'waiting')]), st);
  assertPathClear(a.path, room.statics, 'migration agents→lounge');
});
test('migration : plusieurs sessions basculent chacune dans son propre poste lounge (pas de partage de tuile)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running'), sess('b', 'running')]));
  const a = st.actors.get('a'), b = st.actors.get('b');
  walkToRest(a, st); walkToRest(b, st);
  OL.syncActors(st, snap([sess('a', 'waiting'), sess('b', 'waiting')]));
  for (let i = 0; i < 400; i++) {
    OL.tickActor(a, st); OL.tickActor(b, st);
    if (a.zone === 'lounge' && b.zone === 'lounge' && a.path.length === 0 && b.path.length === 0) break;
  }
  assertEq(a.zone, 'lounge'); assertEq(b.zone, 'lounge');
  assert(!(a.tx === b.tx && a.ty === b.ty), 'a et b partagent le même poste lounge');
});
test('lounge plein (cap 8) : une 9e session waiting ne disparaît jamais — repli en zone agents', () => {
  const st = OL.createState();
  const nine = many('w', 9, 'waiting');
  OL.syncActors(st, snap(nine));
  for (let i = 0; i < 8; i++) assertEq(st.actors.get(`w${i}`).zone, 'lounge');
  assertEq(st.actors.get('w8').zone, 'agents', 'la 9e session doit rester visible, repliée en agents');
});

// Critical (reviewer) — pacing perpétuel des débordés du lounge : la
// comparaison de migration se faisait sur `desiredZone` BRUT (ignore le
// cap), pas la zone EFFECTIVE (celle qu'`allocateSessionSlot` peut
// réellement offrir). Un débordé installé en agents (lounge plein) voyait
// donc `desiredZone('lounge') !== actor.zone('agents')` redevenir vrai à
// CHAQUE syncActors, même snapshot inchangé → `migratingTo` reflippé →
// nouveau path vers la porte → navette porte↔siège en boucle infinie tant
// que le lounge restait plein. Fix : `effectiveZoneFor` (dry run du cap,
// recalculé à chaque appel) avant le test de migration.
test('Critical (reviewer) : débordé installé en agents, lounge toujours plein → 10 syncActors à snapshot INCHANGÉ → aucun pacing', () => {
  const st = OL.createState();
  const nine = many('w', 9, 'waiting');
  OL.syncActors(st, snap(nine));
  const w8 = st.actors.get('w8');
  assertEq(w8.zone, 'agents');
  walkToRest(w8, st);
  assertEq(w8.path.length, 0);
  const before = { tx: w8.tx, ty: w8.ty };

  for (let i = 0; i < 10; i++) {
    OL.syncActors(st, snap(nine)); // snapshot STRICTEMENT identique à chaque tour
    assertEq(w8.migratingTo, null, `migratingTo reflippé au tour ${i} (pacing)`);
    assertEq(w8.path.length, 0, `path non-vide au tour ${i} (navette porte↔siège)`);
    assertEq(w8.tx, before.tx, `position tx changée au tour ${i}`);
    assertEq(w8.ty, before.ty, `position ty changée au tour ${i}`);
  }
});
test('Critical (reviewer) : une place du lounge se libère → le débordé migre UNE fois (marche visible), puis se stabilise', () => {
  const st = OL.createState();
  const nine = many('w', 9, 'waiting');
  OL.syncActors(st, snap(nine));
  const w8 = st.actors.get('w8');
  assertEq(w8.zone, 'agents');
  walkToRest(w8, st);

  // w0 (tenait un slot lounge) part et sort COMPLÈTEMENT → une place se libère.
  const remaining = nine.slice(1); // w1..w8
  OL.syncActors(st, snap(remaining));
  fullyExit('w0', st);

  // Resync (même `remaining`) : la place libérée doit permettre à w8 de
  // migrer — émergence naturelle de `effectiveZoneFor` (recalculé à chaque
  // appel, pas mis en cache), sans logique dédiée « place libérée ».
  OL.syncActors(st, snap(remaining));
  assertEq(w8.migratingTo, 'lounge', 'le débordé doit migrer vers le lounge maintenant qu\'une place existe');

  let prev = { tx: w8.tx, ty: w8.ty };
  let ticks = 0, moved = false;
  while (w8.zone === 'agents' && ticks < 300) {
    OL.tickActor(w8, st);
    if (w8.tx !== prev.tx || w8.ty !== prev.ty) moved = true;
    prev = { tx: w8.tx, ty: w8.ty };
    ticks++;
  }
  assert(moved, 'aucune marche visible observée (migration attendue)');
  assertEq(w8.zone, 'lounge');
  walkToRest(w8, st);

  // Stabilisation : resyncs répétés à snapshot inchangé → plus aucune
  // migration, plus aucun mouvement (une seule migration, propre).
  const settled = { tx: w8.tx, ty: w8.ty };
  for (let i = 0; i < 10; i++) {
    OL.syncActors(st, snap(remaining));
    assertEq(w8.migratingTo, null, `migratingTo reflippé après stabilisation, tour ${i}`);
    assertEq(w8.path.length, 0, `re-marche après stabilisation, tour ${i}`);
  }
  assertEq(w8.tx, settled.tx); assertEq(w8.ty, settled.ty);
});
test('Critical (reviewer) — re-fuzz déterministe : churn au cap (arrivées/départs alternés) → aucun acteur avec path non-vide sur des syncs consécutifs à snapshot constant', () => {
  const st = OL.createState();
  let idCounter = 0;
  const activeIds = [];

  for (let round = 0; round < 40; round++) {
    if (round % 3 === 0 && activeIds.length < 12) activeIds.push(`f${idCounter++}`);
    else if (round % 5 === 0 && activeIds.length > 6) {
      const leaving = activeIds.shift();
      OL.syncActors(st, snap(activeIds.map(id => sess(id, 'waiting'))));
      if (st.actors.has(leaving)) fullyExit(leaving, st);
      continue;
    }
    OL.syncActors(st, snap(activeIds.map(id => sess(id, 'waiting'))));
    for (const id of activeIds) walkToRest(st.actors.get(id), st);
  }

  // Phase finale : snapshot STRICTEMENT constant, répété — aucun acteur ne
  // doit jamais avoir un path non-vide (le fix rend cela immédiat, pas
  // seulement "borné" — donc l'invariant le plus strict est vérifiable ici).
  const finalSessions = activeIds.map(id => sess(id, 'waiting'));
  for (const id of activeIds) walkToRest(st.actors.get(id), st);
  for (let i = 0; i < 15; i++) {
    OL.syncActors(st, snap(finalSessions));
    for (const id of activeIds) {
      const a = st.actors.get(id);
      assertEq(a.path.length, 0, `${id} a un path non-vide au tour ${i} (pacing, snapshot constant)`);
      assertEq(a.migratingTo, null, `${id} a migratingTo non-null au tour ${i} (pacing, snapshot constant)`);
    }
  }
});

console.log('\nI2 (transposé) — erreur en pleine migration/annulation:');
test('running → waiting (migration démarrée) → error avant la sortie : le perso se fige, ne marche plus', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  assertEq(a.migratingTo, 'lounge');
  OL.tickActor(a, st); OL.tickActor(a, st);
  assert(a.path.length > 0, 'devrait être encore en marche pour ce test');
  OL.syncActors(st, snap([sess('a', 'error')]));
  assertEq(a.path.length, 0, 'le perso en erreur ne doit plus marcher');
  assertEq(OL.animFor(a), `char${a.charIdx}.hurt`);
  assertEq(a.activity, 'down');
});
test('après résolution de l\'erreur, la migration interrompue reprend proprement', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  OL.tickActor(a, st); OL.tickActor(a, st);
  OL.syncActors(st, snap([sess('a', 'error')])); // gèle, path vidé
  OL.syncActors(st, snap([sess('a', 'waiting')])); // erreur résolue, repart en lounge
  assertEq(a.migratingTo, 'lounge');
  assert(a.path.length > 0, 'la marche doit reprendre après le gel, pas rester figée');
  let ticks = 0;
  while (a.zone === 'agents' && ticks < 300) { OL.tickActor(a, st); ticks++; }
  walkToRest(a, st);
  assertEq(a.zone, 'lounge');
});

console.log('\nC1/C2/C3 (transposés à la zone agents — jamais sous les occupants réels):');
test('C1 : sizing cohérent pendant la migration — chaque tuile du trajet de sortie est dans les bornes de la salle RENDUE à chaque tick', () => {
  const st = OL.createState();
  OL.syncActors(st, snap(many('a', 3, 'running')));
  for (let i = 0; i < 3; i++) walkToRest(st.actors.get(`a${i}`), st);

  const snapshot1 = snap([sess('a0', 'waiting'), sess('a1', 'running'), sess('a2', 'running')]);
  OL.syncActors(st, snapshot1);
  const a0 = st.actors.get('a0');
  assertEq(a0.migratingTo, 'lounge');

  let ticks = 0;
  while (a0.zone === 'agents' && ticks < 300) {
    const room = OL.roomFor(snapshot1, st);
    assert(a0.tx >= 0 && a0.tx < room.cols && a0.ty >= 0 && a0.ty < room.rows,
      `tuile (${a0.tx},${a0.ty}) hors bornes de la salle rendue (cols=${room.cols}, rows=${room.rows})`);
    OL.tickActor(a0, st);
    ticks++;
  }
  assertEq(a0.zone, 'lounge');
});
test('C1 : la zone agents ne rétrécit qu\'une fois le migrant physiquement sorti', () => {
  const st = OL.createState();
  OL.syncActors(st, snap(many('a', 4, 'running'))); // 4 → 2 groupes → rows = 5
  for (let i = 0; i < 4; i++) walkToRest(st.actors.get(`a${i}`), st);
  assertEq(OL.roomFor(snap(many('a', 4, 'running')), st).zones.agents.box.rows, 5);

  // a3 (slot le plus haut, seul du 2e groupe) migre : sa sortie conditionne
  // le rétrécissement — a0..a2 (1er groupe) n'ont besoin que de rows=2.
  const snapshot1 = snap([sess('a0', 'running'), sess('a1', 'running'), sess('a2', 'running'), sess('a3', 'waiting')]);
  OL.syncActors(st, snapshot1);
  const a3 = st.actors.get('a3');
  assertEq(OL.roomFor(snapshot1, st).zones.agents.box.rows, 5, 'reste à 5 tant que a3 n\'a pas quitté la zone');
  while (a3.zone === 'agents') OL.tickActor(a3, st);
  assertEq(OL.roomFor(snapshot1, st).zones.agents.box.rows, 2, 'peut rétrécir une fois a3 physiquement sorti');
});

console.log('\nC2 (transposé) — fragmentation des slots (dimensionnement par plus haut index tenu):');
test('C2 : 5 running (slots 0..4) → r0..r3 sortent COMPLÈTEMENT → r4 (slot le plus haut) reste dans les bornes rendues', () => {
  const st = OL.createState();
  const five = many('r', 5, 'running');
  OL.syncActors(st, snap(five));
  for (const s of five) walkToRest(st.actors.get(s.sessionId), st);
  const r4 = st.actors.get('r4');
  assertEq(r4.slotIdx, 4); // groupe1, within1 → c=2 ; groupe1 démarre à AGENTS_TOP+3
  assertEq(r4.tx, 2); assertEq(r4.ty, 10);

  OL.syncActors(st, snap([sess('r4', 'running')]));
  for (const s of five) if (s.sessionId !== 'r4') fullyExit(s.sessionId, st);

  assertEq(st.slots.agents.size, 1); // fragmentation confirmée (sinon le test ne reproduit rien)
  const snapshot = snap([sess('r4', 'running')]);
  const room = OL.roomFor(snapshot, st);
  assert(r4.tx >= 0 && r4.tx < room.cols && r4.ty >= 0 && r4.ty < room.rows,
    `r4 en (${r4.tx},${r4.ty}) hors bornes de la salle rendue (rows=${room.rows})`);
  // slotIdx=4 → groupe1 (0-indexé) : il faut donc 2 groupes (agentsGroups)
  // pour que (2,10) existe. Un dimensionnement par COMPTE brut (logical=1)
  // donnerait agentsGroups(1)=1, rows=2, et (2,10) serait hors sol. Le fix
  // (maxHeldSlotIdx+1=5) donne agentsGroups(5)=2, rows=5 : (2,10) est dans
  // les bornes (AGENTS_TOP=6 .. 6+5-1=10).
  assertEq(room.zones.agents.box.rows, 5, 'la zone doit rester assez grande pour (2,10) (slot 4 encore tenu), peu importe le compte brut');
});

console.log('\nC3 (transposé) — perso gelé en erreur, loin du compte logique restant:');
test('C3 : 7 running, r6 (slot le plus haut, groupe 2) migre et erreure presque aussitôt (ty encore profond) — les 6 autres sortent complètement → r6 gelé reste dans les bornes ET dans la boîte agents rendue', () => {
  const st = OL.createState();
  const seven = many('r', 7, 'running');
  OL.syncActors(st, snap(seven));
  for (const s of seven) walkToRest(st.actors.get(s.sessionId), st);
  const r6 = st.actors.get('r6');
  assertEq(r6.slotIdx, 6); // groupe 2 (0-indexé), within 0 → c=0
  assertEq(r6.tx, 0); assertEq(r6.ty, 13); // AGENTS_TOP(6) + 2*3 + 1

  const stillRunning = Array.from({ length: 6 }, (_, i) => sess(`r${i}`, 'running'));
  const snapAfterWaiting = snap([...stillRunning, sess('r6', 'waiting')]);
  OL.syncActors(st, snapAfterWaiting);
  assertEq(r6.migratingTo, 'lounge');
  OL.tickActor(r6, st); OL.tickActor(r6, st); // 1 pas : encore tout près de son poste (ty=13)
  assert(r6.path.length > 0, 'r6 doit être encore en marche, pas arrivé');
  const frozenTy = r6.ty;
  assertEq(frozenTy, 13);

  // Erreur en pleine sortie : r6 se fige SUR PLACE, encore loin dans la zone
  // agents (ty=13), alors que le compte logique restant (lui seul, en
  // erreur) ne réclamerait naturellement qu'1 groupe (rows=2, jusqu'à
  // AGENTS_TOP+2-1=7) — largement insuffisant pour couvrir ty=13.
  const snapWithError = snap([...stillRunning, sess('r6', 'error')]);
  OL.syncActors(st, snapWithError);
  assertEq(r6.path.length, 0);
  assertEq(r6.ty, frozenTy);

  const snapOnlyError = snap([sess('r6', 'error')]);
  OL.syncActors(st, snapOnlyError);
  for (const s of seven) if (s.sessionId !== 'r6') fullyExit(s.sessionId, st);

  const room = OL.roomFor(snapOnlyError, st);
  assert(r6.tx >= 0 && r6.tx < room.cols && r6.ty >= 0 && r6.ty < room.rows,
    `r6 gelé en (${r6.tx},${r6.ty}) hors bornes de la salle rendue (rows=${room.rows})`);
  // La métadonnée de zone (pas seulement les bornes globales de la salle)
  // doit elle aussi couvrir la tuile gelée — sinon Task 3 dessinerait un
  // encadré/repère de zone qui ne contient pas son propre occupant.
  assert(room.zones.agents.box.rows >= (r6.ty - OL.AGENTS_TOP + 1),
    `boîte agents (rows=${room.zones.agents.box.rows}) ne couvre pas ty=${r6.ty}`);
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\ndeep-research : agents de workflow (dédup runId, purge):');
test('workflow → min(running dédup, 8) acteurs kind:workflow en zone dr', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 11 }] })]));
  const wf = [...st.actors.values()].filter(x => x.kind === 'workflow');
  assertEq(wf.length, 8);
  assert(wf.every(x => x.zone === 'dr'));
});
test('workflow terminé → acteurs supprimés', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 3 }] })]));
  OL.syncActors(st, snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 0 }] })]));
  assertEq([...st.actors.values()].filter(x => x.kind === 'workflow').length, 0);
});
// Fix reviewer final : une session BACKGROUND avec un workflow running
// crée bien ses acteurs (`syncWorkflowAgents` reçoit déjà interactive+
// background) mais `roomFor` sommait `wfTotal` sur `interactive` SEUL — le
// counter/mobilier de la zone dr restait à 0 alors que des persos flottaient
// déjà dans la salle. Vérifie que counter et mobilier sont cohérents avec
// les acteurs réellement créés.
test('session background avec workflow running → counter/mobilier dr cohérents (pas juste des persos flottants)', () => {
  const st = OL.createState();
  const h = sess('h', 'running', { isBackground: true, workflows: [{ runId: 'w', running: 5 }] });
  OL.syncActors(st, snap([], [h]));
  const wf = [...st.actors.values()].filter(x => x.kind === 'workflow');
  assertEq(wf.length, 5, 'les acteurs workflow doivent exister pour une session headless');
  const room = OL.roomFor(snap([], [h]), st);
  assertEq(room.zones.dr.counter, 5, 'le counter dr doit refléter le workflow headless');
  const consoles = room.statics.filter(s => s.frame === 'sideDesk90');
  assertEq(consoles.length, 5, 'le mobilier dr doit suivre les 5 acteurs, pas rester à 0');
});

console.log('\nheadless : cap 6, jamais de marche, pas de focus, purge:');
test('session background → acteur direct en zone headless, jamais en lounge/agents', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([], [sess('h', 'running', { isBackground: true })]));
  const h = [...st.actors.values()].find(x => x.kind === 'headless');
  assert(h, 'pas d\'acteur headless');
  assertEq(h.zone, 'headless');
  assertEq(h.path.length, 0); // apparition directe, jamais de marche
  OL.syncActors(st, snap([], [sess('h', 'waiting', { isBackground: true })])); // même en waiting, reste headless
  assertEq(h.zone, 'headless');
});
test('headless disparu → acteur supprimé immédiatement', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([], [sess('h', 'running')]));
  assert(st.actors.has('h:headless'));
  OL.syncActors(st, snap([], []));
  assert(!st.actors.has('h:headless'));
});
test('flip interactif → headless (I3 transposé) : l\'ancien acteur session part (leave), un headless apparaît aussitôt', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  assertEq(st.actors.get('a').kind, 'session');
  OL.syncActors(st, snap([], [sess('a', 'running', { isBackground: true })]));
  const old = st.actors.get('a');
  assert(old, 'l\'ancien acteur session a disparu trop tôt');
  assertEq(old.activity, 'leave');
  assert(st.actors.has('a:headless'), 'acteur headless absent après le flip');
  for (let i = 0; i < 400 && !old.done; i++) OL.tickActor(old, st);
  assertEq(old.done, true);
});
test('flip headless → interactif (I3 transposé) : l\'ancien headless purgé immédiatement, un acteur session apparaît', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([], [sess('h', 'running')]));
  OL.syncActors(st, snap([sess('h', 'running')]));
  assert(!st.actors.has('h:headless'));
  assert(st.actors.has('h'));
  assertEq(st.actors.get('h').kind, 'session');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nsubagents : adjacence au poste du parent (portable, jusqu\'à 2, +N au-delà):');
test('subagents : positionnés à la colonne réservée (c+1) du poste du parent, jusqu\'à 2', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }, { agentId: 'g2' }, { agentId: 'g3' }] })]));
  const parent = st.actors.get('a');
  walkToRest(parent, st); // le parent atteint son poste (0,7) ; le portable suit le SLOT, pas la position transitoire
  const g1 = st.actors.get('a:sub:g1'), g2 = st.actors.get('a:sub:g2');
  assert(g1 && g2, 'subagents manquants');
  assert(!st.actors.has('a:sub:g3'), 'un 3e subagent ne doit pas apparaître (cap 2 par parent)');
  assertEq(g1.tx, parent.tx + 1); assertEq(g1.ty, parent.ty); // colonne réservée, même rangée que le fauteuil
  // Fix F2 (revue Task 3, 2e portable flottant) : l'ancien poste (rangée du
  // BUREAU, au-dessus) n'avait aucun support visuel (ni fauteuil, ni sol —
  // le perso se dessinait par-dessus la console). Le 2e portable est
  // maintenant décalé d'UNE rangée SOUS le fauteuil (circulation du groupe,
  // jamais de mobilier dessus, jamais traversée par une marche) : ancrage
  // au sol, dans l'empreinte de la même colonne que le 1er (même bureau),
  // sans jamais toucher la station voisine.
  assertEq(g2.tx, parent.tx + 1); assertEq(g2.ty, parent.ty + 1); // 2e portable : rangée SOUS le fauteuil (sol nu)
  assertEq(g2.zone, 'agents');
});
test('overflow subagents : compté PAR PARENT dans zones.agents.overflow.total (au-delà de 2)', () => {
  const room = OL.roomFor(snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }, { agentId: 'g2' }, { agentId: 'g3' }, { agentId: 'g4' }] })]));
  assertEq(room.zones.agents.overflow.total, 2);
});
test('subagent disparu → acteur supprimé au sync suivant', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }] })]));
  assert(st.actors.has('a:sub:g1'));
  OL.syncActors(st, snap([sess('a', 'running')]));
  assert(!st.actors.has('a:sub:g1'));
});
test('parent sans poste agents actuel (encore en lounge) → aucun portable créé', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'waiting', { subagents: [{ agentId: 'g1' }] })]));
  assert(!st.actors.has('a:sub:g1'), 'un subagent ne doit pas apparaître si le parent n\'a pas de poste agents');
});
test('parent qui migre vers lounge → une fois PHYSIQUEMENT parti, ses portables disparaissent (pas de marche pour eux)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }] })]));
  const parent = st.actors.get('a');
  walkToRest(parent, st);
  assert(st.actors.has('a:sub:g1'));
  OL.syncActors(st, snap([sess('a', 'waiting', { subagents: [{ agentId: 'g1' }] })]));
  // Le parent commence juste à migrer : il est ENCORE physiquement au poste
  // (zone toujours 'agents', simple marche de sortie qui démarre) — son
  // portable reste visible tant qu'il n'a pas réellement quitté, pour ne
  // jamais faire disparaître le décor avant le personnage lui-même.
  assert(st.actors.has('a:sub:g1'), 'le portable ne doit pas disparaître avant que le parent ait physiquement quitté son poste');
  while (parent.zone === 'agents') OL.tickActor(parent, st);
  OL.syncActors(st, snap([sess('a', 'waiting', { subagents: [{ agentId: 'g1' }] })])); // resync post-arrivée
  assert(!st.actors.has('a:sub:g1'), 'le portable doit disparaître une fois le parent en zone lounge');
});
test('roomFor place un static `laptop` à la position de chaque subagent réel (via state)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }] })]));
  const g1 = st.actors.get('a:sub:g1');
  const room = OL.roomFor(snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }] })]), st);
  assert(room.statics.some(s => s.frame === 'laptop' && s.tx === g1.tx && s.ty === g1.ty), 'pas de laptop à la position du subagent');
});
test('actorsAll trie par ty, contient tous les kinds', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }] }), sess('b', 'waiting')], [sess('h', 'running')]));
  const list = OL.actorsAll(st);
  assert(list.length >= 4, 'kinds manquants (session x2, subagent, headless)');
  for (let i = 1; i < list.length; i++) assert(list[i].ty >= list[i - 1].ty, 'pas trié par ty');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nanimFor:');
test('en mouvement → walk.<dir>', () => {
  assertEq(OL.animFor({ charIdx: 3, activity: 'work', path: [{ tx: 5, ty: 2 }], dir: 'left' }), 'char3.walk.left');
});
test('work/think au poste → idle.up (dos au spectateur), call → phone.right, down → hurt', () => {
  assertEq(OL.animFor({ charIdx: 0, activity: 'work', path: [], dir: 'down' }), 'char0.idle.up');
  assertEq(OL.animFor({ charIdx: 0, activity: 'think', path: [], dir: 'down' }), 'char0.idle.up');
  assertEq(OL.animFor({ charIdx: 1, activity: 'call', path: [], dir: 'down' }), 'char1.phone.right');
  assertEq(OL.animFor({ charIdx: 1, activity: 'down', path: [], dir: 'down' }), 'char1.hurt');
});
test('relax (lounge) → idle.down, face caméra', () => {
  assertEq(OL.animFor({ charIdx: 4, activity: 'relax', path: [], dir: 'down' }), 'char4.idle.down');
});
test('kind workflow → idle.down (poste latéral, pas idle.up)', () => {
  assertEq(OL.animFor({ charIdx: 2, activity: 'work', kind: 'workflow', path: [], dir: 'up' }), 'char2.idle.down');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nemoteFor (fonction pure, priorité bell > état > outil, inchangé):');
test('priorité 1 : enveloppe (bell active) prime sur tout état', () => {
  assertEq(OL.emoteFor(sess('a', 'thinking'), true), 'emote.mail');
  assertEq(OL.emoteFor(sess('a', 'running'), true), 'emote.mail');
  assertEq(OL.emoteFor(sess('a', 'waiting'), true), 'emote.mail');
});
test('priorité 2 : émote d\'état sans bell', () => {
  assertEq(OL.emoteFor(sess('a', 'thinking'), false), 'emote.think');
  assertEq(OL.emoteFor(sess('a', 'pending'), false), 'emote.alert');
  assertEq(OL.emoteFor(sess('a', 'error'), false), 'emote.angry');
  assertEq(OL.emoteFor(sess('a', 'waiting'), false), 'emote.zzz');
});
test('priorité 3 : running → toujours emote.work', () => {
  assertEq(OL.emoteFor(sess('a', 'running'), false), 'emote.work');
});
test('null si pas de bulle', () => {
  assertEq(OL.emoteFor(sess('a', 'some-unknown-state'), false), null);
  assertEq(OL.emoteFor({ kind: 'subagent', activity: 'work' }, false), null);
});

console.log('\nlabelFor (étiquette pixel, 8 car. max):');
test('acteur session → nom de son propre projet, tronqué à 8', () => {
  assertEq(OL.labelFor({ kind: 'session' }, sess('a', 'running', { projectName: 'aby-claude-watcher' })), 'aby-clau');
});
test('customName prioritaire sur projectName', () => {
  assertEq(OL.labelFor({ kind: 'session' }, sess('a', 'running', { projectName: 'x', customName: 'mon-nom-perso' })), 'mon-nom-');
});
test('acteur subagent/workflow/headless → étiquette = projet PARENT', () => {
  assertEq(OL.labelFor({ kind: 'subagent' }, sess('a', 'running', { projectName: 'parent-project' })), 'parent-p');
});

console.log('\ncloche needs-you (retour Paul 2026-07-19, transposé):');
test('waiting + cloche active → reste en zone agents, assis à son poste', () => {
  const st = OL.createState();
  OL.syncActors(st, { interactive: [sess('a', 'running')], background: [] });
  const a = st.actors.get('a');
  walkToRest(a, st);
  const posAvant = { tx: a.tx, ty: a.ty };
  const waitBell = Object.assign(sess('a', 'waiting'), { bellActive: true });
  OL.syncActors(st, { interactive: [waitBell], background: [] });
  assertEq(a.zone, 'agents');
  assertEq(a.migratingTo, null);
  assertEq(a.path.length, 0);
  assertEq(a.tx, posAvant.tx); assertEq(a.ty, posAvant.ty);
  assertEq(OL.animFor(a), `char${a.charIdx}.idle.up`);
});
test('cloche expirée → il part alors en lounge', () => {
  const st = OL.createState();
  OL.syncActors(st, { interactive: [sess('a', 'running')], background: [] });
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, { interactive: [Object.assign(sess('a', 'waiting'), { bellActive: true })], background: [] });
  assertEq(a.zone, 'agents');
  OL.syncActors(st, { interactive: [sess('a', 'waiting')], background: [] });
  assert(a.migratingTo === 'lounge' || a.zone === 'lounge', 'pas de départ en lounge après expiration');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
