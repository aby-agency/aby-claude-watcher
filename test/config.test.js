// Tests for config.js
// Run: node test/config.test.js

const os = require('os');
const path = require('path');
const fs = require('fs');

// Create isolated test config dir
const testDir = path.join(os.tmpdir(), `claude-watch-test-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

// Stub electron
require.cache[require.resolve.paths('electron')[0] + '/electron'] = {
  exports: { app: { getPath: () => testDir } },
};
// Simpler approach: intercept the require
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') {
    return __filename; // placeholder
  }
  return originalResolve.call(this, request, ...args);
};
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return { app: { getPath: () => testDir } };
  }
  return originalLoad.call(this, request, ...args);
};

const config = require('../config.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) {
  const aStr = typeof a === 'object' ? JSON.stringify(a) : String(a);
  const bStr = typeof b === 'object' ? JSON.stringify(b) : String(b);
  if (aStr !== bStr) throw new Error(`expected ${bStr}, got ${aStr}`);
}

config.load();

console.log('\nsetCustomName:');
test('stores name', () => {
  config.setCustomName('abc', 'My Project');
  assertEq(config.getCustomName('abc'), 'My Project');
});
test('trims whitespace', () => {
  config.setCustomName('abc', '  Trimmed  ');
  assertEq(config.getCustomName('abc'), 'Trimmed');
});
test('caps at 60 chars', () => {
  const long = 'a'.repeat(100);
  config.setCustomName('abc', long);
  assertEq(config.getCustomName('abc').length, 60);
});
test('strips control chars', () => {
  config.setCustomName('abc', 'Hello\x00\x1fWorld');
  assertEq(config.getCustomName('abc'), 'HelloWorld');
});
test('empty clears', () => {
  config.setCustomName('abc', '');
  assertEq(config.getCustomName('abc'), null);
});
test('whitespace-only clears', () => {
  config.setCustomName('abc', '   ');
  assertEq(config.getCustomName('abc'), null);
});

console.log('\nsession lifecycle:');
test('saveSession + getSavedSessions', () => {
  config.saveSession('sid1', { stateName: 'running' });
  const saved = config.getSavedSessions();
  assertEq(saved.sid1.stateName, 'running');
});
test('deleteSession removes session', () => {
  config.saveSession('sid2', { stateName: 'completed' });
  config.setCustomName('sid2', 'Test');
  config.setSessionOrder(['sid1', 'sid2']);
  config.deleteSession('sid2');
  const saved = config.getSavedSessions();
  assertEq(!!saved.sid2, false);
  assertEq(config.getCustomName('sid2'), null);
  assertEq(config.getSessionOrder().includes('sid2'), false);
});

console.log('\nvolume clamping:');
test('volume clamped to 1', () => {
  config.setVolume(2);
  assertEq(config.get().volume, 1);
});
test('volume clamped to 0', () => {
  config.setVolume(-1);
  assertEq(config.get().volume, 0);
});

// Cleanup
try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
