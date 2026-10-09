// test/cockpit-registry.test.js
// Module pur : nom court et groupe d'un projet lus dans le registre du Cockpit (09/10/2026).
// Run via `node test/cockpit-registry.test.js`.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registryFile, parseProjects, projectForCwd, createRegistryReader } = require('../cockpit-registry');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

const HOME = '/Users/x';
const REGISTRE = JSON.stringify({ projects: [
  { slug: 'pec', name: 'PEC', short: 'PEC', group: 'clients', cwd: '~/Project/aby/clients/groupe-pec/all' },
  { slug: 'pec-commercial', name: 'PEC', short: 'PEC', group: 'commercial', cwd: '~/Project/aby/clients/groupe-pec/commercial' },
  { slug: 'aby', name: 'ABY', cwd: '~/Project/aby' },
  { slug: 'pilotage', name: 'Pilotage', group: 'pilotage', cwd: '~' },
  { slug: 'long', name: 'Nom très long', short: 'Long', cwd: '/opt/long/' },
  { name: 'sans slug', cwd: '/x' },
] });

console.log('\nparseProjects:');
test('short prime sur name, ~ développé, barre finale retirée, entrée invalide ignorée', () => {
  const p = parseProjects(REGISTRE, HOME);
  assert.deepStrictEqual(p.map((x) => [x.slug, x.name, x.group, x.dir]), [
    ['pec', 'PEC', 'clients', '/Users/x/Project/aby/clients/groupe-pec/all'],
    ['pec-commercial', 'PEC', 'commercial', '/Users/x/Project/aby/clients/groupe-pec/commercial'],
    ['aby', 'ABY', null, '/Users/x/Project/aby'],
    ['pilotage', 'Pilotage', 'pilotage', '/Users/x'],
    ['long', 'Long', null, '/opt/long'],
  ]);
});
test('JSON illisible ou sans projects → rien', () => {
  assert.deepStrictEqual(parseProjects('{', HOME), []);
  assert.deepStrictEqual(parseProjects('{"x":1}', HOME), []);
});

console.log('\nprojectForCwd (slugForCwd du Cockpit):');
const P = parseProjects(REGISTRE, HOME);
test('dossier exact', () => assert.strictEqual(projectForCwd(P, '/Users/x/Project/aby/clients/groupe-pec/commercial', HOME).slug, 'pec-commercial'));
test('le plus profond gagne (cd src)', () => {
  assert.strictEqual(projectForCwd(P, '/Users/x/Project/aby/clients/groupe-pec/all/apps/back/src', HOME).slug, 'pec');
  assert.strictEqual(projectForCwd(P, '/Users/x/Project/aby/interne/hublot', HOME).slug, 'aby');
});
test('un projet posé sur ~ ne vaut que pour ~', () => {
  assert.strictEqual(projectForCwd(P, '/Users/x', HOME).slug, 'pilotage');
  assert.strictEqual(projectForCwd(P, '/Users/x/Desktop', HOME), null);
});
test('un préfixe de nom n\'est pas un parent (groupe-pec/allx tombe sur le parent réel)', () => {
  assert.strictEqual(projectForCwd(P, '/Users/x/Project/aby/clients/groupe-pec/allx', HOME).slug, 'aby');
});
test('sans dossier → null', () => assert.strictEqual(projectForCwd(P, null, HOME), null));

console.log('\nregistryFile (même cascade que le Cockpit et le Hublot):');
test('local d\'abord, sinon partagé ; $COCKPIT_DIR, puis ~/Aby/cockpit, puis ~/Project/aby/interne/cockpit', () => {
  const have = (set) => (f) => set.has(f);
  assert.strictEqual(registryFile(HOME, {}, have(new Set(['/Users/x/Aby/cockpit/projects.json', '/Users/x/Aby/cockpit/projects.local.json']))), '/Users/x/Aby/cockpit/projects.local.json');
  assert.strictEqual(registryFile(HOME, {}, have(new Set(['/Users/x/Aby/cockpit/projects.json']))), '/Users/x/Aby/cockpit/projects.json');
  assert.strictEqual(registryFile(HOME, {}, have(new Set(['/Users/x/Project/aby/interne/cockpit/projects.local.json']))), '/Users/x/Project/aby/interne/cockpit/projects.local.json');
  assert.strictEqual(registryFile(HOME, { COCKPIT_DIR: '/c' }, have(new Set(['/c/projects.json', '/Users/x/Aby/cockpit/projects.local.json']))), '/c/projects.json');
  assert.strictEqual(registryFile(HOME, {}, have(new Set())), null);
});

console.log('\ncreateRegistryReader:');
test('identité du dossier, relue quand le fichier change, rien sans registre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-reg-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, 'Aby', 'cockpit'), { recursive: true });
  const reader = createRegistryReader({ home, env: {} });
  assert.strictEqual(reader.identityForCwd(path.join(home, 'p')), null);
  const f = path.join(home, 'Aby', 'cockpit', 'projects.local.json');
  fs.writeFileSync(f, JSON.stringify({ projects: [{ slug: 'maison-pion', name: 'Maison Pion', short: 'Maison', group: 'commercial', cwd: '~/p' }] }));
  assert.deepStrictEqual(reader.identityForCwd(path.join(home, 'p', 'src')), { slug: 'maison-pion', name: 'Maison', group: 'commercial' });
  fs.writeFileSync(f, JSON.stringify({ projects: [{ slug: 'maison-pion', name: 'Pion', short: 'Pion', group: 'commercial', cwd: '~/p' }] }));
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(f, t, t);
  assert.strictEqual(reader.identityForCwd(path.join(home, 'p')).name, 'Pion');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
