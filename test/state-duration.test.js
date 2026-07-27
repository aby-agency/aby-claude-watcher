// Tests for ui/state-duration.js. Run: node test/state-duration.test.js
const { formatMinutes, formatStateDuration } = require('../ui/state-duration.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const NOW = 1_000_000_000_000;

console.log('\nformatMinutes:');
test('< 1 min → null (jamais de « 0 min »)', () => assertEq(formatMinutes(0), null));
test('12 → « 12 min »', () => assertEq(formatMinutes(12), '12 min'));
test('59 → « 59 min »', () => assertEq(formatMinutes(59), '59 min'));
test('60 → « 1h00 »', () => assertEq(formatMinutes(60), '1h00'));
test('92 → « 1h32 »', () => assertEq(formatMinutes(92), '1h32'));
test('65.9 flooré → « 1h05 »', () => assertEq(formatMinutes(65.9), '1h05'));
test('invalide (null/NaN/négatif) → null', () => {
  assertEq(formatMinutes(null), null);
  assertEq(formatMinutes(NaN), null);
  assertEq(formatMinutes(-5), null);
});

console.log('\nformatStateDuration:');
test('< 60 s → null', () => assertEq(formatStateDuration(NOW - 59_000, NOW), null));
test('12 min → « 12 min »', () => assertEq(formatStateDuration(NOW - 12 * 60_000, NOW), '12 min'));
test('92 min → « 1h32 »', () => assertEq(formatStateDuration(NOW - 92 * 60_000, NOW), '1h32'));
test('sinceMs absent/invalide → null', () => {
  assertEq(formatStateDuration(null, NOW), null);
  assertEq(formatStateDuration(undefined, NOW), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
