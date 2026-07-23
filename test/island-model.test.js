// Tests for island-model.js. Run: node test/island-model.test.js
const { buildIsland, islandLayout, bannerPayload } = require('../island-model.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

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
  const m = buildIsland([sess('running'), sess('waiting', { bg: true })], {});
  assertEq(m.left.leds.length, 1);
  assertEq(m.right.leds.length, 1);
});
test('wings aggregate per state with counts, urgent states first', () => {
  const m = buildIsland([sess('running'), sess('running'), sess('waiting'), sess('pending'), sess('running')], {});
  assertEq(m.left.leds, [
    { state: 'pending', count: 1 },
    { state: 'waiting', count: 1 },
    { state: 'running', count: 3 },
  ]);
});
test('no cap: many sessions collapse into one led per state', () => {
  const many = Array.from({ length: 9 }, () => sess('running'));
  assertEq(buildIsland(many, {}).left.leds, [{ state: 'running', count: 9 }]);
});
test('sessionOrder from config wins, then newest first', () => {
  const a = sess('running', { id: 'a', age: 10 });
  const b = sess('running', { id: 'b', age: 1 });
  const c = sess('running', { id: 'c', age: 5 });
  const m = buildIsland([a, b, c], { sessionOrder: ["c"] });
  assertEq(m.rows.map(r => r.sessionId), ['c', 'b', 'a']);
});
test('row name prefers customName over projectName', () => {
  const m = buildIsland([sess('running', { name: 'proj', customName: 'mon-nom' })], {});
  assertEq(m.rows[0].name, 'mon-nom');
});
test('backgroundRows flagged isBackground', () => {
  const m = buildIsland([sess('running', { bg: true })], {});
  assertEq(m.rows.length, 0);
  assertEq(m.backgroundRows[0].isBackground, true);
});
test('rows carry subagents (label fallback desc→type→subagent) and workflows', () => {
  const s = sess('running');
  s.subagents = [
    { agentId: 'a1', description: 'Review Task 2', agentType: 'general-purpose' },
    { agentId: 'a2', description: null, agentType: 'Explore' },
    { agentId: 'a3' },
  ];
  s.workflows = [{ runId: 'wf_x', name: 'review-changes', started: 7, done: 3, running: 2 }];
  const r = buildIsland([s], {}).rows[0];
  assertEq(r.subagents, [{ label: 'Review Task 2' }, { label: 'Explore' }, { label: 'subagent' }]);
  assertEq(r.workflows, [{ name: 'review-changes', started: 7, done: 3, running: 2 }]);
});
test('rows default to empty subagents/workflows when absent', () => {
  const r = buildIsland([sess('running')], {}).rows[0];
  assertEq(r.subagents, []);
  assertEq(r.workflows, []);
});

console.log('\nislandLayout:');
// Mesure réelle (MBP 16" 1728pt) : encoche 185pt décentrée de 7pt à gauche.
test('centers window on the MEASURED notch, gap = notch + margin', () => {
  const d = { bounds: { x: 0, y: 0, width: 1728, height: 1117 } };
  const l = islandLayout(d, { left: 771, width: 185 }, 460);
  // centre encoche = 771 + 92.5 = 863.5 → x = 863.5 - 230 arrondi
  assertEq(l, { x: 634, gapPx: 209 });
});
test('secondary display coords: bounds.x is added', () => {
  const d = { bounds: { x: 2000, y: 0, width: 1728, height: 1117 } };
  assertEq(islandLayout(d, { left: 771, width: 185 }, 460), { x: 2634, gapPx: 209 });
});
test('no measurement → window centered on display, default gap 180', () => {
  const d = { internal: true, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 34, width: 1728, height: 1083 } };
  assertEq(islandLayout(d, null, 460), { x: 634, gapPx: 180 });
});
test('invalid measurement (width <= 0, negative left) → fallback', () => {
  const d = { internal: true, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 34, width: 1728, height: 1083 } };
  assertEq(islandLayout(d, { left: 771, width: 0 }, 460), { x: 634, gapPx: 180 });
  assertEq(islandLayout(d, { left: -5, width: 185 }, 460), { x: 634, gapPx: 180 });
});
test('display sans encoche (docké) → centré, fausse encoche 180', () => {
  const d = { internal: false, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, workArea: { x: 0, y: 31, width: 3440, height: 1409 } };
  assertEq(islandLayout(d, null, 460), { x: 1490, gapPx: 180 });
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
