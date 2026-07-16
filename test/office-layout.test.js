// test/office-layout.test.js — Run: node test/office-layout.test.js
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
function snap(interactive, background, workflows) {
  return { interactive: interactive || [], background: background || [], workflows: workflows || [] };
}

console.log('\ncharIndexFor:');
test('stable pour un même nom', () => {
  assertEq(OL.charIndexFor('aby-claude-watcher'), OL.charIndexFor('aby-claude-watcher'));
});
test('dans [0,9]', () => {
  for (const n of ['a', 'watcher', 'x/y', '']) {
    const i = OL.charIndexFor(n);
    assert(i >= 0 && i <= 9 && Number.isInteger(i), `hors bornes: ${i}`);
  }
});

console.log('\nactivityFor:');
test('mapping complet', () => {
  assertEq(OL.activityFor('thinking'), 'think');
  assertEq(OL.activityFor('running'), 'work');
  assertEq(OL.activityFor('waiting'), 'coffee');
  assertEq(OL.activityFor('pending'), 'call');
  assertEq(OL.activityFor('error'), 'down');
});

console.log('\nslots (stabilité des bureaux):');
test('une session garde son bureau quand une autre part', () => {
  const st = OL.createOfficeState();
  OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]));
  const roomBefore = OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]));
  const deskC = roomBefore.zones.desks.get('c');
  // 'b' part → 'c' ne bouge pas
  const roomAfter = OL.layoutRoom(st, snap([sess('a', 'running'), sess('c', 'running')]));
  assertEq(roomAfter.zones.desks.get('c').tx, deskC.tx);
  assertEq(roomAfter.zones.desks.get('c').ty, deskC.ty);
});
test('un slot libéré est réutilisé par la session suivante', () => {
  const st = OL.createOfficeState();
  OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running')]));
  const room1 = OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running')]));
  const deskA = room1.zones.desks.get('a');
  OL.layoutRoom(st, snap([sess('b', 'running')]));           // a part
  const room2 = OL.layoutRoom(st, snap([sess('b', 'running'), sess('d', 'running')])); // d arrive
  assertEq(room2.zones.desks.get('d').tx, deskA.tx);          // d prend le slot de a
  assertEq(room2.zones.desks.get('d').ty, deskA.ty);
});

console.log('\ncroissance de la pièce:');
test('la 4e session ouvre une rangée de bureaux en dessous', () => {
  const st = OL.createOfficeState();
  const r4 = OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running'), sess('d', 'running')]));
  assertEq(r4.zones.desks.get('d').ty, r4.zones.desks.get('a').ty + 3);
  assertEq(r4.zones.desks.get('d').tx, r4.zones.desks.get('a').tx);
});
test('la pièce grandit avec les rangées (au-delà du minimum de 8)', () => {
  const s6 = OL.createOfficeState(), s9 = OL.createOfficeState();
  const many = n => Array.from({ length: n }, (_, i) => sess('s' + i, 'running'));
  const r6 = OL.layoutRoom(s6, snap(many(6)));
  const r9 = OL.layoutRoom(s9, snap(many(9)));
  assert(r9.rows === r6.rows + 3, `attendu +3 rangées, r6=${r6.rows} r9=${r9.rows}`);
});
test('cols constant à 16', () => {
  const st = OL.createOfficeState();
  assertEq(OL.layoutRoom(st, snap([sess('a', 'running')])).cols, 16);
});
test('au-delà de MAX_DESKS, excédent en back-office (overflow)', () => {
  const st = OL.createOfficeState();
  const many = []; for (let i = 0; i < OL.MAX_DESKS + 3; i++) many.push(sess('s' + i, 'running'));
  const room = OL.layoutRoom(st, snap(many));
  assertEq(room.zones.desks.size, OL.MAX_DESKS);
  assertEq(room.zones.overflow, 3);
});

console.log('\nzones:');
test('workflow actif → sièges de réunion', () => {
  const st = OL.createOfficeState();
  const room = OL.layoutRoom(st, snap([sess('a', 'running', { workflows: [{ runId: 'wf_1', name: 'rev', running: 4 }] })]));
  assert(room.zones.meeting.length >= 4, `sièges: ${room.zones.meeting.length}`);
  assert(room.zones.meeting.length <= 6, 'plafond 6');
});
test('sessions background → bureaux back-office séparés', () => {
  const st = OL.createOfficeState();
  const room = OL.layoutRoom(st, snap([sess('a', 'running')], [sess('bg1', 'running', { isBackground: true })]));
  assert(room.zones.backDesks.get('bg1'), 'bg1 sans bureau back-office');
  assert(room.zones.backDesks.get('bg1').ty > room.zones.desks.get('a').ty, 'back-office pas en bas');
});

console.log('\nsyncActors + tickActor:');
test('nouvelle session → acteur spawn à la porte avec path vers le bureau', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  assert(actor, 'pas d\'acteur');
  assertEq(actor.tx, room.zones.door.tx);
  assert(actor.path.length > 0, 'pas de chemin');
});
test('l\'acteur atteint son bureau en marchant', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  const desk = room.zones.desks.get('a');
  for (let i = 0; i < 200 && actor.path.length > 0; i++) OL.tickActor(actor, room.zones);
  assertEq(actor.tx, desk.tx + 1); // position perso = tx+1 dans la cellule
  assertEq(actor.ty, desk.ty);
});
test('waiting → path vers le café ; retour running en route → path retourné vers le bureau', () => {
  const st = OL.createOfficeState();
  let s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  while (actor.path.length > 0) OL.tickActor(actor, room.zones); // arrive au bureau
  s = snap([sess('a', 'waiting')]);
  OL.syncActors(st, s);
  assert(actor.path.length > 0, 'pas de départ vers le café');
  OL.tickActor(actor, room.zones); // fait quelques pas
  OL.tickActor(actor, room.zones);
  s = snap([sess('a', 'running')]);
  OL.syncActors(st, s);
  const dest = actor.path[actor.path.length - 1];
  assertEq(dest.tx, room.zones.desks.get('a').tx + 1); // il fait demi-tour
  assertEq(dest.ty, room.zones.desks.get('a').ty);
});
test('session supprimée → activity leave, done après la porte', () => {
  const st = OL.createOfficeState();
  let s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  while (actor.path.length > 0) OL.tickActor(actor, room.zones);
  OL.syncActors(st, snap([]));                    // purge
  assertEq(actor.activity, 'leave');
  for (let i = 0; i < 200 && !actor.done; i++) OL.tickActor(actor, room.zones);
  assert(actor.done, 'jamais done');
});
test('subagents → acteurs kind=subagent aux side-desks (max 2)', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running', { subagents: [
    { agentId: 'g1' }, { agentId: 'g2' }, { agentId: 'g3' },
  ] })]);
  OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const subs = [...st.actors.values()].filter(a => a.kind === 'subagent');
  assertEq(subs.length, 2);
});
test('workflow → acteurs kind=meeting (min(running,6))', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running', { workflows: [{ runId: 'wf_1', name: 'rev', running: 8 }] })]);
  OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  assertEq([...st.actors.values()].filter(a => a.kind === 'meeting').length, 6);
});

console.log('\nanimFor:');
test('acteur en mouvement → walk.<dir>', () => {
  const a = { charIdx: 3, activity: 'coffee', path: [{ tx: 5, ty: 2 }], dir: 'left' };
  assertEq(OL.animFor(a), 'char3.walk.left');
});
test('work au bureau → idle.down', () => {
  assertEq(OL.animFor({ charIdx: 0, activity: 'work', path: [], dir: 'down' }), 'char0.idle.down');
});
test('call → phone.right, down → hurt, coffee arrivé → idle.right', () => {
  assertEq(OL.animFor({ charIdx: 1, activity: 'call', path: [], dir: 'down' }), 'char1.phone.right');
  assertEq(OL.animFor({ charIdx: 1, activity: 'down', path: [], dir: 'down' }), 'char1.hurt');
  assertEq(OL.animFor({ charIdx: 1, activity: 'coffee', path: [], dir: 'right' }), 'char1.idle.right');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
