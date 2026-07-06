// Tests for focus-state.js. Run: node test/focus-state.test.js
const { parseFocusAssertions } = require('../focus-state.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const ACTIVE = JSON.stringify({ data: [ { storeAssertionRecords: [ { assertionDetails: { assertionDetailsModeIdentifier: 'com.apple.focus.work' } } ] } ] });
const INACTIVE_EMPTY = JSON.stringify({ data: [ {} ] });
const INACTIVE_NO_RECORDS = JSON.stringify({ data: [ { storeAssertionRecords: [] } ] });

console.log('\nparseFocusAssertions:');
test('active focus assertion → true', () => assertEq(parseFocusAssertions(ACTIVE), true));
test('empty data entry → false', () => assertEq(parseFocusAssertions(INACTIVE_EMPTY), false));
test('empty records array → false', () => assertEq(parseFocusAssertions(INACTIVE_NO_RECORDS), false));
test('no data key → false', () => assertEq(parseFocusAssertions('{}'), false));
test('invalid JSON → false (never throws)', () => assertEq(parseFocusAssertions('not json'), false));
test('empty string → false', () => assertEq(parseFocusAssertions(''), false));
test('null → false', () => assertEq(parseFocusAssertions(null), false));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
