// Tests for SessionWatcher state determination + migration safety.
// Run via `node test/watcher.test.js`.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { SessionWatcher, STATES } = require('../watcher');

function makeMockConfig() {
  const data = { sessions: {}, notifications: {}, customNames: {}, sessionOrder: [] };
  return {
    _data: data,
    getSavedSessions: () => data.sessions,
    saveSession: (id, sess) => { data.sessions[id] = sess; },
    deleteSession: (id) => {
      delete data.sessions[id];
      delete data.notifications[id];
      delete data.customNames[id];
    },
    getNotificationPrefs: (id) => data.notifications[id] || { modal: false, sound: false },
    setNotificationPrefs: (id, prefs) => { data.notifications[id] = prefs; },
    getCustomName: (id) => data.customNames[id] || null,
    setCustomName: (id, name) => {
      if (name) data.customNames[id] = name;
      else delete data.customNames[id];
    },
    get: () => data,
    save: () => {},
  };
}

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

let passed = 0, failed = 0;
// Async-aware test runner: queue tests + section headers, run sequentially.
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmpFiles = [];
function tmpJsonl(name) {
  const p = path.join(os.tmpdir(), `watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}.jsonl`);
  tmpFiles.push(p);
  return p;
}
process.on('exit', () => {
  for (const p of tmpFiles) { try { fs.unlinkSync(p); } catch {} }
});

// ─── fastInitialLoad: long assistant line ────────────────────────
section('fastInitialLoad — long assistant line:');

test('detects waiting when last assistant line > 64KB tail', () => {
  const tmp = tmpJsonl('long-assist');
  const longText = 'x'.repeat(100 * 1024);
  const userEv = { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-04-23T13:00:00.000Z' };
  const assistEv = {
    type: 'assistant',
    message: { model: 'claude-opus-4-7', role: 'assistant',
      content: [{ type: 'text', text: longText }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 } },
    timestamp: '2026-04-23T13:00:30.000Z',
  };
  const lpEv = { type: 'last-prompt', prompt: 'hi' };
  fs.writeFileSync(tmp, [JSON.stringify(userEv), JSON.stringify(assistEv), JSON.stringify(lpEv), ''].join('\n'));

  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('A', makeSession('A', { state: STATES.RUNNING }));
  w.fastInitialLoad('A', tmp);

  const s = w.sessions.get('A');
  if (s.state.name !== 'waiting') throw new Error(`expected waiting, got ${s.state.name}`);
});

test('detects running when last is tool_use even past tail boundary', () => {
  const tmp = tmpJsonl('tool-use-far');
  const longText = 'y'.repeat(80 * 1024);
  const assistEv = {
    type: 'assistant',
    message: { role: 'assistant',
      content: [{ type: 'text', text: longText },
                { type: 'tool_use', name: 'Bash', input: {} }],
      stop_reason: 'tool_use' },
    timestamp: '2026-04-23T13:00:30.000Z',
  };
  fs.writeFileSync(tmp, JSON.stringify(assistEv) + '\n');

  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('B', makeSession('B', { state: STATES.WAITING }));
  w.fastInitialLoad('B', tmp);

  const s = w.sessions.get('B');
  if (s.state.name !== 'running') throw new Error(`expected running, got ${s.state.name}`);
  if (s.lastTool !== 'Bash') throw new Error(`expected lastTool=Bash, got ${s.lastTool}`);
});

// ─── fastInitialLoad: persistence ────────────────────────────────
section('fastInitialLoad — persistence:');

test('persists determined state to config', () => {
  const tmp = tmpJsonl('persist');
  const assistEv = {
    type: 'assistant',
    message: { role: 'assistant',
      content: [{ type: 'text', text: 'short' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 10 } },
    timestamp: '2026-04-23T13:00:30.000Z',
  };
  fs.writeFileSync(tmp, JSON.stringify(assistEv) + '\n');

  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('C', makeSession('C', { state: STATES.RUNNING }));
  w.fastInitialLoad('C', tmp);

  const persisted = config.getSavedSessions()['C'];
  if (!persisted) throw new Error('session not persisted');
  if (persisted.stateName !== 'waiting') throw new Error(`expected stateName=waiting, got ${persisted.stateName}`);
});

// ─── /clear detection: helper unit tests ─────────────────────────
section('detection helpers:');

test('isSidStale: true when sid jsonl is older than 30s', () => {
  const w = new SessionWatcher(makeMockConfig());
  w._cwdToProjectDir = () => '/fake-projdir';
  const fs = require('fs');
  const realStat = fs.statSync;
  fs.statSync = (p) => p === '/fake-projdir/OLD.jsonl' ? { mtimeMs: Date.now() - 60000 } : realStat(p);
  try {
    if (!w._isSidStale('OLD', '/tmp/proj')) throw new Error('expected stale');
  } finally { fs.statSync = realStat; }
});

test('isSidStale: false when sid jsonl is fresh', () => {
  const w = new SessionWatcher(makeMockConfig());
  w._cwdToProjectDir = () => '/fake-projdir';
  const fs = require('fs');
  const realStat = fs.statSync;
  fs.statSync = (p) => p === '/fake-projdir/FRESH.jsonl' ? { mtimeMs: Date.now() - 1000 } : realStat(p);
  try {
    if (w._isSidStale('FRESH', '/tmp/proj')) throw new Error('expected fresh');
  } finally { fs.statSync = realStat; }
});

test('findFreshUnclaimedJsonl: returns freshest jsonl not claimed by liveSession or earlier row', () => {
  const w = new SessionWatcher(makeMockConfig());
  w._cwdToProjectDir = () => '/fake-projdir';
  const now = Date.now();
  const fs = require('fs');
  const realReaddir = fs.readdirSync;
  const realStat = fs.statSync;
  fs.readdirSync = (p) => p === '/fake-projdir' ? ['NEW1.jsonl', 'NEW2.jsonl', 'STALE.jsonl', 'CLAIMED.jsonl'] : realReaddir(p);
  fs.statSync = (p) => {
    if (p === '/fake-projdir/NEW1.jsonl') return { mtimeMs: now - 1000 };
    if (p === '/fake-projdir/NEW2.jsonl') return { mtimeMs: now - 5000 };
    if (p === '/fake-projdir/STALE.jsonl') return { mtimeMs: now - 60000 };
    if (p === '/fake-projdir/CLAIMED.jsonl') return { mtimeMs: now - 500 };
    return realStat(p);
  };
  try {
    const live = new Set(['CLAIMED']); // appears in some session.json — not a /clear target
    const claimed = new Set();
    const result = w._findFreshUnclaimedJsonl('/tmp/proj', live, claimed);
    if (result !== 'NEW1') throw new Error(`expected NEW1, got ${result}`);
    // Mark NEW1 as claimed by this scan; next call must skip it.
    claimed.add('NEW1');
    const result2 = w._findFreshUnclaimedJsonl('/tmp/proj', live, claimed);
    if (result2 !== 'NEW2') throw new Error(`expected NEW2 after claim, got ${result2}`);
  } finally { fs.readdirSync = realReaddir; fs.statSync = realStat; }
});

test('findFreshUnclaimedJsonl: returns null when no fresh candidate exists', () => {
  const w = new SessionWatcher(makeMockConfig());
  w._cwdToProjectDir = () => '/fake-projdir';
  const now = Date.now();
  const fs = require('fs');
  const realReaddir = fs.readdirSync;
  const realStat = fs.statSync;
  fs.readdirSync = (p) => p === '/fake-projdir' ? ['ORPHAN1.jsonl', 'ORPHAN2.jsonl'] : realReaddir(p);
  fs.statSync = (p) => p.startsWith('/fake-projdir/ORPHAN') ? { mtimeMs: now - 600000 } : realStat(p);
  try {
    const result = w._findFreshUnclaimedJsonl('/tmp/proj', new Set(), new Set());
    if (result !== null) throw new Error(`expected null (all stale), got ${result}`);
  } finally { fs.readdirSync = realReaddir; fs.statSync = realStat; }
});

// ─── end-to-end scan() integration tests ─────────────────────────
section('scan() integration:');

// Build a fake `~/.claude/sessions/` + `~/.claude/projects/<cwd-slug>/` tree
// inside an OS tmpdir, then point the watcher at it via process.env. Each test
// creates the dirs, writes the session.json files and JSONLs with controlled
// mtimes, runs scan(), and inspects the resulting sessions map.
function makeFakeClaudeTree() {
  const root = path.join(os.tmpdir(), `aby-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const sessions = path.join(root, 'sessions');
  const projects = path.join(root, 'projects');
  fs.mkdirSync(sessions, { recursive: true });
  fs.mkdirSync(projects, { recursive: true });
  return { root, sessions, projects };
}

function writeSessionJson(sessionsDir, pid, sessionId, cwd, updatedAt = Date.now(), entrypoint = 'cli') {
  const data = { pid, sessionId, cwd, startedAt: Date.now(), status: 'busy', updatedAt, entrypoint };
  fs.writeFileSync(path.join(sessionsDir, `${pid}.json`), JSON.stringify(data));
}

function writeJsonl(projectsDir, cwd, sessionId, mtime) {
  const slug = cwd.replace(/\//g, '-');
  const projDir = path.join(projectsDir, slug);
  fs.mkdirSync(projDir, { recursive: true });
  const file = path.join(projDir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, '{"type":"file-history-snapshot"}\n');
  fs.utimesSync(file, mtime / 1000, mtime / 1000);
  return file;
}

function freshScanWatcher(claudeRoot) {
  // Re-require watcher.js with a patched CLAUDE_DIR via env. Since the real
  // module hardcodes paths, monkey-patch instead.
  const w = new SessionWatcher(makeMockConfig());
  // Override path-derivation helpers so scan reads from our fake tree.
  const fakeSessionsDir = path.join(claudeRoot, 'sessions');
  const fakeProjectsDir = path.join(claudeRoot, 'projects');
  // SessionWatcher.scan() uses module-level SESSIONS_DIR. We patch the prototype
  // method to substitute our path on the fly.
  const realScan = w.scan.bind(w);
  w.scan = function () {
    const origExists = fs.existsSync;
    const origReaddir = fs.readdirSync;
    const origRead = fs.readFileSync;
    fs.existsSync = (p) => {
      if (p.endsWith('/sessions') && p !== fakeSessionsDir) return origExists(fakeSessionsDir);
      return origExists(p);
    };
    fs.readdirSync = (p) => {
      if (p.endsWith('/sessions') && p !== fakeSessionsDir) return origReaddir(fakeSessionsDir);
      if (p.endsWith('/projects') || p.includes('/projects/')) {
        const tail = p.split('/projects/')[1];
        return origReaddir(tail ? path.join(fakeProjectsDir, tail) : fakeProjectsDir);
      }
      return origReaddir(p);
    };
    fs.readFileSync = (p, ...rest) => {
      if (p.includes('/sessions/') && !p.startsWith(fakeSessionsDir)) {
        return origRead(path.join(fakeSessionsDir, path.basename(p)), ...rest);
      }
      return origRead(p, ...rest);
    };
    try { return realScan(); }
    finally {
      fs.existsSync = origExists;
      fs.readdirSync = origReaddir;
      fs.readFileSync = origRead;
    }
  };
  // Project-dir resolution and isPidAlive must use the fake tree / current pid.
  w._cwdToProjectDir = (cwd) => {
    if (!cwd) return null;
    const slug = cwd.replace(/\//g, '-');
    const dir = path.join(fakeProjectsDir, slug);
    return fs.existsSync(dir) ? dir : null;
  };
  w.isPidAlive = () => true;
  w.detectBypassFromPid = () => false;
  w.findJsonlPath = (sid) => {
    // Search across all project dirs in the fake tree.
    for (const d of fs.readdirSync(fakeProjectsDir)) {
      const candidate = path.join(fakeProjectsDir, d, `${sid}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };
  w.watchJsonl = () => {};
  return w;
}

test('scan: lagged session.json + fresh /clear jsonl → migrate tracked id once, then sticky', () => {
  // Single Claude. session.json sid = OLD (frozen at startup). On disk:
  // OLD.jsonl is stale (Claude /clear'd), NEW.jsonl is fresh (post-/clear).
  // Tracked: OLD (config-restored). Expected: scan migrates OLD → NEW.
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-a';
  const now = Date.now();
  writeSessionJson(tree.sessions, 9001, 'OLD-id', cwd);
  writeJsonl(tree.projects, cwd, 'OLD-id', now - 60000);  // stale
  writeJsonl(tree.projects, cwd, 'NEW-id', now - 1000);   // fresh

  const w = freshScanWatcher(tree.root);
  w.sessions.set('OLD-id', makeSession('OLD-id', { pid: 9001, cwd, state: STATES.WAITING }));

  w.scan();

  if (w.sessions.has('OLD-id')) throw new Error('OLD-id must be migrated away');
  if (!w.sessions.has('NEW-id')) throw new Error('NEW-id must be tracked');

  // Second scan: should be a no-op (sticky).
  const events = [];
  w.on('session-added', (s) => events.push(['added', s.sessionId]));
  w.on('session-removed', (id) => events.push(['removed', id]));
  w.scan();
  if (events.length !== 0) throw new Error(`expected sticky no-op, got ${JSON.stringify(events)}`);
});

test('scan: updated session.json + fresh /clear jsonl → migrate even when new sid in liveSessionIds', () => {
  // Single Claude, post-/clear. session.json was updated to NEW-id. On disk:
  // OLD.jsonl is stale, NEW.jsonl is fresh. Tracked: OLD-id (config-restored or
  // pre-/clear state). Regression: previously, _findFreshUnclaimedJsonl excluded
  // NEW-id because it appears in liveSessionIds, so migration silently failed
  // and the card stayed stuck on OLD-id. Expected: migrate OLD → NEW.
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-clear';
  const now = Date.now();
  writeSessionJson(tree.sessions, 9101, 'NEW-id', cwd);
  writeJsonl(tree.projects, cwd, 'OLD-id', now - 60000);  // stale (tracked)
  writeJsonl(tree.projects, cwd, 'NEW-id', now - 1000);   // fresh (Claude is here now)

  const w = freshScanWatcher(tree.root);
  w.sessions.set('OLD-id', makeSession('OLD-id', { pid: 9101, cwd, state: STATES.WAITING }));

  w.scan();

  if (w.sessions.has('OLD-id')) throw new Error('OLD-id must be migrated away');
  if (!w.sessions.has('NEW-id')) throw new Error('NEW-id must be tracked');
});

test('scan: oscillation regression — two Claudes alternating writes, no flap after first attribution', () => {
  // Two Claudes in same cwd. Both /clear'd (both session.json sids stale).
  // Both wrote fresh post-/clear JSONLs. First scan attributes each pid to its
  // jsonl. Subsequent scans where mtimes change must NOT re-migrate.
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-b';
  const now = Date.now();
  writeSessionJson(tree.sessions, 100, 'A-old', cwd, now);        // most-recently-active
  writeSessionJson(tree.sessions, 200, 'B-old', cwd, now - 5000);
  writeJsonl(tree.projects, cwd, 'A-old', now - 60000);  // stale
  writeJsonl(tree.projects, cwd, 'B-old', now - 60000);  // stale
  const aNew = writeJsonl(tree.projects, cwd, 'A-new', now - 1000);  // freshest
  const bNew = writeJsonl(tree.projects, cwd, 'B-new', now - 5000);  // 2nd fresh

  const w = freshScanWatcher(tree.root);
  w.sessions.set('A-old', makeSession('A-old', { pid: 100, cwd, state: STATES.WAITING }));
  w.sessions.set('B-old', makeSession('B-old', { pid: 200, cwd, state: STATES.WAITING }));

  w.scan();
  // After scan: A-old → A-new (most-recently-active session.json grabs freshest).
  //             B-old → B-new (next-active grabs next-freshest).
  if (!w.sessions.has('A-new')) throw new Error('A-new must be tracked');
  if (!w.sessions.has('B-new')) throw new Error('B-new must be tracked');
  if (w.sessions.get('A-new').pid !== 100) throw new Error('A-new must belong to pid 100');
  if (w.sessions.get('B-new').pid !== 200) throw new Error('B-new must belong to pid 200');

  // Second scan with simulated alternating writes (B-new mtime advances past A-new).
  fs.utimesSync(bNew, (now + 2000) / 1000, (now + 2000) / 1000);
  fs.utimesSync(aNew, (now + 1000) / 1000, (now + 1000) / 1000);
  const events = [];
  w.on('session-added', (s) => events.push(['added', s.sessionId]));
  w.on('session-removed', (id) => events.push(['removed', id]));
  w.scan();
  // Critical: even though B-new is now fresher than A-new, A's session must
  // stay on A-new (stickiness); the previous code flapped here.
  if (events.length !== 0) throw new Error(`oscillation detected: ${JSON.stringify(events)}`);
  if (!w.sessions.has('A-new') || !w.sessions.has('B-new')) throw new Error('mappings broken');
});

test('scan: paused single Claude (no writes for 60s+) does NOT migrate when no fresh unclaimed exists', () => {
  // User walked away. Tracked jsonl mtime is > 30s old, but no other jsonl in
  // the cwd is fresh. Watcher must NOT spuriously migrate or add anything.
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-c';
  const now = Date.now();
  writeSessionJson(tree.sessions, 5555, 'paused-id', cwd);
  writeJsonl(tree.projects, cwd, 'paused-id', now - 60000); // tracked, stale
  writeJsonl(tree.projects, cwd, 'orphan-id', now - 600000); // orphan, also stale

  const w = freshScanWatcher(tree.root);
  w.sessions.set('paused-id', makeSession('paused-id', { pid: 5555, cwd, state: STATES.WAITING }));

  const events = [];
  w.on('session-added', (s) => events.push(['added', s.sessionId]));
  w.on('session-removed', (id) => events.push(['removed', id]));

  w.scan();

  if (events.length !== 0) throw new Error(`paused session triggered events: ${JSON.stringify(events)}`);
  if (!w.sessions.has('paused-id')) throw new Error('paused-id must remain tracked');
  if (w.sessions.has('orphan-id')) throw new Error('orphan-id must NOT be tracked');
});

test('scan: brand-new Claude (no tracked entry, fresh jsonl) → added directly, no migration', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-d';
  const now = Date.now();
  writeSessionJson(tree.sessions, 7777, 'fresh-id', cwd);
  writeJsonl(tree.projects, cwd, 'fresh-id', now - 1000); // brand new, fresh

  const w = freshScanWatcher(tree.root);
  // No prior tracked session for pid 7777.

  const events = [];
  w.on('session-added', (s) => events.push(['added', s.sessionId]));
  w.on('session-removed', (id) => events.push(['removed', id]));

  w.scan();

  if (!w.sessions.has('fresh-id')) throw new Error('fresh-id must be tracked');
  // Exactly one added event, no removed.
  const removed = events.filter(e => e[0] === 'removed');
  if (removed.length !== 0) throw new Error(`unexpected removals: ${JSON.stringify(removed)}`);
  const added = events.filter(e => e[0] === 'added' && e[1] === 'fresh-id');
  if (added.length !== 1) throw new Error(`expected one added('fresh-id'), got ${JSON.stringify(events)}`);
});

test('scan: migration preserves sessionOrder slot, custom name, notification prefs', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-e';
  const now = Date.now();
  writeSessionJson(tree.sessions, 8888, 'OLD', cwd);
  writeJsonl(tree.projects, cwd, 'OLD', now - 60000);
  writeJsonl(tree.projects, cwd, 'NEW', now - 1000);

  const config = makeMockConfig();
  config._data.sessionOrder = ['SOMETHING_ELSE', 'OLD', 'ANOTHER'];
  config._data.customNames['OLD'] = 'My Workspace';
  config._data.notifications['OLD'] = { modal: true, sound: true };

  const w = freshScanWatcher(tree.root);
  w.config = config;
  w.sessions.set('OLD', makeSession('OLD', { pid: 8888, cwd, state: STATES.WAITING }));

  w.scan();

  if (!w.sessions.has('NEW')) throw new Error('NEW must be tracked after migration');
  // sessionOrder: NEW must occupy OLD's slot.
  if (config._data.sessionOrder[1] !== 'NEW') {
    throw new Error(`expected sessionOrder[1] === 'NEW', got ${config._data.sessionOrder[1]}`);
  }
  if (config._data.customNames['NEW'] !== 'My Workspace') {
    throw new Error('customName not migrated');
  }
  if (!config._data.notifications['NEW'] || !config._data.notifications['NEW'].modal) {
    throw new Error('notification prefs not migrated');
  }
  // OLD's entries must be gone.
  if (config._data.customNames['OLD']) throw new Error('OLD customName must be cleared');
  if (config._data.notifications['OLD']) throw new Error('OLD notif prefs must be cleared');
});

// ─── attachment doesn't kill waiting transition ──────────────────
section('attachment + end_turn race:');

test('attachment events after assistant end_turn do not block WAITING transition', async () => {
  // Simulate the live-write race: user msg, then attachments + assistant end_turn,
  // then more attachments. The waiting timer set after end_turn must NOT be
  // cleared by the trailing attachments, otherwise state stays THINKING forever.
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('R', makeSession('R', { state: STATES.WAITING }));

  w.processEvent('R', { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-04-23T13:00:00.000Z' }, false);
  if (w.sessions.get('R').state.name !== 'thinking') throw new Error('expected thinking after user, got ' + w.sessions.get('R').state.name);

  w.processEvent('R', { type: 'attachment', timestamp: '2026-04-23T13:00:00.001Z' }, false);
  w.processEvent('R', {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
    timestamp: '2026-04-23T13:00:05.000Z',
  }, false);
  // Trailing attachments — these should NOT clear the waiting timer
  w.processEvent('R', { type: 'attachment', timestamp: '2026-04-23T13:00:05.100Z' }, false);
  w.processEvent('R', { type: 'attachment', timestamp: '2026-04-23T13:00:05.200Z' }, false);

  // Wait longer than WAITING_DELAY (2s) for the timer to fire
  await sleep(2200);
  const s = w.sessions.get('R').state.name;
  if (s !== 'waiting') throw new Error('expected waiting after end_turn timer, got ' + s);
});

// ─── orphan-entry purge at start ─────────────────────────────────
section('orphan purge:');

test('start() prunes notifications/customNames for ids without saved session', () => {
  const config = makeMockConfig();
  // Pretend a saved session A exists, but stale notif/customName for B and C
  config._data.sessions['A'] = { stateName: 'waiting' };
  config._data.notifications['A'] = { modal: true, sound: false };
  config._data.notifications['B-orphan'] = { modal: true, sound: true };
  config._data.notifications['C-orphan'] = { modal: false, sound: true };
  config._data.customNames['B-orphan'] = 'Stale';
  config._data.sessionOrder = ['A', 'B-orphan', 'C-orphan'];

  const w = new SessionWatcher(config);
  // Don't actually scan filesystem
  w.scan = () => {};
  w.start();

  if (config._data.notifications['B-orphan']) throw new Error('B-orphan notif should be pruned');
  if (config._data.notifications['C-orphan']) throw new Error('C-orphan notif should be pruned');
  if (config._data.customNames['B-orphan']) throw new Error('B-orphan customName should be pruned');
  if (!config._data.notifications['A']) throw new Error('A notif must remain');
  if (config._data.sessionOrder.includes('B-orphan')) throw new Error('B-orphan should be removed from order');
  if (!config._data.sessionOrder.includes('A')) throw new Error('A must remain in order');

  w.stop();
});

section('Agent dispatch capture:');

test('Agent tool_use populates session.agentDispatches via fastInitialLoad', () => {
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
  if (typeof bg.dispatchTs !== 'number') throw new Error(`bg.dispatchTs not a number: ${bg.dispatchTs}`);
});

test('startFileWatch stores jsonlPath on session (for sessionDirFor downstream)', () => {
  const tmp = tmpJsonl('jsonl-path-store');
  fs.writeFileSync(tmp, JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn' } }) + '\n');

  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('JP', makeSession('JP', { state: STATES.RUNNING }));
  w.startFileWatch('JP', tmp);

  const s = w.sessions.get('JP');
  if (s.jsonlPath !== tmp) throw new Error(`expected ${tmp}, got ${s.jsonlPath}`);

  // Clean up the watcher to release file handles
  w.stop();
});

section('isBackground detection:');

test('scan: entrypoint sdk-cli → isBackground true', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-bg';
  writeSessionJson(tree.sessions, 4001, 'BG-id', cwd, Date.now(), 'sdk-cli');
  writeJsonl(tree.projects, cwd, 'BG-id', Date.now() - 1000);
  const w = freshScanWatcher(tree.root);
  w.scan();
  const s = w.sessions.get('BG-id');
  if (!s) throw new Error('BG-id must be tracked');
  if (s.isBackground !== true) throw new Error(`expected isBackground=true, got ${s.isBackground}`);
});

test('scan: entrypoint cli → isBackground false', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-fg';
  writeSessionJson(tree.sessions, 4002, 'FG-id', cwd, Date.now(), 'cli');
  writeJsonl(tree.projects, cwd, 'FG-id', Date.now() - 1000);
  const w = freshScanWatcher(tree.root);
  w.scan();
  if (w.sessions.get('FG-id').isBackground !== false) throw new Error('expected isBackground=false');
});

test('scan: entrypoint absent (vieux Claude Code) → isBackground false', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-old';
  // Write a session.json WITHOUT the entrypoint field
  const data = { pid: 4003, sessionId: 'OLD-cc-id', cwd, startedAt: Date.now(), updatedAt: Date.now() };
  fs.writeFileSync(path.join(tree.sessions, '4003.json'), JSON.stringify(data));
  writeJsonl(tree.projects, cwd, 'OLD-cc-id', Date.now() - 1000);
  const w = freshScanWatcher(tree.root);
  w.scan();
  if (w.sessions.get('OLD-cc-id').isBackground !== false) throw new Error('expected isBackground=false');
});

test('scan: isBackground persisté dans config', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-persist-bg';
  writeSessionJson(tree.sessions, 4004, 'PBG-id', cwd, Date.now(), 'sdk-cli');
  writeJsonl(tree.projects, cwd, 'PBG-id', Date.now() - 1000);
  const w = freshScanWatcher(tree.root);
  w.scan();
  // scan() creates the session then persistSession() — verify the mock config
  const saved = w.config.getSavedSessions()['PBG-id'];
  if (!saved) throw new Error('session not persisted');
  if (saved.isBackground !== true) throw new Error(`expected persisted isBackground=true, got ${saved.isBackground}`);
});

test('start(): restaure isBackground depuis config', () => {
  const config = makeMockConfig();
  config._data.sessions['RESTORED-bg'] = { stateName: 'waiting', isBackground: true, cwd: '/tmp/x', projectName: 'x' };
  const w = new SessionWatcher(config);
  w.scan = () => {}; // no filesystem scan
  w.start();
  const s = w.sessions.get('RESTORED-bg');
  if (!s) throw new Error('session not restored');
  if (s.isBackground !== true) throw new Error('expected restored isBackground=true');
  w.stop();
});

test('migrateSession conserve isBackground', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.watchJsonl = () => {};
  w.sessions.set('MIG-old', makeSession('MIG-old', { isBackground: true }));
  w.migrateSession('MIG-old', 'MIG-new');
  const s = w.sessions.get('MIG-new');
  if (!s || s.isBackground !== true) throw new Error('isBackground lost in migration');
});

runAll().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
