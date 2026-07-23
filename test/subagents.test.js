const fs = require('fs');
const path = require('path');
const os = require('os');
const { readMeta, readLastEvent, deriveState, scanSession, SubagentTracker, hasBlockingForegroundAgent } = require('../subagents');

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

section('deriveState:');

test('end_turn + recent mtime ⇒ completed', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: 'end_turn' } },
    Date.now()
  );
  if (state !== 'completed') throw new Error(`expected completed, got ${state}`);
});

test('end_turn + old mtime ⇒ completed', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: 'end_turn' } },
    Date.now() - 60_000
  );
  if (state !== 'completed') throw new Error(`expected completed, got ${state}`);
});

test('tool_use stop_reason + recent mtime ⇒ running', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: 'tool_use' } },
    Date.now() - 1000
  );
  if (state !== 'running') throw new Error(`expected running, got ${state}`);
});

test('null stop_reason + recent mtime ⇒ running', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: null } },
    Date.now() - 1000
  );
  if (state !== 'running') throw new Error(`expected running, got ${state}`);
});

test('null stop_reason + mtime > 30s ⇒ stale (long thinking, pas mort)', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: null } },
    Date.now() - 60_000
  );
  if (state !== 'stale') throw new Error(`expected stale, got ${state}`);
});

test('null stop_reason + mtime > 5min ⇒ error', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: null } },
    Date.now() - 6 * 60_000
  );
  if (state !== 'error') throw new Error(`expected error, got ${state}`);
});

test('hasBlockingForegroundAgent : stale foreground ne bloque pas', () => {
  const blocking = hasBlockingForegroundAgent([
    { state: 'stale', runInBackground: false },
  ]);
  if (blocking !== false) throw new Error(`expected false, got ${blocking}`);
});

test('null lastEvent ⇒ error', () => {
  const state = deriveState(null, Date.now());
  if (state !== 'error') throw new Error(`expected error, got ${state}`);
});

test('user event last (mid-tool-cycle) + recent mtime ⇒ running', () => {
  const state = deriveState(
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] } },
    Date.now() - 500
  );
  if (state !== 'running') throw new Error(`expected running, got ${state}`);
});

section('scanSession:');

function setupSessionDir(opts = {}) {
  const root = tmpDir();
  const sessionDir = path.join(root, 'sess1');
  const subDir = path.join(sessionDir, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });

  for (const a of opts.agents || []) {
    fs.writeFileSync(path.join(subDir, `agent-${a.id}.meta.json`),
      JSON.stringify({ agentType: a.type || 'general-purpose',
                       description: a.desc || 'x',
                       toolUseId: a.tuid || `toolu_${a.id}` }));
    fs.writeFileSync(path.join(subDir, `agent-${a.id}.jsonl`),
      (a.events || []).map(e => JSON.stringify(e)).join('\n') + '\n');
    if (a.mtimeAgoMs != null) {
      const mtime = (Date.now() - a.mtimeAgoMs) / 1000;
      fs.utimesSync(path.join(subDir, `agent-${a.id}.jsonl`), mtime, mtime);
    }
  }
  return sessionDir;
}

test('returns [] for non-existent session dir', () => {
  const r = scanSession('/nope', new Map());
  if (!Array.isArray(r) || r.length !== 0) throw new Error(`expected []`);
});

test('discovers all agents (no filter applied yet)', () => {
  const sessionDir = setupSessionDir({ agents: [
    { id: 'a1', desc: 'one', events: [{ type: 'assistant', message: { stop_reason: 'end_turn' } }] },
    { id: 'a2', desc: 'two', events: [{ type: 'assistant', message: { stop_reason: null } }],
      mtimeAgoMs: 1000 },
  ]});
  const dispatches = new Map([
    ['toolu_a1', { runInBackground: true, dispatchTs: 1000 }],
    ['toolu_a2', { runInBackground: true, dispatchTs: 2000 }],
  ]);
  const r = scanSession(sessionDir, dispatches);
  if (r.length !== 2) throw new Error(`expected 2, got ${r.length}`);
  const a1 = r.find(s => s.agentId === 'a1');
  if (a1.state !== 'completed') throw new Error(`a1.state=${a1.state}`);
  if (a1.description !== 'one') throw new Error(`a1.description=${a1.description}`);
  const a2 = r.find(s => s.agentId === 'a2');
  if (a2.state !== 'running') throw new Error(`a2.state=${a2.state}`);
});

test('skips orphan jsonl with no meta.json', () => {
  const sessionDir = setupSessionDir({ agents: [
    { id: 'good', events: [{ type: 'assistant', message: { stop_reason: 'end_turn' } }] },
  ]});
  fs.unlinkSync(path.join(sessionDir, 'subagents', 'agent-good.meta.json'));
  const r = scanSession(sessionDir, new Map());
  if (r.length !== 0) throw new Error(`expected 0, got ${r.length}`);
});

test('attaches dispatch metadata (runInBackground, dispatchTs) when matched', () => {
  const sessionDir = setupSessionDir({ agents: [
    { id: 'bg', tuid: 'toolu_bg', events: [{ type: 'assistant', message: { stop_reason: null } }] },
    { id: 'fg', tuid: 'toolu_fg', events: [{ type: 'assistant', message: { stop_reason: null } }] },
  ]});
  const dispatches = new Map([
    ['toolu_bg', { runInBackground: true, dispatchTs: 1000 }],
    ['toolu_fg', { runInBackground: false, dispatchTs: 2000 }],
  ]);
  const r = scanSession(sessionDir, dispatches);
  const bg = r.find(s => s.agentId === 'bg');
  const fg = r.find(s => s.agentId === 'fg');
  if (bg.runInBackground !== true) throw new Error(`bg.runInBackground=${bg.runInBackground}`);
  if (fg.runInBackground !== false) throw new Error(`fg.runInBackground=${fg.runInBackground}`);
  if (bg.dispatchTs !== 1000) throw new Error(`bg.dispatchTs=${bg.dispatchTs}`);
});

test('runInBackground defaults to undefined when no dispatch entry exists', () => {
  const sessionDir = setupSessionDir({ agents: [
    { id: 'orphan', tuid: 'toolu_orphan', events: [{ type: 'assistant', message: { stop_reason: null } }] },
  ]});
  const r = scanSession(sessionDir, new Map());
  if (r[0].runInBackground !== undefined) throw new Error(`expected undefined`);
});

section('SubagentTracker:');

test('snapshot returns all running subagents (foreground + background)', () => {
  const sessionDir = setupSessionDir({ agents: [
    // Background, running → included
    { id: 'bgRun', tuid: 'tu_bgRun',
      events: [{ type: 'assistant', message: { stop_reason: null } }] },
    // Background, completed → excluded (not running)
    { id: 'bgDone', tuid: 'tu_bgDone',
      events: [{ type: 'assistant', message: { stop_reason: 'end_turn' } }] },
    // Foreground, running → included (the fleet view; was filtered out before)
    { id: 'fgRun', tuid: 'tu_fgRun',
      events: [{ type: 'assistant', message: { stop_reason: null } }] },
  ]});
  const dispatches = new Map([
    ['tu_bgRun',  { runInBackground: true,  dispatchTs: 1 }],
    ['tu_bgDone', { runInBackground: true,  dispatchTs: 2 }],
    ['tu_fgRun',  { runInBackground: false, dispatchTs: 3 }],
  ]);

  const tracker = new SubagentTracker();
  const ids = tracker.snapshotForSession(sessionDir, dispatches).map(r => r.agentId).sort();

  if (JSON.stringify(ids) !== JSON.stringify(['bgRun', 'fgRun'])) {
    throw new Error(`expected [bgRun, fgRun], got ${JSON.stringify(ids)}`);
  }
});

section('hasBlockingForegroundAgent:');

test('true when a running foreground agent is present (parent is blocked)', () => {
  const snap = [
    { agentId: 'a', state: 'running', runInBackground: true },   // background, parallel
    { agentId: 'b', state: 'running', runInBackground: false },  // foreground, blocks parent
  ];
  if (hasBlockingForegroundAgent(snap) !== true) throw new Error('expected true');
});

test('false when only background agents run (parent can legitimately wait on you)', () => {
  const snap = [
    { agentId: 'a', state: 'running', runInBackground: true },
    { agentId: 'b', state: 'running', runInBackground: true },
  ];
  if (hasBlockingForegroundAgent(snap) !== false) throw new Error('expected false');
});

test('false on empty snapshot', () => {
  if (hasBlockingForegroundAgent([]) !== false) throw new Error('expected false');
});

test('false when runInBackground is undefined (unknown dispatch — conservative)', () => {
  const snap = [{ agentId: 'a', state: 'running', runInBackground: undefined }];
  if (hasBlockingForegroundAgent(snap) !== false) throw new Error('expected false');
});

runAll().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
