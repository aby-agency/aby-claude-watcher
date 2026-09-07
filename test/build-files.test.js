// Garde-fou de packaging : tout module racine chargé par `require('./x')`
// depuis le main process DOIT figurer dans `build.files` de package.json
// (liste blanche electron-builder). Sinon l'app installée plante au démarrage
// avec « Cannot find module './x' » alors que `npm run dev` marche — constaté
// le 2026-09-07 sur presence.js / bg-task.js, DMG 2.13.0 cassé avant release.
// Run via `node test/build-files.test.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const files = new Set(pkg.build.files);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// Fermeture transitive des require('./…') depuis les entrées du main process.
function localRequires(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf-8');
  const out = new Set();
  for (const m of src.matchAll(/require\(\s*['"]\.\/([\w-]+)(?:\.js)?['"]\s*\)/g)) out.add(m[1] + '.js');
  return out;
}
function closure(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !fs.existsSync(path.join(root, f))) continue;
    seen.add(f);
    for (const dep of localRequires(f)) stack.push(dep);
  }
  return seen;
}

console.log('\nbuild.files (liste blanche electron-builder):');
test('chaque module racine requis par main.js (transitivement) est dans build.files', () => {
  const needed = closure(['main.js']);
  const missing = [...needed].filter((f) => !files.has(f));
  assert.deepStrictEqual(missing, [], `manquants dans build.files : ${missing.join(', ')}`);
});
test('les entrées preload / island / popover sont listées', () => {
  for (const f of ['preload.js', 'island.js', 'preload-island.js', 'popover.js', 'preload-popover.js']) {
    assert.ok(files.has(f), `${f} absent de build.files`);
  }
});
test('presence.js et bg-task.js (régression 2.13.0) sont listés', () => {
  assert.ok(files.has('presence.js'));
  assert.ok(files.has('bg-task.js'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
