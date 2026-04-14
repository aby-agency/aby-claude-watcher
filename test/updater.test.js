// Tests for updater.js version comparison

function parseVersion(v) {
  if (!v) return [0, 0, 0];
  return String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${b}, got ${a}`); }

console.log('\nversion comparison:');
test('newer patch', () => assertEq(isNewer('1.0.1', '1.0.0'), true));
test('newer minor', () => assertEq(isNewer('1.1.0', '1.0.5'), true));
test('newer major', () => assertEq(isNewer('2.0.0', '1.99.99'), true));
test('same version', () => assertEq(isNewer('1.0.0', '1.0.0'), false));
test('older version', () => assertEq(isNewer('1.0.0', '1.0.1'), false));
test('handles v prefix', () => assertEq(isNewer('v1.2.0', '1.1.0'), true));
test('handles both v prefixes', () => assertEq(isNewer('v2.0.0', 'v1.9.9'), true));
test('handles missing parts', () => assertEq(isNewer('1.2', '1.1.9'), true));
test('handles empty remote', () => assertEq(isNewer('', '1.0.0'), false));
test('partial equality', () => assertEq(isNewer('1.0', '1.0.0'), false));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
