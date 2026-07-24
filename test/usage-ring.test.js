// Tests for ui/usage-ring.js. Run: node test/usage-ring.test.js
const { usageRing, usageBar, usageLevel } = require('../ui/usage-ring.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

console.log('\nusageLevel:');
test('< 50 → ok', () => { assertEq(usageLevel(0), 'ok'); assertEq(usageLevel(49), 'ok'); });
test('50..80 → warn', () => { assertEq(usageLevel(50), 'warn'); assertEq(usageLevel(80), 'warn'); });
test('> 80 → hot', () => { assertEq(usageLevel(81), 'hot'); assertEq(usageLevel(100), 'hot'); });

console.log('\nusageRing:');
test('embeds level, arc, label · pct and reste', () => {
  const h = usageRing('5H', 8, '3h20');
  assert(h.includes('data-lvl="ok"'), 'level');
  assert(h.includes('--uring-pct:8'), 'arc');
  assert(h.includes('5H · 8%'), 'label·pct');
  assert(h.includes('class="uring-reste">3h20'), 'reste');
});
test('clamps the arc to 100 but keeps the real pct in text', () => {
  const h = usageRing('7J', 130, '');
  assert(h.includes('--uring-pct:100'), 'arc clamped');
  assert(h.includes('7J · 130%'), 'real pct shown');
});
test('no reste span when remaining empty', () => {
  assert(!usageRing('7J', 76, '').includes('uring-reste'), 'no reste');
});
test('escapes the label', () => {
  assert(usageRing('<x>', 10, '').includes('&lt;x&gt;'), 'escaped');
});

console.log('\nusageBar:');
test('embeds level on the fill, arc width, label · pct and reste', () => {
  const h = usageBar('7J', 79, '1h54');
  assert(h.includes('data-lvl="warn"'), 'level on fill');
  assert(h.includes('--ubar-pct:79'), 'arc');
  assert(h.includes('7J · 79%'), 'label·pct');
  assert(h.includes('class="ubar-reste">1h54'), 'reste');
});
test('clamps the fill to 100 but keeps the real pct in text', () => {
  const h = usageBar('7J', 130, '');
  assert(h.includes('--ubar-pct:100'), 'clamped');
  assert(h.includes('7J · 130%'), 'real pct');
});
test('no reste span when remaining empty', () => {
  assert(!usageBar('5H', 8, '').includes('ubar-reste'), 'no reste');
});
test('escapes the label', () => {
  assert(usageBar('<x>', 10, '').includes('&lt;x&gt;'), 'escaped');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
