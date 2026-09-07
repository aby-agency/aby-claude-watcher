// test/presence.test.js
// Module pur : lecture de la présence CLI (session.json) + décision d'état.
// Run via `node test/presence.test.js`.
const assert = require('assert');
const { readPresence, presenceDecision, DIALOG_OPEN } = require('../presence');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nreadPresence:');
test('status valide + statusUpdatedAt numérique → objet', () => {
  const p = readPresence({ status: 'idle', statusUpdatedAt: 1000, waitingFor: undefined });
  assert.deepStrictEqual(p, { status: 'idle', waitingFor: undefined, statusUpdatedAt: 1000 });
});
test('waitingFor string conservé', () => {
  const p = readPresence({ status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: 5 });
  assert.strictEqual(p.waitingFor, 'permission prompt');
});
test('waitingFor non string → undefined', () => {
  const p = readPresence({ status: 'waiting', waitingFor: 42, statusUpdatedAt: 5 });
  assert.strictEqual(p.waitingFor, undefined);
});
test('status absent → null (CLI ancien)', () => {
  assert.strictEqual(readPresence({ pid: 1, sessionId: 'x', updatedAt: 3 }), null);
});
test('status inconnu → null (jamais interprété)', () => {
  assert.strictEqual(readPresence({ status: 'compacting', statusUpdatedAt: 5 }), null);
});
test('statusUpdatedAt absent ou non numérique → null', () => {
  assert.strictEqual(readPresence({ status: 'idle' }), null);
  assert.strictEqual(readPresence({ status: 'idle', statusUpdatedAt: '5' }), null);
});
test('data non objet → null', () => {
  assert.strictEqual(readPresence(null), null);
  assert.strictEqual(readPresence('x'), null);
});

console.log('\npresenceDecision:');
const T0 = 1_000_000; // démarrage du watcher
const later = T0 + 10_000;
const earlier = T0 - 10_000;
function decide(status, currentState, extra = {}) {
  const { waitingFor, statusUpdatedAt = later, stateSince = null, watcherStartedAt = T0 } = extra;
  return presenceDecision({
    presence: { status, waitingFor, statusUpdatedAt },
    currentState, stateSince, watcherStartedAt,
  });
}

// idle
test('idle sur thinking/running/pending → waiting, trigger presence:idle', () => {
  for (const s of ['thinking', 'running', 'pending']) {
    const d = decide('idle', s);
    assert.strictEqual(d.target, 'waiting', s);
    assert.strictEqual(d.trigger, 'presence:idle');
    assert.strictEqual(d.mute, false);
  }
});
test('idle sur waiting → no-op, pas de mute', () => {
  const d = decide('idle', 'waiting');
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.mute, false);
  assert.strictEqual(d.shell, false);
  assert.strictEqual(d.dialogOpen, false);
});

// shell
test('shell sur running → waiting + shell + mute', () => {
  const d = decide('shell', 'running');
  assert.strictEqual(d.target, 'waiting');
  assert.strictEqual(d.trigger, 'presence:shell');
  assert.strictEqual(d.shell, true);
  assert.strictEqual(d.mute, true);
});
test('shell sur waiting → no-op + shell + mute', () => {
  const d = decide('shell', 'waiting');
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.shell, true);
  assert.strictEqual(d.mute, true);
});

// waiting (dialogue bloquant)
test('waiting/permission prompt sur running → pending + waitingFor', () => {
  const d = decide('waiting', 'running', { waitingFor: 'permission prompt' });
  assert.strictEqual(d.target, 'pending');
  assert.strictEqual(d.trigger, 'presence:waiting');
  assert.strictEqual(d.waitingFor, 'permission prompt');
  assert.strictEqual(d.mute, false);
});
test('waiting/input needed sur waiting → pending', () => {
  assert.strictEqual(decide('waiting', 'waiting', { waitingFor: 'input needed' }).target, 'pending');
});
test('waiting sans waitingFor → pending quand même (valeur par défaut CLI = permission prompt)', () => {
  const d = decide('waiting', 'running');
  assert.strictEqual(d.target, 'pending');
  assert.strictEqual(d.waitingFor, null);
});
test('waiting sur pending → no-op mais waitingFor rafraîchi', () => {
  const d = decide('waiting', 'pending', { waitingFor: 'sandbox request' });
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.waitingFor, 'sandbox request');
});

// waiting / dialog open
test('dialog open sur running → waiting + dialogOpen + mute, jamais pending', () => {
  const d = decide('waiting', 'running', { waitingFor: DIALOG_OPEN });
  assert.strictEqual(d.target, 'waiting');
  assert.strictEqual(d.trigger, 'presence:dialog');
  assert.strictEqual(d.dialogOpen, true);
  assert.strictEqual(d.mute, true);
});
test('dialog open sur pending → waiting (le prompt a laissé place à un menu)', () => {
  assert.strictEqual(decide('waiting', 'pending', { waitingFor: DIALOG_OPEN }).target, 'waiting');
});
test('dialog open sur waiting → no-op + dialogOpen + mute', () => {
  const d = decide('waiting', 'waiting', { waitingFor: DIALOG_OPEN });
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.dialogOpen, true);
  assert.strictEqual(d.mute, true);
});

// busy
test('busy sur pending → running (question traitée)', () => {
  const d = decide('busy', 'pending', { stateSince: T0 + 5_000 });
  assert.strictEqual(d.target, 'running');
  assert.strictEqual(d.trigger, 'presence:busy');
});
test('busy sur waiting → no-op + mute (délégation)', () => {
  const d = decide('busy', 'waiting');
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.mute, true);
});
test('busy sur thinking/running → no-op sans mute', () => {
  for (const s of ['thinking', 'running']) {
    const d = decide('busy', s);
    assert.strictEqual(d.target, null, s);
    assert.strictEqual(d.mute, false, s);
  }
});

// garde d'ordre temporel
test('busy ANTÉRIEUR à un pending posé par le hook → ignoré', () => {
  const d = decide('busy', 'pending', { statusUpdatedAt: T0 + 1_000, stateSince: T0 + 2_000 });
  assert.strictEqual(d.target, null);
});
test('idle ANTÉRIEUR à un pending → ignoré aussi', () => {
  const d = decide('idle', 'pending', { statusUpdatedAt: T0 + 1_000, stateSince: T0 + 2_000 });
  assert.strictEqual(d.target, null);
});
test('garde inactive si stateSince null', () => {
  const d = decide('busy', 'pending', { statusUpdatedAt: T0 + 1_000, stateSince: null });
  assert.strictEqual(d.target, 'running');
});
test('garde inactive hors pending : idle antérieur sur running → waiting', () => {
  const d = decide('idle', 'running', { statusUpdatedAt: T0 + 1_000, stateSince: T0 + 2_000 });
  assert.strictEqual(d.target, 'waiting');
});

// at / silent
test('at = statusUpdatedAt, jamais Date.now()', () => {
  assert.strictEqual(decide('idle', 'running', { statusUpdatedAt: 4242 }).at, 4242);
});
test('silent quand statusUpdatedAt < watcherStartedAt', () => {
  assert.strictEqual(decide('idle', 'running', { statusUpdatedAt: earlier }).silent, true);
  assert.strictEqual(decide('idle', 'running', { statusUpdatedAt: later }).silent, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
