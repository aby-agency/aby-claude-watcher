// Tests for island-model.js. Run: node test/island-model.test.js
const { buildIsland, notchedInternalDisplay, menuBarHeight, islandLayout, CAP_PER_WING, bannerPayload } = require('../island-model.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// Display helpers — shapes mirror Electron's screen.getAllDisplays()
const notched = { internal: true, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
const plain = { internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const external = { internal: false, bounds: { x: 1512, y: 0, width: 2560, height: 1440 }, workArea: { x: 1512, y: 25, width: 2560, height: 1415 } };

console.log('\nnotchedInternalDisplay:');
test('detects notched internal display (menu bar ≥ 30)', () => {
  assertEq(notchedInternalDisplay([external, notched]) === notched, true);
});
test('plain internal display → null', () => {
  assertEq(notchedInternalDisplay([plain, external]), null);
});
test('no displays → null', () => {
  assertEq(notchedInternalDisplay([]), null);
});
test('menuBarHeight subtracts bounds.y (secondary display coords are absolute)', () => {
  const below = { internal: true, bounds: { x: 0, y: 900, width: 1512, height: 982 }, workArea: { x: 0, y: 937, width: 1512, height: 945 } };
  assertEq(menuBarHeight(below), 37);
  assertEq(notchedInternalDisplay([below]) === below, true);
});

// Session factory
const NOW = 1_000_000_000_000;
let n = 0;
function sess(state, opts = {}) {
  n++;
  return {
    sessionId: opts.id || `s${n}`,
    projectName: opts.name || `proj${n}`,
    customName: opts.customName || null,
    state: { name: state },
    isBackground: !!opts.bg,
    lastEventTime: opts.lastEventTime !== undefined ? opts.lastEventTime : NOW - 120000,
    startedAt: new Date(NOW - (opts.age || n) * 60000).toISOString(),
  };
}

console.log('\nbuildIsland:');
test('splits interactive (left) and background (right)', () => {
  const m = buildIsland([sess('running'), sess('waiting', { bg: true })], {}, NOW);
  assertEq(m.left.leds.length, 1);
  assertEq(m.right.leds.length, 1);
});
test('caps each wing at CAP_PER_WING with a more count', () => {
  const many = Array.from({ length: 6 }, () => sess('running'));
  const m = buildIsland(many, {}, NOW);
  assertEq(m.left.leds.length, CAP_PER_WING);
  assertEq(m.left.more, 2);
  assertEq(m.right.more, 0);
});
test('led carries sessionId and state name', () => {
  const m = buildIsland([sess('pending', { id: 'abc' })], {}, NOW);
  assertEq(m.left.leds[0], { sessionId: 'abc', state: 'pending' });
});
test('sessionOrder from config wins, then newest first', () => {
  const a = sess('running', { id: 'a', age: 10 });
  const b = sess('running', { id: 'b', age: 1 });
  const c = sess('running', { id: 'c', age: 5 });
  const m = buildIsland([a, b, c], { sessionOrder: ['c'] }, NOW);
  assertEq(m.rows.map(r => r.sessionId), ['c', 'b', 'a']);
});
test('row name prefers customName over projectName', () => {
  const m = buildIsland([sess('running', { name: 'proj', customName: 'mon-nom' })], {}, NOW);
  assertEq(m.rows[0].name, 'mon-nom');
});
test('minutes set for attention states (pending/error/waiting), null otherwise', () => {
  const m = buildIsland([
    sess('pending', { lastEventTime: NOW - 120000 }),
    sess('running', { lastEventTime: NOW - 120000 }),
  ], {}, NOW);
  assertEq(m.rows[0].minutes, 2);
  assertEq(m.rows[1].minutes, null);
});
test('minutes null when lastEventTime missing', () => {
  const m = buildIsland([sess('waiting', { lastEventTime: null })], {}, NOW);
  assertEq(m.rows[0].minutes, null);
});
test('backgroundRows flagged isBackground', () => {
  const m = buildIsland([sess('running', { bg: true })], {}, NOW);
  assertEq(m.rows.length, 0);
  assertEq(m.backgroundRows[0].isBackground, true);
});

console.log('\nislandLayout:');
// Mesure réelle (MBP 16" 1728pt) : encoche 185pt décentrée de 7pt à gauche.
test('centers window on the MEASURED notch, gap = notch + margin', () => {
  const d = { bounds: { x: 0, y: 0, width: 1728, height: 1117 } };
  const l = islandLayout(d, { left: 771, width: 185 }, 460);
  // centre encoche = 771 + 92.5 = 863.5 → x = 863.5 - 230 arrondi
  assertEq(l, { x: 634, gapPx: 197 });
});
test('secondary display coords: bounds.x is added', () => {
  const d = { bounds: { x: 2000, y: 0, width: 1728, height: 1117 } };
  assertEq(islandLayout(d, { left: 771, width: 185 }, 460).x, 2634);
});
test('no measurement → window centered on display, default gap 180', () => {
  const d = { bounds: { x: 0, y: 0, width: 1728, height: 1117 } };
  assertEq(islandLayout(d, null, 460), { x: 634, gapPx: 180 });
});
test('invalid measurement (width <= 0, negative left) → fallback', () => {
  const d = { bounds: { x: 0, y: 0, width: 1728, height: 1117 } };
  assertEq(islandLayout(d, { left: 771, width: 0 }, 460), { x: 634, gapPx: 180 });
  assertEq(islandLayout(d, { left: -5, width: 185 }, 460), { x: 634, gapPx: 180 });
});

console.log('\nbannerPayload:');
test('customName prioritaire, puis projectName, puis fallback', () => {
  const s = { sessionId: 'x', projectName: 'proj', state: { name: 'waiting' } };
  assertEq(bannerPayload(s, 'mon-nom'), { sessionId: 'x', name: 'mon-nom', state: 'waiting' });
  assertEq(bannerPayload(s, null).name, 'proj');
  assertEq(bannerPayload({ sessionId: 'y', state: { name: 'pending' } }, null).name, 'Claude Code');
});
test('state extrait du nom d\'état ; null si absent', () => {
  assertEq(bannerPayload({ sessionId: 'z', projectName: 'p', state: { name: 'pending' } }, null).state, 'pending');
  assertEq(bannerPayload({ sessionId: 'z', projectName: 'p' }, null).state, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
