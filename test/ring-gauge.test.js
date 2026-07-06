// Tests for ring-gauge.js. Run: node test/ring-gauge.test.js
const { gaugeColor, formatCountdown, ringBitmap, trayUsageLabel } = require('../ring-gauge.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function px(buf, x, y, size) { const i = (y * size + x) * 4; return { b: buf[i], g: buf[i + 1], r: buf[i + 2], a: buf[i + 3] }; }

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

console.log('\nringBitmap:');
const SIZE = 16;
test('taille du buffer = size*size*4', () => assertEq(ringBitmap(27, GREEN, SIZE).length, SIZE * SIZE * 4));
test('centre transparent (trou de l\'anneau)', () => assertEq(px(ringBitmap(27, GREEN, SIZE), 8, 8, SIZE).a, 0));
test('coin transparent', () => assertEq(px(ringBitmap(27, GREEN, SIZE), 0, 0, SIZE).a, 0));
test('arc haut = vert opaque (G dominant)', () => {
  const p = px(ringBitmap(50, GREEN, SIZE), 8, 2, SIZE);
  assert(p.a > 150, `alpha faible: ${p.a}`);
  assert(p.g > p.r && p.g > p.b, `vert non dominant: ${JSON.stringify(p)}`);
});
test('pct 0 → track grise en haut, semi-transparente (pas d\'arc)', () => {
  const p = px(ringBitmap(0, GREEN, SIZE), 8, 2, SIZE);
  assert(p.a > 0 && p.a < 170, `alpha track inattendu: ${p.a}`);
  assert(Math.abs(p.r - p.g) < 12 && Math.abs(p.g - p.b) < 12, `pas gris: ${JSON.stringify(p)}`);
});
test('color null → track uniquement (gris)', () => {
  const p = px(ringBitmap(80, null, SIZE), 8, 2, SIZE);
  assert(Math.abs(p.r - p.g) < 12 && Math.abs(p.g - p.b) < 12, `devrait être gris: ${JSON.stringify(p)}`);
});
test('clamp au-delà de 100 sans crash', () => assertEq(ringBitmap(150, RED, SIZE).length, SIZE * SIZE * 4));

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
