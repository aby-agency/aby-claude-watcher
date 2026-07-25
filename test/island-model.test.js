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
// Pilule binaire (décision Paul/Etienne) : DROITE = ça bosse, GAUCHE = ça
// attend. Une pastille agrégée + compteur par aile, deux « états » de groupe.
test('right wing = busy (running/thinking), left wing = idle (waiting/pending/error)', () => {
  const m = buildIsland([sess('running'), sess('waiting')], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 1 }]);
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
});
test('busy aggregates running+thinking; idle aggregates waiting+pending+error', () => {
  const m = buildIsland([sess('running'), sess('running'), sess('thinking'), sess('waiting'), sess('pending'), sess('error')], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 3 }]);
  assertEq(m.left.leds, [{ state: 'idle', count: 3 }]);
});
test('empty group → empty wing (all working → left empty)', () => {
  const many = Array.from({ length: 9 }, () => sess('running'));
  const m = buildIsland(many, {});
  assertEq(m.right.leds, [{ state: 'busy', count: 9 }]);
  assertEq(m.left.leds, []);
});
// `job` = tour suspendu à une tâche de fond : ça tourne et ça reprendra seul,
// donc aile busy — le compter idle rappellerait l'utilisateur pour rien.
test('job counts as busy, not idle', () => {
  const m = buildIsland([sess('job'), sess('waiting')], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 1 }]);
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
});
test('job survit dans les rows du panneau (détail par état)', () => {
  const m = buildIsland([sess('job')], {});
  assertEq(m.rows.map(r => r.state), ['job']);
});
test('unknown state counts as idle (attend), never busy', () => {
  const m = buildIsland([sess('weird')], {});
  assertEq(m.right.leds, []);
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
});
test('headless sessions count in the activity wings when shown', () => {
  const m = buildIsland([sess('running'), sess('running', { bg: true })], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 2 }]);
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
test('backgroundRows flagged isBackground (panel keeps type split)', () => {
  const m = buildIsland([sess('running', { bg: true })], {});
  assertEq(m.rows.length, 0);
  assertEq(m.backgroundRows[0].isBackground, true);
});
test('islandShowHeadless:false excludes headless from wings and panel, keeps interactive', () => {
  const m = buildIsland([sess('running'), sess('waiting', { bg: true })], { islandShowHeadless: false });
  assertEq(m.right.leds, [{ state: 'busy', count: 1 }]);
  assertEq(m.left.leds, []); // le headless « waiting » est exclu du décompte
  assertEq(m.backgroundRows.length, 0);
  assertEq(m.rows.length, 1);
});
test('islandShowHeadless defaults to shown when flag absent', () => {
  const m = buildIsland([sess('waiting', { bg: true })], {});
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
  assertEq(m.backgroundRows.length, 1);
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
