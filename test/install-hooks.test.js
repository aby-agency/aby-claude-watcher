// Tests for install-hooks.js. Run: node test/install-hooks.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installHooksIntoFile, removeHookFromFile } = require('../install-hooks.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

let counter = 0;
function tmpFile() {
  counter++;
  const p = path.join(os.tmpdir(), `aby-hooktest-${process.pid}-${counter}.json`);
  try { fs.unlinkSync(p); } catch (_) {}
  return p;
}
const HOOK = '/opt/app/bin/aby-permission-hook.sh';
// La commande écrite dans settings.json est QUOTÉE (sh -c découperait un chemin
// à espaces — cf. /Applications/Aby Claude Watcher.app).
const Q = (p) => `'${p}'`;
function read(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

console.log('\ninstallHooksIntoFile:');
test('fichier neuf → PreToolUse(*) + Notification("") pointant sur le hook', () => {
  const p = tmpFile();
  const r = installHooksIntoFile(p, HOOK);
  assertEq(r.installed, true);
  const d = read(p);
  assertEq(d.hooks.PreToolUse[0].matcher, '*');
  assertEq(d.hooks.Notification[0].matcher, '');
  assertEq(d.hooks.PreToolUse[0].hooks[0].command, Q(HOOK));
  assertEq(d.hooks.Notification[0].hooks[0].command, Q(HOOK));
});
test('idempotent : 2e appel → already-present, aucun doublon', () => {
  const p = tmpFile();
  installHooksIntoFile(p, HOOK);
  const r = installHooksIntoFile(p, HOOK);
  assertEq(r.reason, 'already-present');
  assertEq(read(p).hooks.PreToolUse.length, 1);
});
test('self-heal : chemin périmé mis à jour en place', () => {
  const p = tmpFile();
  installHooksIntoFile(p, '/old/path/aby-permission-hook.sh');
  installHooksIntoFile(p, HOOK);
  const d = read(p);
  assertEq(d.hooks.PreToolUse.length, 1);
  assertEq(d.hooks.PreToolUse[0].hooks[0].command, Q(HOOK));
});
test('non destructif : préserve les autres hooks et les autres clés', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({
    model: 'opus',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/user/own.sh' }] }] },
  }));
  installHooksIntoFile(p, HOOK);
  const d = read(p);
  assertEq(d.model, 'opus');
  assertEq(d.hooks.PreToolUse.length, 2); // le hook user + le nôtre
  assert(d.hooks.PreToolUse.some(b => b.hooks[0].command === '/user/own.sh'), 'hook user préservé');
});
test('fichier illisible → bail, aucune écriture', () => {
  const p = tmpFile();
  fs.writeFileSync(p, '{ not json ');
  const r = installHooksIntoFile(p, HOOK);
  assertEq(r.installed, false);
  assertEq(r.reason, 'parse-failed');
  assertEq(fs.readFileSync(p, 'utf-8'), '{ not json ');
});

console.log('\nremoveHookFromFile:');
test('retire nos blocs, garde les autres hooks et clés', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({
    model: 'opus',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/user/own.sh' }] }] },
  }));
  installHooksIntoFile(p, HOOK);
  const r = removeHookFromFile(p);
  assertEq(r.removed, true);
  const d = read(p);
  assertEq(d.model, 'opus');
  assertEq(d.hooks.PreToolUse.length, 1);
  assertEq(d.hooks.PreToolUse[0].hooks[0].command, '/user/own.sh');
  assert(!('Notification' in d.hooks) || d.hooks.Notification.length === 0, 'notre Notification retiré');
});
test('fichier absent → no-op', () => {
  const p = tmpFile();
  const r = removeHookFromFile(p);
  assertEq(r.removed, false);
});

console.log('\nquoting du chemin (sh -c):');
const SPACED = '/Applications/Aby Claude Watcher.app/Contents/Resources/app.asar.unpacked/bin/aby-permission-hook.sh';

test('chemin à espaces → commande quotée (sinon sh coupe à « /Applications/Aby »)', () => {
  const p = tmpFile();
  installHooksIntoFile(p, SPACED);
  const cmd = read(p).hooks.PreToolUse[0].hooks[0].command;
  assertEq(cmd, `'${SPACED}'`);
  // La commande DOIT désigner le script en entier, pas son premier mot.
  assertEq(cmd.split(' ')[0] === "'/Applications/Aby", true);
  assertEq(cmd.endsWith(`aby-permission-hook.sh'`), true);
});

test('migration : une commande nue écrite par une version ≤2.4.x est re-quotée', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: SPACED }] }] },
  }, null, 2));
  const r = installHooksIntoFile(p, SPACED);
  assertEq(r.reason, 'written');
  const d = read(p);
  assertEq(d.hooks.PreToolUse.length, 1); // reconnu comme le nôtre → pas de doublon
  assertEq(d.hooks.PreToolUse[0].hooks[0].command, `'${SPACED}'`);
});

test('idempotent sur la forme quotée (pas de réécriture à chaque démarrage)', () => {
  const p = tmpFile();
  installHooksIntoFile(p, SPACED);
  assertEq(installHooksIntoFile(p, SPACED).reason, 'already-present');
});

test('removeHookFromFile reconnaît la forme quotée', () => {
  const p = tmpFile();
  installHooksIntoFile(p, SPACED);
  assertEq(removeHookFromFile(p).removed, true);
  assertEq(read(p).hooks.PreToolUse, undefined);
});

test('apostrophe dans le chemin → échappement shell correct', () => {
  const p = tmpFile();
  const weird = "/Users/paul/Claude's apps/bin/aby-permission-hook.sh";
  installHooksIntoFile(p, weird);
  assertEq(read(p).hooks.PreToolUse[0].hooks[0].command, `'/Users/paul/Claude'\\''s apps/bin/aby-permission-hook.sh'`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
