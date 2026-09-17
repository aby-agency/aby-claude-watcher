// Tests du module pur ui/pending-label.js — libellé de la demande en attente
// (« Action requise » dit ce qu'elle demande). Run via `node test/pending-label.test.js`.
const { pendingLabel, PENDING_LABEL_MAX } = require('../ui/pending-label');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what || ''} attendu ${JSON.stringify(expected)}, reçu ${JSON.stringify(actual)}`);
}

console.log('\npendingLabel:');

test('outil seul → le nom de l\'outil', () => {
  const r = pendingLabel({ tool: 'Bash' });
  eq(r.text, 'Bash', 'text');
  eq(r.title, 'Bash', 'title');
});

test('outil + cible → « outil · cible »', () => {
  const r = pendingLabel({ tool: 'Bash', target: 'supprimer node_modules' });
  eq(r.text, 'Bash · supprimer node_modules', 'text');
});

test('un outil MCP est rendu « serveur · opération »', () => {
  const r = pendingLabel({ tool: 'mcp__qonto-official__create_client_invoice' });
  eq(r.text, 'qonto-official · create_client_invoice', 'text');
});

test('un nom MCP hors format est rendu tel quel, jamais avalé', () => {
  const r = pendingLabel({ tool: 'mcp__bizarre' });
  eq(r.text, 'mcp__bizarre', 'text');
});

test('une cible multi-ligne est aplatie (un heredoc ne casse pas la carte)', () => {
  const r = pendingLabel({ tool: 'Bash', target: 'cat <<EOF\nligne 1\nligne 2\nEOF' });
  if (r.text.includes('\n')) throw new Error(`text contient un saut de ligne : ${JSON.stringify(r.text)}`);
  eq(r.text, 'Bash · cat <<EOF ligne 1 ligne 2 EOF', 'text');
});

test('une cible longue est tronquée à l\'affichage, entière dans le tooltip', () => {
  const long = 'x'.repeat(PENDING_LABEL_MAX + 40);
  const r = pendingLabel({ tool: 'Bash', target: long });
  if (r.text.length > PENDING_LABEL_MAX + 'Bash · '.length) throw new Error(`text trop long : ${r.text.length}`);
  if (!r.text.endsWith('…')) throw new Error(`troncature attendue : ${r.text.slice(-10)}`);
  if (!r.title.includes(long)) throw new Error('le tooltip doit porter la valeur entière');
});

test('une cible vide ou blanche vaut pas de cible', () => {
  eq(pendingLabel({ tool: 'Bash', target: '' }).text, 'Bash', 'vide');
  eq(pendingLabel({ tool: 'Bash', target: '   ' }).text, 'Bash', 'blanche');
});

test('sans outil → null (chaque surface décide, rien n\'est inventé)', () => {
  eq(pendingLabel({}), null, 'objet vide');
  eq(pendingLabel(null), null, 'null');
  eq(pendingLabel({ tool: '', target: 'orpheline' }), null, 'cible sans outil');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
