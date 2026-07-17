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
test('exporte BASE_COLS/BASE_ROWS (plus ROOM_COLS/ROOM_ROWS)', () => {
  assertEq(OL.BASE_COLS, 7); assertEq(OL.BASE_ROWS, 5);
  assertEq(OL.ROOM_COLS, undefined); assertEq(OL.ROOM_ROWS, undefined);
});
test('pièce de base 7×5, sans sièges latéraux ni réunion', () => {
  const r = OL.roomFor(sess('a', 'running'));
  assertEq(r.cols, 7); assertEq(r.rows, 5);
  // le seul sideDesk de la pièce de base est le comptoir sous la tasse de café
  assertEq(r.statics.filter(x => x.frame === 'sideDesk').length, 1);
  assert(!r.statics.some(x => x.frame === 'laptop'), 'pas de laptop sans subagent');
  assert(!r.statics.some(x => x.frame === 'meetingTable'));
});
test('subagents → +1 colonne (8 de large)', () => {
  const r = OL.roomFor(sess('a', 'running', { subagents: [{ agentId: 'g1' }] }));
  assertEq(r.cols, 8); assertEq(r.rows, 5);
  assert(r.statics.some(x => x.frame === 'sideDesk'));
});
test('chaque subagent a une chaise et un laptop sur sa table (perso au SUD de sa table)', () => {
  const r = OL.roomFor(sess('a', 'running', { subagents: [{ agentId: 'g1' }, { agentId: 'g2' }] }));
  const seats = r.zones.sideSeats;
  for (const seat of seats) {
    assert(r.statics.some(x => x.frame === 'chairFront' && x.tx === seat.tx && x.ty === seat.ty),
      `pas de chaise au siège (${seat.tx},${seat.ty})`);
    // La table/laptop est au NORD du perso (dos au spectateur, face à l'écran).
    assert(r.statics.some(x => x.frame === 'laptop' && x.tx === seat.tx && x.ty === seat.ty - 1),
      `pas de laptop à la table (${seat.tx},${seat.ty - 1})`);
  }
});
test('un seul subagent → chaise/laptop uniquement au 1er siège', () => {
  const r = OL.roomFor(sess('a', 'running', { subagents: [{ agentId: 'g1' }] }));
  assertEq(r.statics.filter(x => x.frame === 'laptop').length, 1);
  assertEq(r.statics.filter(x => x.frame === 'chairFront' && x.tx === r.zones.sideSeats[1].tx && x.ty === r.zones.sideSeats[1].ty).length, 0);
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
test('zones aux positions spécifiées', () => {
  const z = OL.roomFor(sess('a', 'running')).zones;
  // Vue par-dessus l'épaule : le perso est au SUD du bureau (1,2), pas au nord.
  assertEq(z.deskChar.tx, 1); assertEq(z.deskChar.ty, 3);
  assertEq(z.door.tx, 5); assertEq(z.door.ty, 1);
  assertEq(z.coffee.tx, 2); assertEq(z.coffee.ty, 4);
  assertEq(z.sideSeats.length, 2);
});
test('statics : desk avec screen, machine café, porte', () => {
  const room = OL.roomFor(sess('a', 'running'));
  const st = room.statics;
  assert(st.some(x => x.frame === 'deskSetup' && x.screen === 'a'), 'pas de screen');
  assert(st.some(x => x.frame === 'coffeeMachine'), 'pas de machine');
  assert(st.some(x => x.frame === 'door'), 'pas de porte');
  assert(st.some(x => x.frame === 'chairFront' && x.tx === room.zones.deskChar.tx && x.ty === room.zones.deskChar.ty),
    'pas de chaise au bureau principal');
  const coffeeMachineStatic = st.find(x => x.frame === 'coffeeMachine');
  assert(typeof coffeeMachineStatic.dy === 'number' && coffeeMachineStatic.dy < 0, 'tasse pas décalée sur le comptoir');
  assert(st.some(x => x.frame === 'sideDesk' && x.tx === coffeeMachineStatic.tx && x.ty === coffeeMachineStatic.ty),
    'pas de comptoir sous la tasse');
  // La chaise du bureau principal ne doit pas être dans la même colonne que
  // le point café (2,4) ni que la machine à café : sinon le perso debout là
  // recouvre la chaise vide (v23 : régression corrigée en décalant la colonne).
  assert(room.zones.deskChar.tx !== room.zones.coffee.tx, 'chaise alignée avec le point café');
  assert(room.zones.deskChar.tx !== coffeeMachineStatic.tx, 'chaise alignée avec la machine à café');
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
  assertEq(a.tx, 5); assertEq(a.ty, 1);
  const dest = a.path[a.path.length - 1];
  assertEq(dest.tx, 1); assertEq(dest.ty, 3);
});
test('spawn (porte→chaise) contourne le bureau : le path ne traverse pas (1,2)/(2,2)', () => {
  const st = OL.createState();
  const s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const onDesk = (p) => (p.tx === 1 && p.ty === 2) || (p.tx === 2 && p.ty === 2);
  assert(!a.path.some(onDesk), 'le path de spawn traverse le bureau');
});
test('leave (chaise→porte) contourne le bureau : le path ne traverse pas (1,2)/(2,2)', () => {
  const st = OL.createState();
  const s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const zones = OL.roomFor(s).zones;
  while (a.path.length > 0) OL.tickActor(a, zones);   // atteint la chaise (1,3)
  OL.purge(st, new Set());                             // déclenche le leave → porte
  const onDesk = (p) => (p.tx === 1 && p.ty === 2) || (p.tx === 2 && p.ty === 2);
  assert(!a.path.some(onDesk), 'le path de leave traverse le bureau');
});
test('leave depuis le café (2,4) évite la plante (5,4) et le bureau (1,2)/(2,2)', () => {
  const st = OL.createState();
  const s = sess('a', 'waiting');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const zones = OL.roomFor(s).zones;
  while (a.path.length > 0) OL.tickActor(a, zones);   // atteint le café (2,4)
  assertEq(a.tx, 2); assertEq(a.ty, 4);
  OL.purge(st, new Set());                             // déclenche le leave → porte
  const onDesk = (p) => (p.tx === 1 && p.ty === 2) || (p.tx === 2 && p.ty === 2);
  const onPlant = (p) => p.tx === 5 && p.ty === 4;
  assert(!a.path.some(onDesk), 'le path de leave depuis le café traverse le bureau');
  assert(!a.path.some(onPlant), 'le path de leave depuis le café traverse la plante');
});
test('l\'acteur atteint sa chaise en marchant', () => {
  const st = OL.createState();
  const s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const zones = OL.roomFor(s).zones;
  for (let i = 0; i < 100 && a.path.length > 0; i++) OL.tickActor(a, zones);
  assertEq(a.tx, 1); assertEq(a.ty, 3);
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
  assertEq(dest.tx, 1); assertEq(dest.ty, 3);
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
test('session ressuscitée après un leave abouti → done repasse à false, path vers la chaise', () => {
  const st = OL.createState();
  const s = sess('a', 'running');
  OL.syncSession(st, s);
  const a = st.actors.get('a');
  const zones = OL.roomFor(s).zones;
  while (a.path.length > 0) OL.tickActor(a, zones);
  OL.purge(st, new Set());
  for (let i = 0; i < 100 && !a.done; i++) OL.tickActor(a, zones);
  assert(a.done, 'jamais done');
  OL.syncSession(st, sess('a', 'running'));
  assertEq(a.done, false);
  const dest = a.path[a.path.length - 1];
  assertEq(dest.tx, 1); assertEq(dest.ty, 3);
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
test('work/think au bureau → idle.up (dos au spectateur), call → phone.right, down → hurt', () => {
  assertEq(OL.animFor({ charIdx: 0, activity: 'work', path: [], dir: 'down' }), 'char0.idle.up');
  assertEq(OL.animFor({ charIdx: 0, activity: 'think', path: [], dir: 'down' }), 'char0.idle.up');
  assertEq(OL.animFor({ charIdx: 1, activity: 'call', path: [], dir: 'down' }), 'char1.phone.right');
  assertEq(OL.animFor({ charIdx: 1, activity: 'down', path: [], dir: 'down' }), 'char1.hurt');
});
test('work en réunion (kind meeting) → idle.down, pas idle.up', () => {
  assertEq(OL.animFor({ charIdx: 2, activity: 'work', kind: 'meeting', path: [], dir: 'up' }), 'char2.idle.down');
});
test('coffee arrivé → idle.left (machine à gauche du point café)', () => {
  assertEq(OL.animFor({ charIdx: 1, activity: 'coffee', path: [], dir: 'left' }), 'char1.idle.left');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
