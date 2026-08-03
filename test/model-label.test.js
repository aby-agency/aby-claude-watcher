// Tests for ui/model-label.js. Run: node test/model-label.test.js
const { formatModel } = require('../ui/model-label.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('\nformatModel — génération 5 (mono-chiffre, cassée avant):');
test('claude-opus-5 → « Opus 5 »', () => assertEq(formatModel('claude-opus-5'), 'Opus 5'));
test('claude-sonnet-5 → « Sonnet 5 »', () => assertEq(formatModel('claude-sonnet-5'), 'Sonnet 5'));
test('claude-fable-5 → « Fable 5 »', () => assertEq(formatModel('claude-fable-5'), 'Fable 5'));

console.log('\nformatModel — suffixe de variante:');
test('claude-opus-5[1m] → « Opus 5 » (variante ignorée)', () => assertEq(formatModel('claude-opus-5[1m]'), 'Opus 5'));

console.log('\nformatModel — formats déjà couverts (non-régression):');
test('claude-opus-4-8 → « Opus 4.8 »', () => assertEq(formatModel('claude-opus-4-8'), 'Opus 4.8'));
test('claude-sonnet-4-6 → « Sonnet 4.6 »', () => assertEq(formatModel('claude-sonnet-4-6'), 'Sonnet 4.6'));
test('claude-haiku-4-5-20251001 → « Haiku 4.5 » (date ignorée)', () => assertEq(formatModel('claude-haiku-4-5-20251001'), 'Haiku 4.5'));

console.log('\nformatModel — la date ne devient JAMAIS un numéro de version:');
test('claude-opus-5-20260101 → « Opus 5 »', () => assertEq(formatModel('claude-opus-5-20260101'), 'Opus 5'));

console.log('\nformatModel — alias nus (sessions SDK/headless):');
test('opus → « Opus »', () => assertEq(formatModel('opus'), 'Opus'));
test('sonnet → « Sonnet »', () => assertEq(formatModel('sonnet'), 'Sonnet'));
test('haiku → « Haiku »', () => assertEq(formatModel('haiku'), 'Haiku'));
test('fable → « Fable »', () => assertEq(formatModel('fable'), 'Fable'));

console.log('\nformatModel — rien à afficher → null (pas de libellé fabriqué):');
test('<synthetic> → null (événement d\'erreur API)', () => assertEq(formatModel('<synthetic>'), null));
test('null / undefined / vide → null', () => {
  assertEq(formatModel(null), null);
  assertEq(formatModel(undefined), null);
  assertEq(formatModel(''), null);
  assertEq(formatModel('   '), null);
});
test('non-string → null', () => assertEq(formatModel(42), null));

console.log('\nformatModel — inconnu → rendu tel quel (jamais avalé):');
test('modèle non reconnu → brut', () => assertEq(formatModel('gpt-nawak-9'), 'gpt-nawak-9'));
test('claude-3-5-sonnet-20241022 (ancien ordre) → brut', () => {
  assertEq(formatModel('claude-3-5-sonnet-20241022'), 'claude-3-5-sonnet-20241022');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
