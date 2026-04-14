// Tests for the open-remote URL validation logic
// Extracted and tested in isolation

function isAllowedRemoteUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host === 'claude.ai' || host.endsWith('.claude.ai') ||
           host === 'anthropic.com' || host.endsWith('.anthropic.com');
  } catch {
    return false;
  }
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${b}, got ${a}`); }

console.log('\nopen-remote URL validation:');
test('accepts https://claude.ai/...', () => assertEq(isAllowedRemoteUrl('https://claude.ai/code/session_123'), true));
test('accepts subdomain .claude.ai', () => assertEq(isAllowedRemoteUrl('https://app.claude.ai/x'), true));
test('accepts anthropic.com', () => assertEq(isAllowedRemoteUrl('https://anthropic.com'), true));
test('accepts subdomain .anthropic.com', () => assertEq(isAllowedRemoteUrl('https://api.anthropic.com/v1'), true));
test('rejects http (not https)', () => assertEq(isAllowedRemoteUrl('http://claude.ai'), false));
test('rejects evil with fragment', () => assertEq(isAllowedRemoteUrl('https://evil.com/#anthropic'), false));
test('rejects evil with query', () => assertEq(isAllowedRemoteUrl('https://evil.com?x=anthropic'), false));
test('rejects evil with claude.ai in path', () => assertEq(isAllowedRemoteUrl('https://evil.com/claude.ai'), false));
test('rejects subdomain spoofing', () => assertEq(isAllowedRemoteUrl('https://claude.ai.evil.com'), false));
test('rejects javascript:', () => assertEq(isAllowedRemoteUrl('javascript:alert(1)'), false));
test('rejects file:', () => assertEq(isAllowedRemoteUrl('file:///etc/passwd'), false));
test('rejects malformed', () => assertEq(isAllowedRemoteUrl('not a url'), false));
test('rejects empty', () => assertEq(isAllowedRemoteUrl(''), false));
test('rejects null', () => assertEq(isAllowedRemoteUrl(null), false));
test('rejects non-string', () => assertEq(isAllowedRemoteUrl(123), false));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
