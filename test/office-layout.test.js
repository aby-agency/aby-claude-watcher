// test/office-layout.test.js — Run: node test/office-layout.test.js
// v3 : 3 salles par fonction (Travail/Pause/Recherche), persos migrent selon
// l'état de leur session. Slots stables PAR SALLE. Voir docs/superpowers/
// specs/2026-07-17-office-salles-design.md (fait foi) et le plan associé.
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

// ─────────────────────────────────────────────────────────────────────────
console.log('\ncharIndexFor / activityFor / roomKeyForState:');
test('charIndexFor stable et borné [0,9]', () => {
  assertEq(OL.charIndexFor('aby-claude-watcher'), OL.charIndexFor('aby-claude-watcher'));
  for (const n of ['a', 'x/y', '']) { const i = OL.charIndexFor(n); assert(i >= 0 && i <= 9); }
});
test('mapping des activités — waiting devient relax (v3 : quitte le PC pour la pause)', () => {
  assertEq(OL.activityFor('thinking'), 'think');
  assertEq(OL.activityFor('running'), 'work');
  assertEq(OL.activityFor('waiting'), 'relax'); // v3 : supersède v2.7 (waiting migre en salle pause)
  assertEq(OL.activityFor('pending'), 'call');
  assertEq(OL.activityFor('error'), 'down');
});
test('roomKeyForState : travail = thinking/running/pending/error, pause = waiting', () => {
  assertEq(OL.roomKeyForState('thinking'), 'work');
  assertEq(OL.roomKeyForState('running'), 'work');
  assertEq(OL.roomKeyForState('pending'), 'work');
  assertEq(OL.roomKeyForState('error'), 'work');
  assertEq(OL.roomKeyForState('waiting'), 'break');
  assertEq(OL.roomKeyForState(undefined), 'work'); // défaut
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nroomsFor (3 salles, ordre fixe, géométrie):');
test('3 salles, ordre travail/pause/recherche, clés attendues', () => {
  const rooms = OL.roomsFor(snap([]));
  assertEq(rooms.length, 3);
  assertEq(rooms[0].key, 'work'); assertEq(rooms[1].key, 'break'); assertEq(rooms[2].key, 'research');
  for (const r of rooms) {
    assert(typeof r.cols === 'number' && typeof r.rows === 'number');
    assert(Array.isArray(r.statics));
    assert(r.doorSpawn && typeof r.doorSpawn.tx === 'number' && typeof r.doorSpawn.ty === 'number');
    assert(typeof r.counter === 'number');
  }
});
test('salle vide = taille minimale, décor visible (desk pair travail, décor pause/recherche)', () => {
  const rooms = OL.roomsFor(snap([]));
  const work = rooms.find(r => r.key === 'work');
  assertEq(work.rows, 5); // 3 + 2*1 (min 1 paire de bureaux même vide)
  assert(work.statics.some(s => s.frame === 'desk'), 'pas de bureau décor en salle vide');
  const brk = rooms.find(r => r.key === 'break');
  assertEq(brk.rows, 5);
  assert(brk.statics.some(s => s.frame === 'coffeeMachine'), 'pas de machine à café décor');
  const research = rooms.find(r => r.key === 'research');
  assertEq(research.rows, 4);
  assert(research.statics.some(s => s.frame === 'meetingTable'), 'pas de table de réunion décor');
  assert(research.statics.some(s => s.frame === 'whiteboard'), 'pas de tableau blanc décor');
});
test('footer : counter = occupants de la salle', () => {
  const rooms = OL.roomsFor(snap([sess('a', 'running'), sess('b', 'waiting'), sess('c', 'thinking')]));
  assertEq(rooms.find(r => r.key === 'work').counter, 2); // a (running) + c (thinking)
  assertEq(rooms.find(r => r.key === 'break').counter, 1); // b (waiting)
});
test('salle travail : rows grandit par paires de postes occupés (min 5)', () => {
  const rows = n => OL.roomsFor(snap(Array.from({ length: n }, (_, i) => sess('s' + i, 'running')))).find(r => r.key === 'work').rows;
  assertEq(rows(0), 5); assertEq(rows(1), 5); assertEq(rows(2), 5);
  assertEq(rows(3), 7); assertEq(rows(4), 7);
  assertEq(rows(5), 9);
});
test('salle pause : rows fixes à 5 tant que ≤ 6 occupants, extensible ensuite', () => {
  const rows = n => OL.roomsFor(snap(Array.from({ length: n }, (_, i) => sess('s' + i, 'waiting')))).find(r => r.key === 'break').rows;
  assertEq(rows(0), 5); assertEq(rows(6), 5);
  assertEq(rows(7), 7); assertEq(rows(12), 7); assertEq(rows(13), 9);
});
test('salle recherche : rows grandit avec les subagents au-delà de la base (rangées 3+)', () => {
  const withSubs = n => OL.roomsFor(snap([sess('a', 'running', { subagents: Array.from({ length: n }, (_, i) => ({ agentId: 'g' + i })) })])).find(r => r.key === 'research').rows;
  assertEq(withSubs(0), 4);
  assertEq(withSubs(2), 4); // 1 rangée (ty=3) tient dans rows=4
  assertEq(withSubs(3), 5); // 2 rangées (ty=3,4) → rows = 3+2
});
test('salle recherche : le coin headless (cap 4, 2 rangées ty=2..3) tient toujours dans la base 4 rangées', () => {
  const withHeadless = n => OL.roomsFor(snap([], Array.from({ length: n }, (_, i) => sess('h' + i, 'running')))).find(r => r.key === 'research').rows;
  assertEq(withHeadless(0), 4);
  assertEq(withHeadless(2), 4);
  assertEq(withHeadless(4), 4); // cap atteint (4), les rangées 2+3 suffisent, jamais de croissance pour le seul headless
});
test('le mur (rangée 0) et le sol couvrent les dimensions effectives, dans chaque salle', () => {
  const rooms = OL.roomsFor(snap([sess('a', 'running'), sess('b', 'waiting')]));
  for (const r of rooms) {
    assertEq(r.statics.filter(s => s.frame === 'wall').length, r.cols);
    const floor = r.statics.filter(s => s.frame === 'floor' || s.frame === 'floorWood');
    assertEq(floor.length, r.cols * (r.rows - 1));
  }
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nrecherche : caps subagents/workflow/headless + overflow:');
test('subagents : cap 6, overflow au-delà (forme uniforme {total, ...détail})', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ agentId: 'g' + i }));
  const research = OL.roomsFor(snap([sess('a', 'running', { subagents: eight })])).find(r => r.key === 'research');
  assertEq(research.overflow.subagents, 2);
  assertEq(research.overflow.total, 2);
});
test('workflow : cap 4 sièges de table, overflow au-delà (dédup runId)', () => {
  const research = OL.roomsFor(snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 7 }] })])).find(r => r.key === 'research');
  assertEq(research.overflow.workflow, 3);
  assertEq(research.overflow.total, 3);
});
test('headless : cap 4, overflow au-delà', () => {
  const seven = Array.from({ length: 7 }, (_, i) => sess('h' + i, 'running'));
  const research = OL.roomsFor(snap([], seven)).find(r => r.key === 'research');
  assertEq(research.overflow.headless, 3);
  assertEq(research.overflow.total, 3);
});
test('overflow cumulé : total = somme des 3 sous-familles', () => {
  const research = OL.roomsFor(snap(
    [sess('a', 'running', { subagents: Array.from({ length: 8 }, (_, i) => ({ agentId: 'g' + i })), workflows: [{ runId: 'w', running: 7 }] })],
    Array.from({ length: 7 }, (_, i) => sess('h' + i, 'running')),
  )).find(r => r.key === 'research');
  assertEq(research.overflow.total, 2 + 3 + 3);
});
test('pas d\'overflow pour travail/pause (extensibles) — même forme {total} que recherche (M4)', () => {
  const rooms = OL.roomsFor(snap(Array.from({ length: 20 }, (_, i) => sess('s' + i, 'running'))));
  assertEq(rooms.find(r => r.key === 'work').overflow.total, 0);
  assertEq(rooms.find(r => r.key === 'break').overflow.total, 0);
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
console.log('\nsyncActors : spawn, slots stables, non-traversée:');
function walkToRest(a, state) { for (let i = 0; i < 300 && a.path.length > 0; i++) OL.tickActor(a, state); }
function onWorkDesk(p) { return (p.tx === 0 && p.ty % 2 === 1) || (p.tx === 4 && p.ty % 2 === 1); }

test('nouvelle session running → acteur spawn en salle travail, poste (1,2)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  assert(a, 'pas d\'acteur');
  assertEq(a.roomKey, 'work');
  assertEq(a.tx, 6); assertEq(a.ty, 1); // spawn (6,1)
  const dest = a.path[a.path.length - 1];
  assertEq(dest.tx, 1); assertEq(dest.ty, 2);
});
test('nouvelle session waiting → acteur spawn directement en salle pause', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  const a = st.actors.get('a');
  assertEq(a.roomKey, 'break');
});
test('spawn/leave en salle travail ne traverse jamais un bureau (0,impair)/(4,impair)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  assert(!a.path.some(onWorkDesk), 'le path de spawn traverse un bureau');
  walkToRest(a, st);
  assertEq(a.tx, 1); assertEq(a.ty, 2);
  OL.syncActors(st, snap([])); // purge → leave
  assert(!a.path.some(onWorkDesk), 'le path de leave traverse un bureau');
});
test('2 postes occupés → 2e slot en (5,2), stable tant que la session reste', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running'), sess('b', 'running')]));
  const a = st.actors.get('a'), b = st.actors.get('b');
  walkToRest(a, st); walkToRest(b, st);
  const pos = id => { const x = st.actors.get(id); return { tx: x.tx, ty: x.ty }; };
  const slots = [pos('a'), pos('b')].sort((p, q) => p.tx - q.tx);
  assertEq(slots[0].tx, 1); assertEq(slots[0].ty, 2);
  assertEq(slots[1].tx, 5); assertEq(slots[1].ty, 2);
  // resync plusieurs fois : positions inchangées
  OL.syncActors(st, snap([sess('a', 'thinking'), sess('b', 'running')]));
  assertEq(a.tx, pos('a').tx); assertEq(a.ty, pos('a').ty);
});
test('un 3e occupant après le départ du 1er réutilise le plus petit slot libre', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([])); // a part
  walkToRest(a, st);
  for (let i = 0; i < 10 && !a.done; i++) OL.tickActor(a, st);
  assert(a.done, 'a jamais done');
  OL.syncActors(st, snap([sess('c', 'running')]));
  const c = st.actors.get('c');
  walkToRest(c, st);
  assertEq(c.tx, 1); assertEq(c.ty, 2); // réutilise le slot 0 libéré
});
test('l\'acteur atteint son poste en marchant (path se vide)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  assertEq(a.path.length, 0);
  assertEq(a.tx, 1); assertEq(a.ty, 2);
});
test('purge → activity leave, done une fois à la porte', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([]));
  assertEq(a.activity, 'leave');
  walkToRest(a, st);
  for (let i = 0; i < 10 && !a.done; i++) OL.tickActor(a, st);
  assert(a.done, 'jamais done');
});
test('un acteur en erreur ne marche pas (path vidé)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([sess('a', 'error')]));
  assertEq(a.path.length, 0);
  assertEq(a.activity, 'down');
  assertEq(a.roomKey, 'work'); // error reste en salle travail
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nrésurrection:');
test('résurrection AVANT la sortie effective (slot encore tenu) → même poste exact', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  const originalPos = { tx: a.tx, ty: a.ty };
  OL.syncActors(st, snap([])); // déclenche le leave, a se met à marcher vers la sortie
  assertEq(a.activity, 'leave');
  OL.syncActors(st, snap([sess('a', 'running')])); // ressuscite avant d'avoir atteint la porte
  assertEq(a.done, false);
  const dest = a.path.length ? a.path[a.path.length - 1] : { tx: a.tx, ty: a.ty };
  assertEq(dest.tx, originalPos.tx); assertEq(dest.ty, originalPos.ty);
});
test('résurrection APRÈS la sortie effective (slot libéré) → nouvelle allocation valide', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([]));
  walkToRest(a, st);
  for (let i = 0; i < 10 && !a.done; i++) OL.tickActor(a, st);
  assert(a.done, 'jamais done');
  OL.syncActors(st, snap([sess('a', 'running')]));
  assertEq(a.done, false);
  assertEq(a.roomKey, 'work');
  const dest = a.path[a.path.length - 1];
  assert((dest.tx === 1 || dest.tx === 5) && dest.ty >= 2, 'poste invalide après résurrection tardive');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nmigration travail <-> pause:');
test('running → waiting : l\'acteur MIGRE de la salle travail vers la salle pause', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  assertEq(a.roomKey, 'work');
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  assertEq(a.migratingTo, 'break');
  assertEq(a.roomKey, 'work'); // toujours physiquement en salle travail, en train de sortir
  walkToRest(a, st); // atteint la porte travail → tick suivant déclenche le téléport
  OL.tickActor(a, st);
  assertEq(a.roomKey, 'break');
  assertEq(a.migratingTo, null);
  walkToRest(a, st);
  // position finale en salle pause = un slot pause valide
  const seatOk = (a.tx === 2 || a.tx === 4 || a.tx === 6 || a.tx === 1) && a.ty >= 2;
  assert(seatOk, `poste pause invalide (${a.tx},${a.ty})`);
});
test('waiting → running : migration retour pause → travail', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  const a = st.actors.get('a');
  assertEq(a.roomKey, 'break');
  OL.syncActors(st, snap([sess('a', 'running')]));
  assertEq(a.migratingTo, 'work');
  walkToRest(a, st);
  OL.tickActor(a, st);
  assertEq(a.roomKey, 'work');
  walkToRest(a, st);
  assertEq(a.tx, 1); assertEq(a.ty, 2);
});
test('migration en cours qui re-change d\'état AVANT d\'avoir quitté la salle → annulée, retour au même poste, aucun téléport', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  const originalPos = { tx: a.tx, ty: a.ty };
  OL.syncActors(st, snap([sess('a', 'waiting')])); // commence à migrer vers pause
  assertEq(a.migratingTo, 'break');
  assert(a.path.length > 0, 'devrait marcher vers la sortie');
  OL.syncActors(st, snap([sess('a', 'running')])); // repasse running avant d'avoir atteint la porte
  assertEq(a.migratingTo, null, 'migration annulée');
  assertEq(a.roomKey, 'work', 'jamais changé de salle : pas de téléportation visible');
  walkToRest(a, st);
  assertEq(a.tx, originalPos.tx); assertEq(a.ty, originalPos.ty); // même poste exact
});
test('migration : le trajet en salle travail (sortie) ne traverse pas les bureaux', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  assert(!a.path.some(onWorkDesk), 'le trajet de migration traverse un bureau');
});
test('migration : plusieurs sessions en parallèle basculent chacune dans son propre slot pause', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running'), sess('b', 'running')]));
  const a = st.actors.get('a'), b = st.actors.get('b');
  walkToRest(a, st); walkToRest(b, st);
  OL.syncActors(st, snap([sess('a', 'waiting'), sess('b', 'waiting')]));
  for (let i = 0; i < 400; i++) {
    OL.tickActor(a, st); OL.tickActor(b, st);
    if (a.roomKey === 'break' && b.roomKey === 'break' && a.path.length === 0 && b.path.length === 0) break;
  }
  assertEq(a.roomKey, 'break'); assertEq(b.roomKey, 'break');
  assert(!(a.tx === b.tx && a.ty === b.ty), 'a et b partagent le même poste pause');
});

console.log('\nC1 (reviewer) — dimensionnement route/salle rendue cohérent pendant la migration:');
test('C1 : 3 running installés, 1 passe waiting (palier de paires 3→2 franchi) — chaque tuile du trajet de sortie est dans les bornes de la salle travail RENDUE à chaque tick', () => {
  const st = OL.createState();
  const snapshot0 = snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]);
  OL.syncActors(st, snapshot0);
  walkToRest(st.actors.get('a'), st); walkToRest(st.actors.get('b'), st); walkToRest(st.actors.get('c'), st);

  const snapshot1 = snap([sess('a', 'waiting'), sess('b', 'running'), sess('c', 'running')]);
  OL.syncActors(st, snapshot1); // a se met à migrer : logique work passe de 3 à 2 (palier de paires 2→1, rows 7→5)
  const a = st.actors.get('a');
  assertEq(a.migratingTo, 'break');

  let ticks = 0;
  while (a.roomKey === 'work' && ticks < 200) {
    const room = OL.roomsFor(snapshot1, st).find(r => r.key === 'work');
    assert(a.tx >= 0 && a.tx < room.cols && a.ty >= 0 && a.ty < room.rows,
      `tuile (${a.tx},${a.ty}) hors bornes de la salle travail rendue (cols=${room.cols}, rows=${room.rows})`);
    OL.tickActor(a, st);
    ticks++;
  }
  assertEq(a.roomKey, 'break'); // la migration a bien fini par aboutir
});
test('C1 : la salle travail ne rétrécit qu\'une fois le migrant physiquement sorti (rows reste à 7 tant que son slot est tenu)', () => {
  const st = OL.createState();
  const snapshot0 = snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]);
  OL.syncActors(st, snapshot0);
  walkToRest(st.actors.get('a'), st); walkToRest(st.actors.get('b'), st); walkToRest(st.actors.get('c'), st);
  assertEq(OL.roomsFor(snapshot0, st).find(r => r.key === 'work').rows, 7);

  // C'est 'c' (créé en dernier, slot le PLUS HAUT — 2e pair) qui migre :
  // c'est son départ qui conditionne un éventuel rétrécissement (fix C2 —
  // le dimensionnement suit le plus haut slot ENCORE tenu, pas le compte
  // brut ; si 'a' ou 'b', slots bas, migrait à la place, la salle resterait
  // à 7 pour toujours tant que 'c' occupe le slot haut — comportement
  // correct, couvert par les tests C2 dédiés).
  const snapshot1 = snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'waiting')]);
  OL.syncActors(st, snapshot1);
  const c = st.actors.get('c');
  // Juste après le changement d'état, AVANT que le migrant ait atteint la
  // porte : la salle rendue doit rester à 7 (sinon C1 se reproduit).
  assertEq(OL.roomsFor(snapshot1, st).find(r => r.key === 'work').rows, 7);
  while (c.roomKey === 'work') OL.tickActor(c, st);
  // Une fois sorti (slot 2 libéré, plus haut slot tenu retombe à 1 = b) :
  // la salle peut rétrécir.
  assertEq(OL.roomsFor(snapshot1, st).find(r => r.key === 'work').rows, 5);
});
test('roomsFor sans state (2e paramètre omis) reste une fonction pure du snapshot — comportement des tests de géométrie inchangé', () => {
  const rooms = OL.roomsFor(snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]));
  assertEq(rooms.find(r => r.key === 'work').rows, 7);
});

console.log('\nI2 (reviewer) — erreur en pleine migration/annulation:');
test('I2 : running → waiting (migration démarrée) → error avant la porte : le perso s\'effondre sur place, ne marche plus', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([sess('a', 'waiting')])); // démarre la migration travail → pause
  assertEq(a.migratingTo, 'break');
  OL.tickActor(a, st); OL.tickActor(a, st); // 2 ticks de marche, pas encore à la porte
  assert(a.path.length > 0, 'devrait être encore en marche pour ce test');
  OL.syncActors(st, snap([sess('a', 'error')]));
  assertEq(a.path.length, 0, 'le perso en erreur ne doit plus marcher');
  assertEq(OL.animFor(a), `char${a.charIdx}.hurt`);
  assertEq(a.activity, 'down');
});
test('I2 : après résolution de l\'erreur, la migration interrompue reprend proprement (pas de blocage figé)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  const a = st.actors.get('a');
  walkToRest(a, st);
  OL.syncActors(st, snap([sess('a', 'waiting')]));
  OL.tickActor(a, st); OL.tickActor(a, st);
  OL.syncActors(st, snap([sess('a', 'error')])); // gèle en 'down', path vidé
  OL.syncActors(st, snap([sess('a', 'waiting')])); // erreur résolue, repart en pause
  assertEq(a.migratingTo, 'break');
  assert(a.path.length > 0, 'la marche doit reprendre après le gel, pas rester figée');
  let ticks = 0;
  while (a.roomKey === 'work' && ticks < 200) { OL.tickActor(a, st); ticks++; }
  walkToRest(a, st);
  assertEq(a.roomKey, 'break');
});

console.log('\nI3 (reviewer) — non-traversée en salle Pause (blocs étendus inclus):');
test('I3 : 13 sessions waiting (2e rangée du bloc étendu couverte) — aucun trajet ne traverse canapés/comptoir/fontaine/distributeur/plantes', () => {
  const st = OL.createState();
  const forbidden = [
    { tx: 2, ty: 3 }, { tx: 5, ty: 3 },   // canapés
    { tx: 0, ty: 1 }, { tx: 1, ty: 1 }, { tx: 7, ty: 1 }, // comptoir/fontaine/distributeur
    { tx: 0, ty: 4 }, { tx: 7, ty: 4 },  // plantes
  ];
  const isForbidden = p => forbidden.some(f => f.tx === p.tx && f.ty === p.ty);
  // 13 sessions (bonus reviewer) : dépasse 6 (base) et 12 (1er bloc étendu
  // complet), couvre donc la 2e rangée du 2e bloc — motif [1,4,6] vérifié à
  // la main par le reviewer sur ce palier, verrouillé ici.
  const sessions = Array.from({ length: 13 }, (_, i) => sess('w' + i, 'waiting'));
  OL.syncActors(st, snap(sessions));
  for (const s of sessions) {
    const a = st.actors.get(s.sessionId);
    assert(!a.path.some(isForbidden), `le trajet de ${s.sessionId} vers (${a.path[a.path.length - 1].tx},${a.path[a.path.length - 1].ty}) traverse un obstacle pause`);
  }
});
test('I3 : les mêmes 13 acteurs atteignent bien leur siège en marchant, sans jamais fouler un obstacle en cours de route', () => {
  const st = OL.createState();
  const forbidden = [
    { tx: 2, ty: 3 }, { tx: 5, ty: 3 },
    { tx: 0, ty: 1 }, { tx: 1, ty: 1 }, { tx: 7, ty: 1 },
    { tx: 0, ty: 4 }, { tx: 7, ty: 4 },
  ];
  const isForbidden = p => forbidden.some(f => f.tx === p.tx && f.ty === p.ty);
  // 13 sessions (bonus reviewer) : dépasse 6 (base) et 12 (1er bloc étendu
  // complet), couvre donc la 2e rangée du 2e bloc — motif [1,4,6] vérifié à
  // la main par le reviewer sur ce palier, verrouillé ici.
  const sessions = Array.from({ length: 13 }, (_, i) => sess('w' + i, 'waiting'));
  OL.syncActors(st, snap(sessions));
  for (const s of sessions) {
    const a = st.actors.get(s.sessionId);
    for (let i = 0; i < 300 && a.path.length > 0; i++) {
      assert(!isForbidden({ tx: a.tx, ty: a.ty }), `${s.sessionId} se tient sur un obstacle (${a.tx},${a.ty}) en cours de route`);
      OL.tickActor(a, st);
    }
    assert(!isForbidden({ tx: a.tx, ty: a.ty }), `${s.sessionId} termine sur un obstacle (${a.tx},${a.ty})`);
  }
});

// Fait sortir COMPLÈTEMENT un acteur (kind:'session') : simule le contrat
// M5 (« les acteurs done sont supprimés par l'appelant ») — tick jusqu'à
// `done`, puis retire l'entrée de `state.actors` comme est censé le faire
// Task 2, jamais `state.slots` (déjà libéré en interne par tickActor).
function fullyExit(sessionId, st) {
  const a = st.actors.get(sessionId);
  for (let i = 0; i < 300 && !a.done; i++) OL.tickActor(a, st);
  assert(a.done, `${sessionId} jamais done`);
  st.actors.delete(sessionId);
}

console.log('\nC2 (reviewer) — fragmentation des slots (dimensionnement par plus haut index tenu):');
test('C2 : 5 running (slots 0..4) → r0..r3 sortent COMPLÈTEMENT → r4 (slot 4, tuile la plus basse) reste dans les bornes de la salle travail rendue', () => {
  const st = OL.createState();
  const five = Array.from({ length: 5 }, (_, i) => sess('r' + i, 'running'));
  OL.syncActors(st, snap(five));
  for (const s of five) walkToRest(st.actors.get(s.sessionId), st);
  const r4 = st.actors.get('r4');
  assertEq(r4.slotIdx, 4);
  assertEq(r4.tx, 1); assertEq(r4.ty, 6); // slot 4 = pair 2, colonne 1 → (1,6), salle 7 rangées

  // r0..r3 partent (disparaissent du snapshot) et sortent COMPLÈTEMENT —
  // pas juste purgées, réellement supprimées par l'appelant (M5).
  OL.syncActors(st, snap([sess('r4', 'running')]));
  for (const s of five) if (s.sessionId !== 'r4') fullyExit(s.sessionId, st);

  // Repro reviewer : `state.slots.work.size` est retombé à 1 (fragmenté —
  // seul r4 tient encore un slot), mais r4 est TOUJOURS assis au slot 4
  // (tuile (1,6)). Une taille dérivée du COMPTE (workRoomRows(1) → rows=5)
  // rendrait une salle qui ne contient plus (1,6). Doit rester dans les
  // bornes, DE FAÇON STABLE (pas transitoire : aucune migration ici).
  assertEq(st.slots.work.size, 1); // confirme la fragmentation (sinon le test ne reproduit rien)
  const snapshot = snap([sess('r4', 'running')]);
  const work = OL.roomsFor(snapshot, st).find(x => x.key === 'work');
  assert(r4.tx >= 0 && r4.tx < work.cols && r4.ty >= 0 && r4.ty < work.rows,
    `r4 en (${r4.tx},${r4.ty}) hors bornes de la salle travail rendue (rows=${work.rows})`);
  // slotIdx=4 → pair 2 (0-indexée), il faut donc au moins 3 paires
  // (workPairs) pour que la tuile (1,6) existe — un dimensionnement par
  // COMPTE (logical=1 ou size=1) donnerait workPairs(1)=1, rows=5, et (1,6)
  // serait hors sol. Le fix (maxHeldSlotIdx+1=5) donne workPairs(5)=3,
  // rows=9 : (1,6) est bien dans les bornes, avec de la marge.
  assertEq(work.rows, 9, 'la salle doit rester assez grande pour (1,6) (slot 4 encore tenu), peu importe le compte brut');
});
test('C2 : même scénario en salle Pause — 5 waiting, slots bas partent en premier, le dernier (slot haut) reste dans les bornes', () => {
  const st = OL.createState();
  const five = Array.from({ length: 5 }, (_, i) => sess('p' + i, 'waiting'));
  OL.syncActors(st, snap([], [])); // no-op, garde la forme snap() cohérente
  OL.syncActors(st, snap(five));
  for (const s of five) walkToRest(st.actors.get(s.sessionId), st);
  const p4 = st.actors.get('p4');
  assertEq(p4.slotIdx, 4); // 5e siège du 1er bloc (base) : (4,3)
  assertEq(p4.tx, 4); assertEq(p4.ty, 3);

  OL.syncActors(st, snap([sess('p4', 'waiting')]));
  for (const s of five) if (s.sessionId !== 'p4') fullyExit(s.sessionId, st);

  assertEq(st.slots.break.size, 1); // fragmentation confirmée
  const snapshot = snap([sess('p4', 'waiting')]);
  const brk = OL.roomsFor(snapshot, st).find(x => x.key === 'break');
  assert(p4.tx >= 0 && p4.tx < brk.cols && p4.ty >= 0 && p4.ty < brk.rows,
    `p4 en (${p4.tx},${p4.ty}) hors bornes de la salle pause rendue (rows=${brk.rows})`);
  assertEq(brk.rows, 5, 'p4 tient dans la base (slot 4 < 6) — mais le principe est vérifié : plus haut idx tenu, pas le compte');
});
test('C2 : cas plus sévère en salle Pause — 8 waiting (slot 7, bloc étendu) → les 7 premiers sortent → le 8e reste dans les bornes rendues', () => {
  const st = OL.createState();
  const eight = Array.from({ length: 8 }, (_, i) => sess('q' + i, 'waiting'));
  OL.syncActors(st, snap(eight));
  for (const s of eight) walkToRest(st.actors.get(s.sessionId), st);
  const q7 = st.actors.get('q7');
  assertEq(q7.slotIdx, 7); // 8e siège = bloc étendu (idx 6,7 → within=1 → rowGroup1 → (4,5))
  assertEq(q7.tx, 4); assertEq(q7.ty, 5);

  OL.syncActors(st, snap([sess('q7', 'waiting')]));
  for (const s of eight) if (s.sessionId !== 'q7') fullyExit(s.sessionId, st);

  assertEq(st.slots.break.size, 1); // fragmentation : size=1 mais slotIdx=7 encore tenu
  const snapshot = snap([sess('q7', 'waiting')]);
  const brk = OL.roomsFor(snapshot, st).find(x => x.key === 'break');
  assert(q7.tx >= 0 && q7.tx < brk.cols && q7.ty >= 0 && q7.ty < brk.rows,
    `q7 en (${q7.tx},${q7.ty}) hors bornes de la salle pause rendue (rows=${brk.rows})`);
  assertEq(brk.rows, 7, 'la salle doit rester assez grande pour (4,5) — un dimensionnement par `size` (1) retomberait à rows=5 et laisserait q7 hors sol');
});

console.log('\nC3 (reviewer) — perso gelé en erreur hors-sol (3e variante de la même famille):');
test('C3 : 6 running, s0 migre et erreure à mi-couloir, les 5 autres sortent complètement → s0 (gelé, ty=8) reste dans les bornes rendues', () => {
  const st = OL.createState();
  const six = Array.from({ length: 6 }, (_, i) => sess('s' + i, 'running'));
  OL.syncActors(st, snap(six));
  for (const s of six) walkToRest(st.actors.get(s.sessionId), st);
  assertEq(OL.roomsFor(snap(six), st).find(r => r.key === 'work').rows, 9); // 6 occupants → 3 paires → rows=9

  const s0 = st.actors.get('s0');
  assertEq(s0.tx, 1); assertEq(s0.ty, 2); // slot 0

  // s0 se met à migrer (running → waiting) : marche vers la sortie via le
  // couloir bas (pivot = rows-1 = 8, cf. routeWork).
  const snapAfterWaiting = snap([sess('s0', 'waiting'), sess('s1', 'running'), sess('s2', 'running'), sess('s3', 'running'), sess('s4', 'running'), sess('s5', 'running')]);
  OL.syncActors(st, snapAfterWaiting);
  assertEq(s0.migratingTo, 'break');
  // 8 pas de chemin (2 ticks/pas) pour atteindre (3,8) : 6 pas verticaux
  // ty2→ty8 le long de tx=1, puis 2 pas horizontaux tx1→tx3 le long de ty=8
  // (couloir bas) — mi-couloir, exactement la tuile du repro reviewer.
  for (let i = 0; i < 16; i++) OL.tickActor(s0, st);
  assertEq(s0.tx, 3); assertEq(s0.ty, 8);
  assert(s0.path.length > 0, 's0 doit être encore en marche (mi-couloir), pas arrivé');

  // Erreur en plein couloir : s0 se fige SUR PLACE (fix I2), à (3,8).
  const snapWithError = snap([sess('s0', 'error'), sess('s1', 'running'), sess('s2', 'running'), sess('s3', 'running'), sess('s4', 'running'), sess('s5', 'running')]);
  OL.syncActors(st, snapWithError);
  assertEq(s0.path.length, 0);
  assertEq(s0.tx, 3); assertEq(s0.ty, 8);

  // Les 5 autres sortent COMPLÈTEMENT (running → snapshot vide pour eux, ou
  // simplement absents — sortie + suppression par l'appelant, contrat M5).
  const snapOnlyError = snap([sess('s0', 'error')]);
  OL.syncActors(st, snapOnlyError);
  for (const s of six) if (s.sessionId !== 's0') fullyExit(s.sessionId, st);

  // Repro reviewer : sans le plancher par position réelle (maxActorTyInRoom),
  // sizingCounts (index de slot, C2) donnerait sizing.work=1 (seul le slot 0
  // de s0 reste tenu) → workRoomRows(1)=5 → s0 (ty=8) serait hors sol,
  // DÉFINITIVEMENT (l'erreur ne se résout pas toute seule).
  assertEq(st.slots.work.size, 1); // confirme que C2 seul ne suffirait pas ici (fragmentation aussi présente)
  const work = OL.roomsFor(snapOnlyError, st).find(r => r.key === 'work');
  assert(s0.tx >= 0 && s0.tx < work.cols && s0.ty >= 0 && s0.ty < work.rows,
    `s0 gelé en (${s0.tx},${s0.ty}) hors bornes de la salle travail rendue (rows=${work.rows})`);
  assertEq(work.rows, 9, 'la salle doit rester assez grande pour couvrir ty=8 (s0 gelé), peu importe le compte/index de slot');
});
test('C3 : une fois l\'erreur résolue (s0 reprend sa migration et sort), la salle travail peut enfin rétrécir', () => {
  const st = OL.createState();
  const six = Array.from({ length: 6 }, (_, i) => sess('s' + i, 'running'));
  OL.syncActors(st, snap(six));
  for (const s of six) walkToRest(st.actors.get(s.sessionId), st);
  const s0 = st.actors.get('s0');

  OL.syncActors(st, snap([sess('s0', 'waiting'), sess('s1', 'running'), sess('s2', 'running'), sess('s3', 'running'), sess('s4', 'running'), sess('s5', 'running')]));
  for (let i = 0; i < 16; i++) OL.tickActor(s0, st); // mi-couloir, (3,8)
  OL.syncActors(st, snap([sess('s0', 'error'), sess('s1', 'running'), sess('s2', 'running'), sess('s3', 'running'), sess('s4', 'running'), sess('s5', 'running')]));
  assertEq(s0.path.length, 0);

  const snapOnlyError = snap([sess('s0', 'error')]);
  OL.syncActors(st, snapOnlyError);
  for (const s of six) if (s.sessionId !== 's0') fullyExit(s.sessionId, st);
  assertEq(OL.roomsFor(snapOnlyError, st).find(r => r.key === 'work').rows, 9); // toujours 9 tant que s0 est figé en ty=8

  // Erreur résolue : s0 reprend sa migration interrompue vers la pause (le
  // guard 'down' n'avait touché ni roomKey ni migratingTo), puis sort.
  OL.syncActors(st, snap([sess('s0', 'waiting')]));
  assertEq(s0.migratingTo, 'break');
  assert(s0.path.length > 0, 'la marche doit reprendre depuis (3,8), pas rester figée');
  let ticks = 0;
  while (s0.roomKey === 'work' && ticks < 300) { OL.tickActor(s0, st); ticks++; }
  assertEq(s0.roomKey, 'break');

  // s0 n'est plus dans la salle travail : plus aucun acteur là-bas, la
  // salle peut retomber à sa taille minimale.
  const workAfter = OL.roomsFor(snap([], []), st).find(r => r.key === 'work');
  assertEq(workAfter.rows, 5);
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nrecherche : subagents/workflow/headless, dédup, purge:');
test('subagents (max 6) → acteurs en salle recherche, aux postes latéraux', () => {
  const st = OL.createState();
  const seven = Array.from({ length: 7 }, (_, i) => ({ agentId: 'g' + i }));
  OL.syncActors(st, snap([sess('a', 'running', { subagents: seven })]));
  const subs = [...st.actors.values()].filter(x => x.kind === 'subagent');
  assertEq(subs.length, 6);
  assert(subs.every(x => x.roomKey === 'research'));
});
test('subagent disparu → acteur supprimé au sync suivant', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }] })]));
  assert(st.actors.has('a:sub:g1'));
  OL.syncActors(st, snap([sess('a', 'running')]));
  assert(!st.actors.has('a:sub:g1'));
});
test('workflow → min(running dédup, 4) acteurs meeting en recherche', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 6 }] })]));
  const wf = [...st.actors.values()].filter(x => x.kind === 'meeting');
  assertEq(wf.length, 4);
  assert(wf.every(x => x.roomKey === 'research'));
});
test('workflow terminé → acteurs meeting supprimés', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 3 }] })]));
  OL.syncActors(st, snap([sess('a', 'running', { workflows: [{ runId: 'w', running: 0 }] })]));
  assertEq([...st.actors.values()].filter(x => x.kind === 'meeting').length, 0);
});
test('session background (headless) → acteur direct en recherche, jamais en travail/pause', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([], [sess('h', 'running', { isBackground: true })]));
  const h = [...st.actors.values()].find(x => x.kind === 'headless');
  assert(h, 'pas d\'acteur headless');
  assertEq(h.roomKey, 'research');
  OL.syncActors(st, snap([], [sess('h', 'waiting', { isBackground: true })])); // même en waiting, reste en recherche
  assertEq(h.roomKey, 'research');
});
test('headless disparu → acteur supprimé', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([], [sess('h', 'running')]));
  assert(st.actors.has('h:headless'));
  OL.syncActors(st, snap([], []));
  assert(!st.actors.has('h:headless'));
});
test('purge supprime immédiatement subs/meeting de la session partie (pas de marche de sortie)', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running', { subagents: [{ agentId: 'g1' }], workflows: [{ runId: 'w', running: 2 }] })]));
  OL.syncActors(st, snap([]));
  assert(!st.actors.has('a:sub:g1'));
  assertEq([...st.actors.values()].filter(x => x.kind === 'meeting').length, 0);
  assertEq(st.actors.get('a').activity, 'leave');
});
test('actorsIn trie par ty, ne renvoie que les acteurs de la salle', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running'), sess('b', 'running')]));
  walkToRest(st.actors.get('a'), st); walkToRest(st.actors.get('b'), st);
  const list = OL.actorsIn(st, 'work');
  assert(list.every(x => x.roomKey === 'work'));
  for (let i = 1; i < list.length; i++) assert(list[i].ty >= list[i - 1].ty, 'pas trié par ty');
});

// I3 (revue reviewer) — flip isBackground : la session reste VIVANTE
// (toujours dans liveSessionIds) mais change de classement interactive⇄
// background d'un appel à l'autre. Avant fix, la purge ne testait que
// « sessionId disparu » — un flip laissait l'ancien acteur (mauvais kind,
// id différent de celui créé pour le nouveau classement) orphelin à vie.
test('I3 : flip interactif → headless (isBackground true) — l\'ancien acteur session part (leave), un acteur headless apparaît aussitôt', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([sess('a', 'running')]));
  assert(st.actors.has('a'), 'acteur session absent après création');
  assertEq(st.actors.get('a').kind, 'session');

  // Flip : 'a' bascule en background au snapshot suivant (session TOUJOURS
  // vivante, juste reclassée — ce n'est PAS une disparition).
  OL.syncActors(st, snap([], [sess('a', 'running', { isBackground: true })]));

  // Choix documenté : l'ancien acteur 'session' ne disparaît PAS
  // instantanément — il part comme une disparition normale (leave, marche
  // vers la sortie), pour ne jamais téléporter visuellement le perso.
  const old = st.actors.get('a');
  assert(old, 'l\'ancien acteur session a disparu trop tôt (avant même la marche de sortie)');
  assertEq(old.kind, 'session');
  assertEq(old.activity, 'leave');
  assertEq(old.migratingTo, null);

  // Le nouvel acteur headless, lui, apparaît immédiatement (pas de marche
  // pour les headless, cf. syncHeadlessActor).
  assert(st.actors.has('a:headless'), 'acteur headless absent après le flip');
  assertEq(st.actors.get('a:headless').kind, 'headless');
  assertEq(st.actors.get('a:headless').roomKey, 'research');

  // L'ancien acteur 'session' finit par atteindre la porte et devenir done
  // (contrat M5 : l'appelant le supprime alors de state.actors).
  for (let i = 0; i < 300 && !old.done; i++) OL.tickActor(old, st);
  assertEq(old.done, true, 'l\'ancien acteur session ne devient jamais done — orphelin à vie');
});

test('I3 : flip headless → interactif (isBackground false) — l\'ancien acteur headless est purgé immédiatement, un acteur session apparaît', () => {
  const st = OL.createState();
  OL.syncActors(st, snap([], [sess('h', 'running')]));
  assert(st.actors.has('h:headless'), 'acteur headless absent après création');

  // Flip : 'h' bascule en interactive au snapshot suivant (session TOUJOURS
  // vivante — pas une disparition).
  OL.syncActors(st, snap([sess('h', 'running')]));

  // Choix documenté : contrairement au perso principal (qui part par la
  // porte), le headless n'a pas de représentation "en train de sortir" —
  // suppression immédiate, symétrique de sa disparition normale.
  assert(!st.actors.has('h:headless'), 'l\'ancien acteur headless est resté orphelin après le flip');
  assert(st.actors.has('h'), 'nouvel acteur session absent après le flip');
  assertEq(st.actors.get('h').kind, 'session');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nanimFor:');
test('en mouvement → walk.<dir>', () => {
  assertEq(OL.animFor({ charIdx: 3, activity: 'work', path: [{ tx: 5, ty: 2 }], dir: 'left' }), 'char3.walk.left');
});
test('work/think au bureau → idle.up (dos au spectateur), call → phone.right, down → hurt', () => {
  assertEq(OL.animFor({ charIdx: 0, activity: 'work', path: [], dir: 'down' }), 'char0.idle.up');
  assertEq(OL.animFor({ charIdx: 0, activity: 'think', path: [], dir: 'down' }), 'char0.idle.up');
  assertEq(OL.animFor({ charIdx: 1, activity: 'call', path: [], dir: 'down' }), 'char1.phone.right');
  assertEq(OL.animFor({ charIdx: 1, activity: 'down', path: [], dir: 'down' }), 'char1.hurt');
});
test('relax (salle pause) → idle.down, face caméra (pas de bureau à regarder)', () => {
  assertEq(OL.animFor({ charIdx: 4, activity: 'relax', path: [], dir: 'down' }), 'char4.idle.down');
});
test('work en réunion (kind meeting) → idle.down, pas idle.up', () => {
  assertEq(OL.animFor({ charIdx: 2, activity: 'work', kind: 'meeting', path: [], dir: 'up' }), 'char2.idle.down');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nemoteFor (fonction pure, priorité bell > état > outil, inchangé):');
test('priorité 1 : enveloppe (bell active) prime sur tout état', () => {
  assertEq(OL.emoteFor(sess('a', 'thinking'), true), 'emote.mail');
  assertEq(OL.emoteFor(sess('a', 'running', { lastTool: 'Bash' }), true), 'emote.mail');
  assertEq(OL.emoteFor(sess('a', 'pending'), true), 'emote.mail');
  assertEq(OL.emoteFor(sess('a', 'error'), true), 'emote.mail');
  assertEq(OL.emoteFor(sess('a', 'waiting'), true), 'emote.mail');
});
test('priorité 2 : émote d\'état sans bell (thinking/pending/error/waiting)', () => {
  assertEq(OL.emoteFor(sess('a', 'thinking'), false), 'emote.think');
  assertEq(OL.emoteFor(sess('a', 'pending'), false), 'emote.alert');
  assertEq(OL.emoteFor(sess('a', 'error'), false), 'emote.angry');
  assertEq(OL.emoteFor(sess('a', 'waiting'), false), 'emote.zzz');
});
test('priorité 3 : running → toujours emote.work (marteau)', () => {
  for (const lastTool of ['Bash', 'Read', 'Task', 'mcp__qonto__x', null, undefined]) {
    assertEq(OL.emoteFor(sess('a', 'running', { lastTool }), false), 'emote.work');
  }
});
test('null si pas de bulle : état inconnu, ou objet sans state (ex. acteur subagent)', () => {
  assertEq(OL.emoteFor(sess('a', 'some-unknown-state'), false), null);
  assertEq(OL.emoteFor({ kind: 'subagent', activity: 'work' }, false), null);
  assertEq(OL.emoteFor({}, false), null);
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\nlabelFor (étiquette pixel, 8 car. max, projet parent pour recherche):');
test('acteur session → nom de son propre projet, tronqué à 8', () => {
  assertEq(OL.labelFor({ kind: 'session' }, sess('a', 'running', { projectName: 'aby-claude-watcher' })), 'aby-clau');
});
test('nom court non tronqué', () => {
  assertEq(OL.labelFor({ kind: 'session' }, sess('a', 'running', { projectName: 'abc' })), 'abc');
});
test('customName prioritaire sur projectName si présent', () => {
  assertEq(OL.labelFor({ kind: 'session' }, sess('a', 'running', { projectName: 'x', customName: 'mon-nom-perso' })), 'mon-nom-');
});
test('acteur subagent/meeting/headless → étiquette = projet PARENT (la session passée est celle du parent)', () => {
  assertEq(OL.labelFor({ kind: 'subagent' }, sess('a', 'running', { projectName: 'parent-project' })), 'parent-p');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
