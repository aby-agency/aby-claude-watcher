# Subagent Detection & Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect background Claude Code subagents launched from monitored sessions and display the currently-running ones as nested sub-cards under their parent session card.

**Architecture:** A new `subagents.js` module discovers per-session subagent JSONL files at `~/.claude/projects/<proj>/<sessionId>/subagents/agent-*.jsonl`, derives state (running/completed/error) from last event + mtime, and exposes only **background + running** subagents. `watcher.js` collects an in-memory map of `toolUseId → run_in_background` from parent JSONL `Agent` tool_use events to enable the background filter. The renderer extends `cardHTML` with a `subagents` block. No new IPC channel — subagents ride along with `serializeSession` payloads.

**Tech Stack:** Node.js, Electron IPC (existing), vanilla DOM rendering (existing). No new dependencies.

---

## Background: empirical findings

These facts drove the design — they are not hypotheses, they were verified against the Fafa project JSONLs on 2026-05-21:

1. **Path** — Every dispatched subagent (foreground AND background) writes a JSONL at
   `~/.claude/projects/<projectSlug>/<sessionId>/subagents/agent-<agentId>.jsonl`
   plus a metadata file `agent-<agentId>.meta.json` containing exactly:
   ```json
   { "agentType": "general-purpose", "description": "...", "toolUseId": "toolu_..." }
   ```
2. **Lifecycle marker** — A finished subagent JSONL ends with `type: "assistant"` and `message.stop_reason === "end_turn"` (28/33 observed). Crashed/interrupted ones end with `stop_reason: null`.
3. **No `end_turn` ≠ alive** — Files persist 44h+ after completion. Use mtime to disambiguate (mtime stable > 5s + null stop_reason ⇒ crashed; mtime moving ⇒ still running).
4. **Background vs foreground** — Both produce a `subagents/agent-*.jsonl`. Distinction lives only in the parent JSONL's `tool_use` event: `input.run_in_background === true`. The matching `meta.json` `toolUseId` is the join key.
5. **Parent has no completion signal** — The parent JSONL never re-references the `agentId` after `async_launched`. There is no `SubagentStop` event surfaced into the parent log. (Hooks exist but require user opt-in installation — out of scope.)

---

## File Structure

| Path | Responsibility |
|---|---|
| `subagents.js` (new) | Scan subagent JSONLs, parse last event, compute state, expose snapshot. Stateless re-scan per call. |
| `watcher.js` (modify) | Capture `Agent` tool_use → `toolUseId → { runInBackground, dispatchTs }` map per session. Trigger subagent scan when a session updates. |
| `main.js` (modify) | Wire SubagentTracker. Extend `serializeSession` with `subagents: []`. |
| `ui/renderer.js` (modify) | Render subagent rows under `cardHTML` when `s.subagents.length > 0`. |
| `ui/styles.css` (modify) | Style nested subagent rows. |
| `test/subagents.test.js` (new) | Unit tests for parsing, state derivation, filtering. |
| `test/watcher.test.js` (modify) | Add tests for `Agent` tool_use capture. |
| `package.json` (modify) | Add `node test/subagents.test.js` to `scripts.test`. |

---

## Data model

### `SubagentInfo` (what flows through IPC and renderer)
```js
{
  agentId: "a4aa6e6b23e0ae25d",      // from meta.json file name
  parentSessionId: "e0da1ae8-...",   // owner session
  description: "Audit UI/UX rôle Admin",  // from meta.json
  agentType: "general-purpose",      // from meta.json
  toolUseId: "toolu_...",            // from meta.json (joins to parent's tool_use)
  runInBackground: true,             // from parent's tool_use input
  state: "running" | "completed" | "error",
  dispatchTs: 1747676219000,         // ms epoch, from parent tool_use timestamp
  lastEventTs: 1747676299000,        // ms epoch, file mtime
}
```

### Per-session map in `SessionWatcher`
```js
session.agentDispatches = new Map(); // toolUseId → { runInBackground: bool, dispatchTs: number }
```

### Filter contract
The renderer receives **only**:
- subagents with `runInBackground === true`
- subagents with `state === 'running'`

---

## Constants

Add to top of `subagents.js`:
```js
const STALE_THRESHOLD_MS = 5000;   // mtime older than this with no end_turn ⇒ not running anymore
const ERROR_TIMEOUT_MS = 30000;    // mtime older than this with null stop_reason ⇒ crashed
const TAIL_BYTES = 64 * 1024;      // how much of the JSONL tail to read for last event
```

Rationale: `STALE_THRESHOLD_MS` matches the parent `WAITING_DELAY` heuristic feel. `TAIL_BYTES` matches `fastInitialLoad`'s existing tail strategy in `watcher.js`. `ERROR_TIMEOUT_MS` is a conservative window to avoid flagging slow tool calls as errors.

---

## Task 1: Create `subagents.js` skeleton with `readMeta`

**Files:**
- Create: `subagents.js`
- Create: `test/subagents.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/subagents.test.js`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/subagents.test.js`
Expected: FAIL with `Cannot find module '../subagents'`

- [ ] **Step 3: Write minimal implementation**

Create `subagents.js`:
```js
const fs = require('fs');

function readMeta(metaPath) {
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { readMeta };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/subagents.test.js`
Expected: `✓ reads agentType / description / toolUseId from meta.json`, `✓ returns null on missing file`, `✓ returns null on malformed JSON`

- [ ] **Step 5: Commit**

```bash
git add subagents.js test/subagents.test.js
git commit -m "feat(subagents): readMeta() — parse agent-*.meta.json"
```

---

## Task 2: Add `readLastEvent` — tail-read the subagent JSONL

**Files:**
- Modify: `subagents.js`
- Modify: `test/subagents.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/subagents.test.js` (before the final `runAll()` call):
```js
section('readLastEvent:');

const { readLastEvent } = require('../subagents');

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/subagents.test.js`
Expected: FAIL with `readLastEvent is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `subagents.js`:
```js
const TAIL_BYTES = 64 * 1024;

function readLastEvent(jsonlPath) {
  let fd;
  try {
    const stat = fs.statSync(jsonlPath);
    if (stat.size === 0) return null;
    fd = fs.openSync(jsonlPath, 'r');
    let start = Math.max(0, stat.size - TAIL_BYTES);
    let buf;
    // Grow tail window until we have at least one complete line ending,
    // or until we have read the whole file.
    while (true) {
      const len = stat.size - start;
      buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const text = buf.toString('utf-8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      // If we are at the beginning of the file, or have multiple lines,
      // the last line is complete.
      if (start === 0 || lines.length > 1) {
        const last = lines[lines.length - 1];
        if (!last) return null;
        try { return JSON.parse(last); } catch { return null; }
      }
      // Single (possibly truncated) line — grow window
      if (start === 0) break;
      start = Math.max(0, start - TAIL_BYTES);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

module.exports = { readMeta, readLastEvent };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/subagents.test.js`
Expected: all `readLastEvent:` tests pass.

- [ ] **Step 5: Commit**

```bash
git add subagents.js test/subagents.test.js
git commit -m "feat(subagents): readLastEvent() — tail-read JSONL with huge-line safety"
```

---

## Task 3: Add `deriveState` — running / completed / error

**Files:**
- Modify: `subagents.js`
- Modify: `test/subagents.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/subagents.test.js`:
```js
section('deriveState:');

const { deriveState } = require('../subagents');

test('end_turn + recent mtime ⇒ completed (transitioning out)', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: 'end_turn' } },
    Date.now()  // mtime = now
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

test('null stop_reason + mtime > 30s ⇒ error', () => {
  const state = deriveState(
    { type: 'assistant', message: { stop_reason: null } },
    Date.now() - 60_000
  );
  if (state !== 'error') throw new Error(`expected error, got ${state}`);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/subagents.test.js`
Expected: FAIL with `deriveState is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `subagents.js`:
```js
const STALE_THRESHOLD_MS = 5000;
const ERROR_TIMEOUT_MS = 30000;

function deriveState(lastEvent, mtimeMs, nowMs = Date.now()) {
  if (!lastEvent) return 'error';

  const msg = lastEvent.message || {};
  const stopReason = msg.stop_reason;
  const ageMs = nowMs - mtimeMs;

  // Definitive completion: end_turn, no matter the age.
  if (stopReason === 'end_turn') return 'completed';

  // Stale + null stop_reason ⇒ crashed.
  if (stopReason == null && ageMs > ERROR_TIMEOUT_MS) return 'error';

  // Otherwise still in flight.
  return 'running';
}

module.exports = { readMeta, readLastEvent, deriveState,
                   STALE_THRESHOLD_MS, ERROR_TIMEOUT_MS, TAIL_BYTES };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/subagents.test.js`
Expected: all `deriveState:` tests pass.

- [ ] **Step 5: Commit**

```bash
git add subagents.js test/subagents.test.js
git commit -m "feat(subagents): deriveState() — running/completed/error from last event + mtime"
```

---

## Task 4: Add `scanSession` — discover subagents under a session dir

**Files:**
- Modify: `subagents.js`
- Modify: `test/subagents.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/subagents.test.js`:
```js
section('scanSession:');

const { scanSession } = require('../subagents');

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
  // Drop the meta.json after the fact
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/subagents.test.js`
Expected: FAIL with `scanSession is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `subagents.js`:
```js
const path = require('path');

function scanSession(sessionDir, dispatches) {
  const out = [];
  const subDir = path.join(sessionDir, 'subagents');
  let entries;
  try { entries = fs.readdirSync(subDir); }
  catch { return out; }

  for (const entry of entries) {
    if (!entry.startsWith('agent-') || !entry.endsWith('.jsonl')) continue;
    const agentId = entry.slice('agent-'.length, -'.jsonl'.length);
    const jsonlPath = path.join(subDir, entry);
    const metaPath = path.join(subDir, `agent-${agentId}.meta.json`);

    const meta = readMeta(metaPath);
    if (!meta) continue;  // orphan: skip

    let stat;
    try { stat = fs.statSync(jsonlPath); } catch { continue; }

    const lastEvent = readLastEvent(jsonlPath);
    const state = deriveState(lastEvent, stat.mtimeMs);

    const dispatch = dispatches.get(meta.toolUseId);

    out.push({
      agentId,
      description: meta.description,
      agentType: meta.agentType,
      toolUseId: meta.toolUseId,
      runInBackground: dispatch ? dispatch.runInBackground : undefined,
      dispatchTs: dispatch ? dispatch.dispatchTs : null,
      lastEventTs: stat.mtimeMs,
      state,
    });
  }
  return out;
}

module.exports = { readMeta, readLastEvent, deriveState, scanSession,
                   STALE_THRESHOLD_MS, ERROR_TIMEOUT_MS, TAIL_BYTES };
```

Note: the existing `const path = require('path')` at the top of `subagents.js` already exists from earlier; if Step 3 of an earlier task didn't add it, add it once at the top.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/subagents.test.js`
Expected: all `scanSession:` tests pass.

- [ ] **Step 5: Commit**

```bash
git add subagents.js test/subagents.test.js
git commit -m "feat(subagents): scanSession() — discover and stateify agents per session"
```

---

## Task 5: Capture `Agent` tool_use in `watcher.js` (parent → dispatches map)

**Files:**
- Modify: `watcher.js:50-67` (session creation — add `agentDispatches: new Map()`)
- Modify: `watcher.js:195-216` (second session creation site — same field)
- Modify: `watcher.js` around line 700 where tool_use is detected (the assistant-message handler) — capture Agent dispatches
- Modify: `test/watcher.test.js` — add a test

- [ ] **Step 1: Write the failing test**

Append to `test/watcher.test.js`, before the existing `runAll()` invocation, in a new section:
```js
section('Agent dispatch capture:');

test('Agent tool_use populates session.agentDispatches', () => {
  const tmp = tmpJsonl('agent-dispatch');
  const userEv = { type: 'user', message: { role: 'user', content: 'go' },
                   timestamp: '2026-05-21T10:00:00.000Z' };
  const assistEv = {
    type: 'assistant',
    message: { role: 'assistant',
      content: [
        { type: 'text', text: 'launching' },
        { type: 'tool_use', id: 'toolu_bg1', name: 'Agent',
          input: { description: 'D1', subagent_type: 'general-purpose', run_in_background: true } },
        { type: 'tool_use', id: 'toolu_fg1', name: 'Agent',
          input: { description: 'D2', subagent_type: 'general-purpose' } },
      ],
      stop_reason: 'tool_use' },
    timestamp: '2026-05-21T10:00:30.000Z',
  };
  fs.writeFileSync(tmp, [JSON.stringify(userEv), JSON.stringify(assistEv), ''].join('\n'));

  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('S', makeSession('S', { state: STATES.RUNNING }));
  w.fastInitialLoad('S', tmp);

  const s = w.sessions.get('S');
  if (!s.agentDispatches) throw new Error('agentDispatches not initialized');
  const bg = s.agentDispatches.get('toolu_bg1');
  const fg = s.agentDispatches.get('toolu_fg1');
  if (!bg || bg.runInBackground !== true) throw new Error(`bg=${JSON.stringify(bg)}`);
  if (!fg || fg.runInBackground !== false) throw new Error(`fg=${JSON.stringify(fg)}`);
});
```

Also update `makeSession` (top of `test/watcher.test.js`) to include `agentDispatches: new Map()`:
```js
function makeSession(id, overrides = {}) {
  return {
    sessionId: id,
    pid: process.pid,
    cwd: '/tmp',
    projectName: 'tmp',
    slug: '',
    state: STATES.RUNNING,
    lastTool: null,
    model: null,
    gitBranch: null,
    startedAt: new Date().toISOString(),
    tokens: { input: 0, output: 0 },
    terminalApp: null,
    terminalId: null,
    lastEventTime: Date.now(),
    hasActivity: true,
    agentDispatches: new Map(),
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/watcher.test.js`
Expected: FAIL on `agentDispatches not initialized` OR on `bg=undefined` (the dispatch isn't being captured).

- [ ] **Step 3: Add `agentDispatches` to session shape in both creation sites**

In `watcher.js` around line 50 (inside `start()` where saved sessions are restored), add to the session object literal:
```js
agentDispatches: new Map(),
```

In `watcher.js` around line 195 (inside `scan()` where new sessions are created), add the same field.

In `watcher.js` around line 220 (the second `this.sessions.set(effectiveId, …)` site if it has a separate literal), add the same field. **Action**: open `watcher.js` and search for every `this.sessions.set(` followed by an object literal; add `agentDispatches: new Map(),` to each.

- [ ] **Step 4: Capture Agent tool_use in the JSONL parse path**

In `watcher.js`, locate the assistant-message handler around lines 700–715 (the block containing `const hasToolUse = content.some(c => c.type === 'tool_use')` and `const lastToolUse = [...content].reverse().find(c => c.type === 'tool_use')`).

Right after `const lastToolUse = ...`, add:
```js
// Capture any Agent dispatches so subagents.js can filter foreground vs background.
const tsMs = ev.timestamp ? Date.parse(ev.timestamp) : Date.now();
for (const c of content) {
  if (c.type === 'tool_use' && c.name === 'Agent' && c.id) {
    session.agentDispatches.set(c.id, {
      runInBackground: !!(c.input && c.input.run_in_background),
      dispatchTs: tsMs,
    });
  }
}
```

If the local variable for the event is named differently than `ev` (e.g. `evt`, `event`), use that name. Verify by reading 5 lines of context around `lastToolUse`.

If the same parse logic exists in `fastInitialLoad` separately (it does — see watcher.test.js line 80–125), apply the same capture block there too. The test in Step 1 exercises `fastInitialLoad` so you'll catch it.

- [ ] **Step 5: Run all watcher tests**

Run: `node test/watcher.test.js`
Expected: the new test passes, no existing test regresses.

- [ ] **Step 6: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "feat(watcher): capture Agent tool_use dispatches per session"
```

---

## Task 6: Wire `SubagentTracker` into `main.js` + extend `serializeSession`

**Files:**
- Modify: `subagents.js` — add `SubagentTracker` class
- Modify: `main.js:117-125` (watcher event hookup) and `main.js:395-410` (`serializeSession`)
- Create: append to `test/subagents.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/subagents.test.js`:
```js
section('SubagentTracker:');

const { SubagentTracker } = require('../subagents');

test('snapshot returns only background+running subagents for a session', () => {
  const sessionDir = setupSessionDir({ agents: [
    // Background, running
    { id: 'bgRun', tuid: 'tu_bgRun',
      events: [{ type: 'assistant', message: { stop_reason: null } }] },
    // Background, completed (filtered out)
    { id: 'bgDone', tuid: 'tu_bgDone',
      events: [{ type: 'assistant', message: { stop_reason: 'end_turn' } }] },
    // Foreground, running (filtered out)
    { id: 'fgRun', tuid: 'tu_fgRun',
      events: [{ type: 'assistant', message: { stop_reason: null } }] },
  ]});
  const dispatches = new Map([
    ['tu_bgRun',  { runInBackground: true,  dispatchTs: 1 }],
    ['tu_bgDone', { runInBackground: true,  dispatchTs: 2 }],
    ['tu_fgRun',  { runInBackground: false, dispatchTs: 3 }],
  ]);

  const tracker = new SubagentTracker();
  const result = tracker.snapshotForSession(sessionDir, dispatches);

  if (result.length !== 1) throw new Error(`expected 1, got ${result.length}: ${JSON.stringify(result.map(r => r.agentId))}`);
  if (result[0].agentId !== 'bgRun') throw new Error(`got ${result[0].agentId}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/subagents.test.js`
Expected: FAIL with `SubagentTracker is not a constructor`

- [ ] **Step 3: Implement `SubagentTracker`**

Append to `subagents.js`:
```js
class SubagentTracker {
  // Stateless: re-scans on demand. Kept as a class to leave room for caching later.
  snapshotForSession(sessionDir, dispatches) {
    return scanSession(sessionDir, dispatches)
      .filter(sa => sa.runInBackground === true && sa.state === 'running');
  }
}

module.exports = { readMeta, readLastEvent, deriveState, scanSession,
                   SubagentTracker,
                   STALE_THRESHOLD_MS, ERROR_TIMEOUT_MS, TAIL_BYTES };
```

- [ ] **Step 4: Run subagents tests**

Run: `node test/subagents.test.js`
Expected: all green.

- [ ] **Step 5: Wire into `main.js`**

In `main.js`, near the existing `const config = require('./config');` and `const SessionWatcher = require('./watcher');` imports, add:
```js
const { SubagentTracker } = require('./subagents');
```

Below where `watcher` is instantiated, add:
```js
const subagentTracker = new SubagentTracker();
```

Locate `serializeSession` at `main.js:395`. Extend the returned object with a `subagents` field. **Find the session directory** — sessions live at `<PROJECTS_DIR>/<projectSlug>/<sessionId>/`. The `projectSlug` is derived from the cwd (see `watcher.js` for the slugification — `path.basename` with `/` → `-`). Easiest: pass the full session directory path from watcher to main, OR derive it here.

Recommended approach — add a helper at top of `main.js` (after requires):
```js
const path = require('path');
const os = require('os');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function sessionDirFor(session) {
  // The project slug used by Claude Code mirrors the cwd path with separators
  // collapsed to '-'. We mirror watcher.js's derivation.
  if (!session.cwd) return null;
  const slug = '-' + session.cwd.replace(/^\//, '').replace(/\//g, '-');
  return path.join(PROJECTS_DIR, slug, session.sessionId);
}
```

Verify the slug derivation by reading `watcher.js` around the place where it computes `projectName` / slugs (search for `replace(/\//g`). If the convention is `-Users-invictorius-Project-Fafa` for `/Users/invictorius/Project/Fafa`, the formula above is correct (matches what was observed in the JSONL paths).

Then in `serializeSession`:
```js
function serializeSession(session) {
  const sessionDir = sessionDirFor(session);
  const dispatches = session.agentDispatches || new Map();
  const subagents = sessionDir
    ? subagentTracker.snapshotForSession(sessionDir, dispatches)
    : [];

  return {
    sessionId: session.sessionId,
    projectName: session.projectName,
    customName: config.getCustomName(session.sessionId),
    slug: session.slug,
    state: session.state,
    lastTool: session.lastTool,
    model: session.model,
    gitBranch: session.gitBranch || null,
    startedAt: session.startedAt,
    tokens: session.tokens,
    cwd: session.cwd,
    notifEnabled: (() => { const p = config.getNotificationPrefs(session.sessionId); return !!(p.modal || p.sound); })(),
    subagents,  // ← added
  };
}
```

- [ ] **Step 6: Smoke test the wiring**

Run: `npm run dev`
Expected: app launches without crash; existing sessions render normally (subagents array empty if no current Fafa-style session active).

If a current Claude Code session has launched background agents, inspect via DevTools `await window.api.getSessions()` and confirm at least one session payload contains a `subagents` array with one or more entries having `state: 'running'` and `runInBackground: true`.

- [ ] **Step 7: Commit**

```bash
git add subagents.js main.js test/subagents.test.js
git commit -m "feat(main): wire SubagentTracker — serialize background subagents per session"
```

---

## Task 7: Render subagent sub-cards in the grid view

**Files:**
- Modify: `ui/renderer.js:707-761` (`cardHTML`)
- Modify: `ui/styles.css` (append subagent styles)

- [ ] **Step 1: Add the renderer helper**

In `ui/renderer.js`, just before `function cardHTML(s)` (around line 707), add:
```js
function subagentRowHTML(sa) {
  const desc = esc(sa.description || sa.agentType || 'subagent');
  const type = esc(sa.agentType || '');
  // Always shows a green spinner — state is filtered to 'running' upstream.
  return `
    <div class="subagent-row" data-agent="${escAttr(sa.agentId)}">
      <span class="subagent-spinner"></span>
      <span class="subagent-type">${type}</span>
      <span class="subagent-desc" title="${desc}">${desc}</span>
    </div>
  `;
}

function subagentsBlockHTML(s) {
  if (!s.subagents || s.subagents.length === 0) return '';
  const rows = s.subagents.map(subagentRowHTML).join('');
  const count = s.subagents.length;
  const label = count === 1 ? 'sous-agent' : 'sous-agents';
  return `
    <div class="subagents-block" data-count="${count}">
      <div class="subagents-header">${count} ${label} en cours</div>
      ${rows}
    </div>
  `;
}
```

- [ ] **Step 2: Insert into `cardHTML`**

In `cardHTML`, after the closing `</div>` of `.card-details` and before the outer `</div>` that closes `.card`, insert:
```js
        ${subagentsBlockHTML(s)}
```

The resulting tail of `cardHTML` looks like:
```js
        <div class="detail">
          <span class="detail-label">${t('tool')}</span>
          <span class="detail-value">${(stateName === 'running' || stateName === 'thinking') ? toolPill(s.lastTool) : toolPill(null)}</span>
        </div>
      </div>
      ${subagentsBlockHTML(s)}
    </div>
  `;
}
```

- [ ] **Step 3: Add CSS**

Append to `ui/styles.css`:
```css
/* ─── Subagents block (nested under session card) ─── */
.subagents-block {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-subtle, rgba(255,255,255,0.08));
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.subagents-header {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary, #9ca3af);
  margin-bottom: 2px;
}
.subagent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgba(34, 197, 94, 0.06);
  border-left: 2px solid #22c55e;
  border-radius: 3px;
  font-size: 11px;
  overflow: hidden;
}
.subagent-spinner {
  width: 8px;
  height: 8px;
  border: 1.5px solid rgba(34, 197, 94, 0.35);
  border-top-color: #22c55e;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
.subagent-type {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--text-secondary, #9ca3af);
  flex-shrink: 0;
}
.subagent-desc {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary, #e5e7eb);
}
```

Check that a `@keyframes spin` is already defined in `ui/styles.css`. If not, append:
```css
@keyframes spin { to { transform: rotate(360deg); } }
```
(Likely already present — used by the existing card spinner.)

- [ ] **Step 4: Manual verification**

Run: `npm run dev`

Pick a Claude Code session and ask it to launch a background subagent (e.g. an `Agent` dispatch with `run_in_background: true`). Within ~2s, the watcher card should grow a green-bordered nested row showing the agent type and description.

Confirm:
- Sub-cards appear only for background dispatches (not foreground).
- Sub-cards disappear as soon as the subagent finishes (`stop_reason: end_turn` written to its JSONL).
- Multiple concurrent subagents stack vertically.
- The session card state itself does not change because of subagents — they ride along independently.

**If you cannot launch a subagent in this environment**: at least open DevTools and call `window.api.getSessions()`. Pick one and confirm `.subagents` is an array (likely empty in your dev session). The structural plumbing is what we can verify without a live subagent.

State explicitly in your handoff: "verified end-to-end with live subagent" OR "verified plumbing only — no live subagent available".

- [ ] **Step 5: Commit**

```bash
git add ui/renderer.js ui/styles.css
git commit -m "ui(subagents): nested sub-cards under session showing live background agents"
```

---

## Task 8: Update package.json test script + bump version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add subagents tests to test script**

In `package.json`, locate `"scripts"."test"` (currently chains `url.test.js && focus.test.js && config.test.js && updater.test.js && watcher.test.js`). Append `&& node test/subagents.test.js`.

After change:
```json
"test": "node test/url.test.js && node test/focus.test.js && node test/config.test.js && node test/updater.test.js && node test/watcher.test.js && node test/subagents.test.js"
```

- [ ] **Step 2: Bump patch version**

Bump `package.json` `version` from `1.6.1` (or current) to the next minor — this is a feature, not a fix. E.g. `1.6.1` → `1.7.0`.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all five test files green.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(v1.7.0): bump version, run subagents tests in suite"
```

---

## Self-Review

**Spec coverage**

| Requirement | Task |
|---|---|
| Detect subagents in `<session>/subagents/agent-*.jsonl` | Task 4 (`scanSession`) |
| Parse `agent-*.meta.json` for description/type | Task 1 (`readMeta`) |
| Derive state running/completed/error from last event + mtime | Task 3 (`deriveState`) |
| Distinguish background vs foreground via parent JSONL | Task 5 (`agentDispatches` map) |
| Filter to **background only + running only** | Task 6 (`SubagentTracker.snapshotForSession`) |
| Display as nested sub-cards in parent card | Task 7 (`subagentsBlockHTML` + CSS) |
| Test coverage | Tasks 1–6 each include tests |
| No breaking changes to existing card / IPC contract | Task 6 — `subagents` is an additive field on serialized session |

**Placeholder scan**

No `TBD` / `add appropriate error handling` / `similar to Task N` / `implement later`. Every code step shows the actual code. Manual UI verification in Task 7 Step 4 is explicit about what to confirm and how to report when a live subagent is unavailable.

**Type consistency**

- `agentDispatches` is `Map<toolUseId, { runInBackground, dispatchTs }>` everywhere (Tasks 5, 6).
- `SubagentInfo` fields used in renderer (`agentId`, `description`, `agentType`) match those produced by `scanSession` in Task 4.
- `STATES` (in `watcher.js`) is **not extended** for subagents — they use their own string states `'running' | 'completed' | 'error'`. This is intentional: subagents are not first-class sessions and don't need to participate in the parent state machine or notifications.

**Known limitations (intentional, documented for executor)**

- Subagents from sessions that are no longer scanned (`watcher.sessions` doesn't include them) are not displayed even if their JSONLs exist. This is fine — the user wants "only running", and stale-file detection is unreliable without the parent context.
- `sessionDirFor()` derives the project slug from `cwd` using the `/path/to/x` → `-path-to-x` rule observed empirically. If a future Claude Code version changes the slug rule, this helper is the single point to update.
- Foreground subagents are completely hidden by design (user decision 2026-05-21). They still get captured in `agentDispatches` so a future toggle could surface them with no schema change.
- No notifications for subagent completion. Out of scope. If wanted later, hook into `scanSession`'s diff with previous snapshot.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-subagent-detection.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
