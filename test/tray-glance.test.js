// Tests for tray-glance.js. Run: node test/tray-glance.test.js
const { trayGlance } = require('../tray-glance.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const C = { pending: '#f59e0b', error: '#ef4444', waiting: '#22c55e' };

console.log('\ntrayGlance:');
test('no attention → count 0, no color', () => {
  const g = trayGlance([{ state: 'running' }, { state: 'thinking' }], {});
  assertEq(g.count, 0); assertEq(g.color, null);
});
test('counts pending+waiting+error', () => {
  const g = trayGlance([{ state: 'pending' }, { state: 'waiting' }, { state: 'error' }, { state: 'running' }], {});
  assertEq(g.count, 3);
});
test('pending wins over error and waiting', () => {
  assertEq(trayGlance([{ state: 'waiting' }, { state: 'error' }, { state: 'pending' }], {}).color, C.pending);
});
test('error wins over waiting', () => {
  assertEq(trayGlance([{ state: 'waiting' }, { state: 'error' }], {}).color, C.error);
});
test('background sessions excluded from count', () => {
  assertEq(trayGlance([{ state: 'pending', isBackground: true }], {}).count, 0);
});
test('usageLabel = highest pct when no attention', () => {
  assertEq(trayGlance([{ state: 'running' }], { pct5h: 62, pct7d: 41 }).usageLabel, '62%');
});
test('usageLabel null when a pct is null on both', () => {
  assertEq(trayGlance([], {}).usageLabel, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
