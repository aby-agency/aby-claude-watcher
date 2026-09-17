// Les <script src> classiques d'index.html partagent le MÊME scope lexical.
// Deux fichiers avec un `const` racine de même nom → SyntaxError, et le 2e
// script N'EXÉCUTE PAS (échec silencieux : window.X reste undefined). Le piège
// est documenté dans CLAUDE.md ; ce test le garde.
// Run via `node test/renderer-scripts.test.js`.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}

const UI = path.join(__dirname, '..', 'ui');

// Les scripts, dans l'ordre où la page les charge.
function scriptsOf(htmlFile) {
  const html = fs.readFileSync(path.join(UI, htmlFile), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
}

// Concaténer et PARSER dans un seul contexte : c'est ce que fait le navigateur
// pour les déclarations de haut niveau. On ne les exécute pas (elles veulent un
// vrai DOM), seule la collision de noms nous intéresse, et elle est une erreur
// de parse.
function parseTogether(files, htmlFile) {
  const src = files.map((f) => fs.readFileSync(path.join(UI, path.dirname(htmlFile), f), 'utf8')).join('\n;\n');
  new vm.Script(src, { filename: `${htmlFile}::scripts` });
}

console.log('\nscope global des <script src>:');

test('index.html : aucun const/let racine en collision entre modules', () => {
  const files = scriptsOf('index.html');
  if (files.length < 5) throw new Error(`seulement ${files.length} scripts trouvés`);
  parseTogether(files, 'index.html');
});

test('popover.html : idem', () => {
  const files = scriptsOf('popover.html');
  if (files.length) parseTogether(files, 'popover.html');
});

// Contre-épreuve : sans elle, le test ci-dessus passerait aussi s'il ne
// vérifiait rien du tout.
test('le test détecte bien une collision (contre-épreuve)', () => {
  let threw = null;
  try {
    new vm.Script('const api = 1;\n;\nconst api = 2;', { filename: 'collision' });
  } catch (e) { threw = e; }
  if (!threw) throw new Error('une double déclaration aurait dû lever');
  if (!/already been declared/.test(threw.message)) throw new Error(`message inattendu : ${threw.message}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
