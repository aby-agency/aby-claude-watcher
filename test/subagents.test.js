const fs = require('fs');
const path = require('path');
const os = require('os');
const { readMeta } = require('../subagents');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ kind: 'test', name, fn }); }
function section(title) { queue.push({ kind: 'section', title }); }
async function runAll() {
  for (const item of queue) {
    if (item.kind === 'section') { console.log(`\n${item.title}`); continue; }
    try { await item.fn(); console.log(`  ✓ ${item.name}`); passed++; }
    catch (e) { console.error(`  ✗ ${item.name}: ${e.message}`); failed++; }
  }
}

const tmpFiles = [];
function tmpDir() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-test-'));
  tmpFiles.push(p);
  return p;
}
process.on('exit', () => {
  for (const p of tmpFiles) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
});

section('readMeta:');

test('reads agentType / description / toolUseId from meta.json', () => {
  const dir = tmpDir();
  const metaPath = path.join(dir, 'agent-abc123.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    agentType: 'general-purpose',
    description: 'Audit UI/UX',
    toolUseId: 'toolu_xyz',
  }));
  const meta = readMeta(metaPath);
  if (meta.agentType !== 'general-purpose') throw new Error(`agentType=${meta.agentType}`);
  if (meta.description !== 'Audit UI/UX') throw new Error(`description=${meta.description}`);
  if (meta.toolUseId !== 'toolu_xyz') throw new Error(`toolUseId=${meta.toolUseId}`);
});

test('returns null on missing file', () => {
  const meta = readMeta('/nonexistent/path.meta.json');
  if (meta !== null) throw new Error(`expected null, got ${JSON.stringify(meta)}`);
});

test('returns null on malformed JSON', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'bad.meta.json');
  fs.writeFileSync(p, '{not json');
  const meta = readMeta(p);
  if (meta !== null) throw new Error(`expected null on malformed`);
});

runAll().then(() => process.exit(failed > 0 ? 1 : 0));
