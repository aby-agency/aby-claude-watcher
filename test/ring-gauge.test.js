// Tests for ring-gauge.js. Run: node test/ring-gauge.test.js
const { gaugeColor, formatCountdown, ringSvg, trayUsageLabel } = require('../ring-gauge.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const GREEN = '#28c451', AMBER = '#ff9f0a', RED = '#ff453a';
const NOW = 1783000000000; // ms fixe
const SEC = 1783000000;     // = NOW/1000

console.log('\ngaugeColor:');
test('27% → vert', () => assertEq(gaugeColor(27), GREEN));
test('49% → vert', () => assertEq(gaugeColor(49), GREEN));
test('50% → ambre', () => assertEq(gaugeColor(50), AMBER));
test('80% → ambre', () => assertEq(gaugeColor(80), AMBER));
test('81% → rouge', () => assertEq(gaugeColor(81), RED));
test('100% → rouge', () => assertEq(gaugeColor(100), RED));
test('null → null', () => assertEq(gaugeColor(null), null));
test('NaN → null', () => assertEq(gaugeColor(NaN), null));
test('négatif → null', () => assertEq(gaugeColor(-5), null));

console.log('\nformatCountdown:');
test('secondes, 35 min → "35m"', () => assertEq(formatCountdown(SEC + 2100, NOW), '35m'));
test('secondes, 72 min → "1h12"', () => assertEq(formatCountdown(SEC + 4320, NOW), '1h12'));
test('ms (>1e12) traité comme ms', () => assertEq(formatCountdown((SEC + 2100) * 1000, NOW), '35m'));
test('reset passé → "reset"', () => assertEq(formatCountdown(SEC - 100, NOW), 'reset'));
test('null → "reset"', () => assertEq(formatCountdown(null, NOW), 'reset'));
test('ISO string futur', () => assertEq(formatCountdown('2026-07-06T12:00:00.000Z', Date.parse('2026-07-06T11:25:00.000Z')), '35m'));

console.log('\nringSvg:');
test('anneau coloré contient la couleur + rotation', () => {
  const s = ringSvg(27, GREEN);
  assert(s.includes('<svg'), 'pas de <svg');
  assert(s.includes(GREEN), 'couleur absente');
  assert(s.includes('rotate(-90'), 'arc non pivoté');
});
test('pct 0 → pas d\'arc de progression', () => {
  assert(!ringSvg(0, null).includes('rotate(-90'), 'arc présent à 0%');
});
test('clamp au-delà de 100 sans crash', () => {
  assert(ringSvg(150, RED).includes('<svg'), 'crash sur 150%');
});

console.log('\ntrayUsageLabel:');
test('5h présent → "5H 27% · 35m"', () => {
  assertEq(trayUsageLabel({ fiveHour: { utilization: 27, resetsAt: SEC + 2100 } }, NOW), '5H 27% · 35m');
});
test('arrondi de utilization', () => {
  assertEq(trayUsageLabel({ fiveHour: { utilization: 26.6, resetsAt: SEC + 2100 } }, NOW), '5H 27% · 35m');
});
test('clamp à 100', () => {
  assertEq(trayUsageLabel({ fiveHour: { utilization: 130, resetsAt: SEC + 2100 } }, NOW), '5H 100% · 35m');
});
test('pas de fiveHour → null', () => assertEq(trayUsageLabel({}, NOW), null));
test('usage null → null', () => assertEq(trayUsageLabel(null, NOW), null));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
