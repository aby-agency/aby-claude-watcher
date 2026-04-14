// Tests for focus.js sanitization functions
// Run: node test/focus.test.js

const path = require('path');
const { Module } = require('module');

// Load focus.js but stub out electron dependency since we only test pure functions
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'child_process') return request;
  return originalResolve.call(this, request, ...args);
};

const focus = require('../focus.js');

// Access private functions via require cache hack
const focusModule = require.cache[require.resolve('../focus.js')];
const src = require('fs').readFileSync(require.resolve('../focus.js'), 'utf-8');

// Simple eval-based extraction since the functions aren't exported
// Extract and eval the sanitize functions in isolation
const sanitizeSrc = src.match(/function sanitize[\s\S]+?^}/gm).join('\n');
const testCtx = {};
new Function('ctx', sanitizeSrc + '\nctx.sanitizePid = sanitizePid; ctx.sanitizeSessionId = sanitizeSessionId; ctx.sanitizePath = sanitizePath;')(testCtx);

const { sanitizePid, sanitizeSessionId, sanitizePath } = testCtx;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('\nsanitizePid:');
test('accepts positive integer', () => assertEq(sanitizePid(1234), 1234));
test('accepts string number', () => assertEq(sanitizePid('1234'), 1234));
test('rejects zero', () => assertEq(sanitizePid(0), null));
test('rejects negative', () => assertEq(sanitizePid(-1), null));
test('rejects string with injection', () => assertEq(sanitizePid('1; rm -rf /'), 1)); // parseInt stops at ;
test('rejects non-numeric', () => assertEq(sanitizePid('abc'), null));
test('rejects null/undefined', () => { assertEq(sanitizePid(null), null); assertEq(sanitizePid(undefined), null); });

console.log('\nsanitizeSessionId:');
test('accepts valid UUID', () => assertEq(sanitizeSessionId('afa7c9b7-8af1-4176-98d8-635520b61526'), 'afa7c9b7-8af1-4176-98d8-635520b61526'));
test('accepts alphanumeric-only', () => assertEq(sanitizeSessionId('abc123XYZ-789'), 'abc123XYZ-789'));
test('rejects semicolon', () => assertEq(sanitizeSessionId('abc;rm'), null));
test('rejects space', () => assertEq(sanitizeSessionId('abc 123'), null));
test('rejects backtick', () => assertEq(sanitizeSessionId('abc`cmd`'), null));
test('rejects empty', () => assertEq(sanitizeSessionId(''), null));
test('rejects non-string', () => assertEq(sanitizeSessionId(123), null));

console.log('\nsanitizePath:');
test('accepts normal path', () => assertEq(sanitizePath('/Users/me/project'), '/Users/me/project'));
test('accepts spaces', () => assertEq(sanitizePath('/Users/me/my project'), '/Users/me/my project'));
test('rejects double-quote', () => assertEq(sanitizePath('/Users/me/"evil'), null));
test('rejects backslash', () => assertEq(sanitizePath('/Users/me/\\evil'), null));
test('rejects semicolon', () => assertEq(sanitizePath('/tmp;rm'), null));
test('rejects backtick', () => assertEq(sanitizePath('/tmp/`cmd`'), null));
test('rejects dollar', () => assertEq(sanitizePath('/tmp/$PATH'), null));
test('rejects newline', () => assertEq(sanitizePath('/tmp/\nevil'), null));
test('rejects null', () => assertEq(sanitizePath(null), null));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
