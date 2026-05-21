const fs = require('fs');
const path = require('path');
const os = require('os');
const { readMeta, readLastEvent } = require('../subagents');

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

section('readLastEvent:');

function writeJsonl(dir, name, events) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

test('returns last parsed event of small file', () => {
  const dir = tmpDir();
  const p = writeJsonl(dir, 'a.jsonl', [
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn' } },
  ]);
  const ev = readLastEvent(p);
  if (ev.type !== 'assistant') throw new Error(`type=${ev.type}`);
  if (ev.message.stop_reason !== 'end_turn') throw new Error(`stop_reason=${ev.message.stop_reason}`);
});

test('handles single huge line at tail', () => {
  const dir = tmpDir();
  const big = { type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'z'.repeat(100 * 1024) }] } };
  const p = writeJsonl(dir, 'big.jsonl', [
    { type: 'user', message: { role: 'user', content: 'go' } },
    big,
  ]);
  const ev = readLastEvent(p);
  if (ev.message.stop_reason !== 'end_turn') throw new Error('tail read failed on huge line');
});

test('returns null on empty file', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'empty.jsonl');
  fs.writeFileSync(p, '');
  const ev = readLastEvent(p);
  if (ev !== null) throw new Error('expected null on empty');
});

test('returns null on missing file', () => {
  const ev = readLastEvent('/no/such/file.jsonl');
  if (ev !== null) throw new Error('expected null on missing');
});

test('skips trailing blank lines', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'trail.jsonl');
  fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn' } }) + '\n\n\n');
  const ev = readLastEvent(p);
  if (!ev || ev.type !== 'assistant') throw new Error('failed to skip blanks');
});

runAll().then(() => process.exit(failed > 0 ? 1 : 0));
