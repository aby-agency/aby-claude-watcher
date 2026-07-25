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
function read(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

console.log('\ninstallHooksIntoFile:');
test('fichier neuf → PreToolUse(*) + Notification("") pointant sur le hook', () => {
  const p = tmpFile();
  const r = installHooksIntoFile(p, HOOK);
  assertEq(r.installed, true);
  const d = read(p);
  assertEq(d.hooks.PreToolUse[0].matcher, '*');
  assertEq(d.hooks.Notification[0].matcher, '');
  assertEq(d.hooks.PreToolUse[0].hooks[0].command, HOOK);
  assertEq(d.hooks.Notification[0].hooks[0].command, HOOK);
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
  assertEq(d.hooks.PreToolUse[0].hooks[0].command, HOOK);
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
