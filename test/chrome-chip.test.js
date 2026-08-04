// Tests du module pur ui/chrome-chip.js (visibilité du chip « Chrome »).
// Run via `node test/chrome-chip.test.js`.
const { chromeChipVisible, CHROME_RECENT_MS } = require('../ui/chrome-chip');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}

const NOW = 1785832000000;

test('CHROME_RECENT_MS vaut 5 minutes', () => {
  if (CHROME_RECENT_MS !== 5 * 60 * 1000) throw new Error(`${CHROME_RECENT_MS}`);
});
test('visible juste après usage', () => {
  if (!chromeChipVisible(NOW - 1000, NOW)) throw new Error('devrait être visible');
});
test('visible juste sous la borne', () => {
  if (!chromeChipVisible(NOW - CHROME_RECENT_MS + 1, NOW)) throw new Error('devrait être visible');
});
test('invisible à la borne exacte', () => {
  if (chromeChipVisible(NOW - CHROME_RECENT_MS, NOW)) throw new Error('devrait être expiré');
});
test('null / undefined / 0 → invisible (jamais de timestamp fabriqué)', () => {
  if (chromeChipVisible(null, NOW) || chromeChipVisible(undefined, NOW) || chromeChipVisible(0, NOW)) {
    throw new Error('absence de donnée = pas de chip');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
