// Tests for SessionWatcher state determination + migration safety.
// Run via `node test/watcher.test.js`.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { SessionWatcher, STATES, bgTaskOpened, bgTaskClosed, explicitSessionName, isRealModel, isChromeToolUse } = require('../watcher');

function makeMockConfig() {
  const data = { sessions: {}, notifications: {}, customNames: {}, sessionOrder: [], pendingMarks: {} };
  return {
    _data: data,
    getSavedSessions: () => data.sessions,
    saveSession: (id, sess) => { data.sessions[id] = sess; },
    deleteSession: (id) => {
      delete data.sessions[id];
      delete data.notifications[id];
      delete data.customNames[id];
      delete data.pendingMarks[id];
    },
    setPendingMark: (id, mark) => { data.pendingMarks[id] = mark; },
    clearPendingMark: (id) => { delete data.pendingMarks[id]; },
    getPendingMark: (id) => data.pendingMarks[id] || null,
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

// ─── pending persistant (survit au redémarrage) ──────────────────
// Le pending n'existe QUE en RAM (aucune trace JSONL tant que l'utilisateur
// n'a pas répondu) → sans ancrage disque, un redémarrage le reconstruisait en
// `running` depuis le dernier `stop_reason: tool_use`, définitivement (le hook
// PreToolUse ne re-fire jamais). Vu en live sur TrainBox le 2026-07-25.
section('pending persistant:');

function jsonlPending(name) {
  // Dernier event = tool_use non résolu → état déduit du JSONL = running
  const tmp = tmpJsonl(name);
  fs.writeFileSync(tmp, JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-25T16:45:36.000Z',
    message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }],
      stop_reason: 'tool_use' },
  }) + '\n');
  return tmp;
}

test('entrer en pending écrit une trace portant le mtime du JSONL', () => {
  const tmp = jsonlPending('mark');
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('P1', makeSession('P1', { state: STATES.RUNNING, jsonlPath: tmp, lastTool: 'Bash' }));

  w.setState('P1', STATES.PENDING, false, 'hook:PreToolUse');

  const mark = config.getPendingMark('P1');
  if (!mark) throw new Error('trace pending non écrite');
  if (mark.mtimeMs !== fs.statSync(tmp).mtimeMs) throw new Error('mtime de la trace ≠ mtime du JSONL');
  if (mark.tool !== 'Bash') throw new Error(`outil attendu Bash, obtenu ${mark.tool}`);
});

test('sortir de pending purge la trace', () => {
  const tmp = jsonlPending('unmark');
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('P2', makeSession('P2', { state: STATES.RUNNING, jsonlPath: tmp }));

  w.setState('P2', STATES.PENDING, false, 'hook:PreToolUse');
  w.setState('P2', STATES.RUNNING, false, 'tool_use:Read');

  if (config.getPendingMark('P2')) throw new Error('trace non purgée après sortie du pending');
});

test('restaure pending au démarrage quand le JSONL n\'a pas bougé', () => {
  const tmp = jsonlPending('restore');
  const config = makeMockConfig();
  config.setPendingMark('P3', { mtimeMs: fs.statSync(tmp).mtimeMs, tool: 'Bash', at: Date.now() });

  const w = new SessionWatcher(config);
  w.sessions.set('P3', makeSession('P3', { state: STATES.RUNNING, jsonlPath: tmp }));
  w.fastInitialLoad('P3', tmp);

  const got = w.sessions.get('P3').state.name;
  if (got !== 'pending') throw new Error(`pending attendu (le JSONL dirait running), obtenu ${got}`);
  if (config.getSavedSessions()['P3'].stateName !== 'pending') throw new Error('état pending non persisté');
});

test('ignore et purge la trace quand le JSONL a bougé depuis (question déjà traitée)', () => {
  const tmp = jsonlPending('stale');
  const config = makeMockConfig();
  // La trace date d'AVANT la dernière écriture → l'utilisateur a répondu
  // pendant que l'app était éteinte.
  config.setPendingMark('P4', { mtimeMs: fs.statSync(tmp).mtimeMs - 5000, tool: 'Bash', at: Date.now() });

  const w = new SessionWatcher(config);
  w.sessions.set('P4', makeSession('P4', { state: STATES.WAITING, jsonlPath: tmp }));
  w.fastInitialLoad('P4', tmp);

  const got = w.sessions.get('P4').state.name;
  if (got !== 'running') throw new Error(`running attendu (état déduit du JSONL), obtenu ${got}`);
  if (config.getPendingMark('P4')) throw new Error('trace périmée non purgée');
});

test('restauration idempotente : session déjà pending → tokens quand même émis', () => {
  const tmp = tmpJsonl('idem');
  fs.writeFileSync(tmp, JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-25T16:45:36.000Z',
    message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 42, output_tokens: 7 } },
  }) + '\n');
  const config = makeMockConfig();
  config.setPendingMark('P5', { mtimeMs: fs.statSync(tmp).mtimeMs, tool: 'Bash', at: Date.now() });

  const w = new SessionWatcher(config);
  w.sessions.set('P5', makeSession('P5', { state: STATES.PENDING, jsonlPath: tmp }));
  let emitted = 0;
  w.on('session-updated', () => emitted++);
  w.fastInitialLoad('P5', tmp);

  if (w.sessions.get('P5').state.name !== 'pending') throw new Error('pending perdu');
  if (emitted === 0) throw new Error('aucun session-updated émis — tokens/model ne remonteraient pas');
  if (w.sessions.get('P5').tokens.input !== 42) throw new Error('tokens non relus');
});

test('supprimer une session purge sa trace pending', () => {
  const tmp = jsonlPending('remove');
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('P6', makeSession('P6', { state: STATES.RUNNING, jsonlPath: tmp }));
  w.setState('P6', STATES.PENDING, false, 'hook:PreToolUse');

  w.removeSession('P6');

  if (config.getPendingMark('P6')) throw new Error('trace orpheline laissée après removeSession');
});

test('start() purge les traces orphelines (sessions disparues)', () => {
  const config = makeMockConfig();
  config.setPendingMark('fantome', { mtimeMs: 1, tool: null, at: Date.now() });
  const w = new SessionWatcher(config);
  w.start();
  w.stop();

  if (config.getPendingMark('fantome')) throw new Error('trace orpheline non purgée au démarrage');
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

// Variante libre : écrit exactement `data` (présence, kind, parkedJobId…).
function writeSessionJsonRaw(sessionsDir, data) {
  fs.writeFileSync(path.join(sessionsDir, `${data.pid}.json`), JSON.stringify(data));
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

test('scan: tracked sid sans JSONL + session.json sur un autre sid avec JSONL frais → adoption (fantôme de resume)', () => {
  // Scénario TrainBox/Agnès 2026-08-04 : quit → relance → resume. Le CLI a
  // d'abord écrit session.json avec un sid provisoire (jamais de JSONL), puis
  // l'a remplacé par le vrai sid au resume. Le watcher doit lâcher le fantôme.
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-resume-adopt';
  const PHANTOM = 'phantom0-0000-4000-8000-000000000001';
  const REAL = 'real0000-0000-4000-8000-000000000002';
  writeSessionJson(tree.sessions, 4242, REAL, cwd);          // session.json → REAL
  writeJsonl(tree.projects, cwd, REAL, Date.now() - 5000);   // REAL.jsonl frais
  // PHANTOM n'a AUCUN jsonl sur disque.
  const w = freshScanWatcher(tree.root);
  w.sessions.set(PHANTOM, makeSession(PHANTOM, { pid: 4242, cwd }));
  w.scan();
  if (w.sessions.has(PHANTOM)) throw new Error('le fantôme aurait dû être migré/retiré');
  if (!w.sessions.has(REAL)) throw new Error('le vrai sid aurait dû être adopté');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scan: sid provisoire sans JSONL, session.json rapporte le MÊME sid → aucun churn (session neuve)', () => {
  // Cas légitime : session qui vient de démarrer, premier prompt pas encore
  // envoyé — le JSONL n'existe pas ENCORE. session.json et le tracking
  // pointent le même sid : on ne touche à rien.
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-resume-fresh';
  const NEW = 'newsid00-0000-4000-8000-000000000003';
  writeSessionJson(tree.sessions, 4343, NEW, cwd);
  fs.mkdirSync(path.join(tree.projects, cwd.replace(/\//g, '-')), { recursive: true });
  const w = freshScanWatcher(tree.root);
  w.sessions.set(NEW, makeSession(NEW, { pid: 4343, cwd }));
  w.scan();
  if (!w.sessions.has(NEW)) throw new Error('la session neuve doit rester trackée telle quelle');
  if (w.sessions.size !== 1) throw new Error(`une seule session attendue, trouvé ${w.sessions.size}`);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scan: nouvelle session découverte + initial-scan no-op → stateSince amorcé au mtime JSONL, pas Date.now() (finding I1)', () => {
  // Régression ciblée : la branche de découverte de scan() posait autrefois
  // stateSince: Date.now() sur le pré-seed. Ici l'état déduit du JSONL (end_turn
  // → WAITING) est identique à l'état par défaut d'une session neuve (WAITING)
  // → setState('initial-scan') est un no-op, exactement le chemin qui masquait
  // le bug : l'amorce mtime ne se déclenche que si stateSince est encore null.
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-i1';
  const now = Date.now();
  const twoHoursAgo = now - 2 * 3600 * 1000;
  writeSessionJson(tree.sessions, 6001, 'i1-id', cwd);

  const slug = cwd.replace(/\//g, '-');
  const projDir = path.join(tree.projects, slug);
  fs.mkdirSync(projDir, { recursive: true });
  const jsonlPath = path.join(projDir, 'i1-id.jsonl');
  fs.writeFileSync(jsonlPath, JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
  }) + '\n');
  fs.utimesSync(jsonlPath, twoHoursAgo / 1000, twoHoursAgo / 1000);
  const realMtimeMs = fs.statSync(jsonlPath).mtimeMs;

  const w = freshScanWatcher(tree.root);
  w.scan(); // branche découverte : this.sessions.set(..., stateSince: null)
  if (!w.sessions.has('i1-id')) throw new Error('i1-id must be tracked after scan');

  // watchJsonl est stubbé no-op par freshScanWatcher (pas de vrai poller en
  // test) — on rejoue l'appel réel que ferait startFileWatch, même jsonlPath.
  const resolved = w.findJsonlPath('i1-id');
  if (resolved !== jsonlPath) throw new Error(`findJsonlPath mismatch: ${resolved}`);
  w.fastInitialLoad('i1-id', resolved);

  const session = w.sessions.get('i1-id');
  if (session.state.name !== 'waiting') throw new Error('expected computed state waiting, got ' + session.state.name);
  if (session.stateSince !== realMtimeMs) {
    throw new Error(`stateSince doit être amorcé au mtime du JSONL (${realMtimeMs}), got ${session.stateSince}`);
  }
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

section('scan() — kind / spare / parkedJobId:');

test('scan: spare worker → jamais tracké', () => {
  const tree = makeFakeClaudeTree();
  writeSessionJsonRaw(tree.sessions, { pid: 9101, sessionId: 'spare-1', cwd: '/tmp/p', startedAt: Date.now(), entrypoint: 'cli', kind: 'daemon-worker', spare: true });
  const w = freshScanWatcher(tree.root);
  w.scan();
  if (w.sessions.size !== 0) throw new Error(`expected 0 sessions, got ${w.sessions.size}`);
});

test('scan: parkedJobId → ligne ignorée ET session trackée retirée', () => {
  const tree = makeFakeClaudeTree();
  writeSessionJsonRaw(tree.sessions, { pid: 9102, sessionId: 'park-1', cwd: '/tmp/p', startedAt: Date.now(), entrypoint: 'cli', kind: 'interactive' });
  const w = freshScanWatcher(tree.root);
  w.scan();
  if (!w.sessions.has('park-1')) throw new Error('expected park-1 tracked after first scan');
  // La session passe en arrière-plan : le CLI pose parkedJobId sur l'original.
  writeSessionJsonRaw(tree.sessions, { pid: 9102, sessionId: 'park-1', cwd: '/tmp/p', startedAt: Date.now(), entrypoint: 'cli', kind: 'interactive', parkedJobId: 'job-abc' });
  const removed = [];
  w.on('session-removed', (id) => removed.push(id)); // removeSession émet l'id (watcher.js:1293)
  w.scan();
  if (w.sessions.has('park-1')) throw new Error('expected park-1 removed once parked');
  if (removed[0] !== 'park-1') throw new Error(`expected session-removed park-1, got ${removed}`);
});

test('scan: kind bg/daemon → isBackground même avec entrypoint cli', () => {
  const tree = makeFakeClaudeTree();
  writeSessionJsonRaw(tree.sessions, { pid: 9103, sessionId: 'bg-1', cwd: '/tmp/p', startedAt: Date.now(), entrypoint: 'cli', kind: 'bg' });
  writeSessionJsonRaw(tree.sessions, { pid: 9104, sessionId: 'int-1', cwd: '/tmp/q', startedAt: Date.now(), entrypoint: 'cli', kind: 'interactive' });
  writeSessionJsonRaw(tree.sessions, { pid: 9105, sessionId: 'old-1', cwd: '/tmp/r', startedAt: Date.now(), entrypoint: 'cli' });
  const w = freshScanWatcher(tree.root);
  w.scan();
  if (w.sessions.get('bg-1').isBackground !== true) throw new Error('bg-1 should be background');
  if (w.sessions.get('int-1').isBackground !== false) throw new Error('int-1 should be interactive');
  if (w.sessions.get('old-1').isBackground !== false) throw new Error('old-1 (no kind) should keep entrypoint rule');
});

section('scan() — présence CLI:');

function presenceTree(status, extra = {}) {
  const tree = makeFakeClaudeTree();
  const now = Date.now();
  writeSessionJsonRaw(tree.sessions, {
    pid: 9200, sessionId: 'pres-1', cwd: '/tmp/pres', startedAt: now - 60_000, entrypoint: 'cli', kind: 'interactive',
    status, statusUpdatedAt: extra.statusUpdatedAt ?? now, updatedAt: now, ...(extra.waitingFor ? { waitingFor: extra.waitingFor } : {}),
  });
  return tree;
}

test('présence waiting/permission prompt → pending + waitingFor, notif émise (postérieure au démarrage)', () => {
  const tree = presenceTree('waiting', { waitingFor: 'permission prompt' });
  const w = freshScanWatcher(tree.root);
  w.startedAt = Date.now() - 5_000;
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  w.scan();
  const s = w.sessions.get('pres-1');
  if (s.state.name !== 'pending') throw new Error(`expected pending, got ${s.state.name}`);
  if (s.waitingFor !== 'permission prompt') throw new Error(`waitingFor=${s.waitingFor}`);
  if (notified.length !== 1) throw new Error(`expected 1 notif, got ${notified.length}`);
});

test('présence antérieure au démarrage → pending restauré SANS notif, stateSince = statusUpdatedAt', () => {
  const ts = Date.now() - 60_000;
  const tree = presenceTree('waiting', { waitingFor: 'permission prompt', statusUpdatedAt: ts });
  const w = freshScanWatcher(tree.root);
  w.startedAt = Date.now();
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  w.scan();
  const s = w.sessions.get('pres-1');
  if (s.state.name !== 'pending') throw new Error(`expected pending, got ${s.state.name}`);
  if (notified.length !== 0) throw new Error('no retroactive notif expected');
  if (s.stateSince !== ts) throw new Error(`stateSince should be statusUpdatedAt (${ts}), got ${s.stateSince}`);
});

test('présence waiting/dialog open → waiting + dialogOpen, jamais ambre, aucune notif', () => {
  const tree = presenceTree('waiting', { waitingFor: 'dialog open' });
  const w = freshScanWatcher(tree.root);
  w.startedAt = Date.now() - 5_000;
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  w.scan();
  const s = w.sessions.get('pres-1');
  if (s.state.name !== 'waiting') throw new Error(`expected waiting, got ${s.state.name}`);
  if (s.dialogOpen !== true) throw new Error('dialogOpen expected');
  if (notified.length !== 0) throw new Error('dialog open must not notify');
});

test('présence busy sur un pending posé APRÈS statusUpdatedAt → reste pending ; postérieur → running', () => {
  const tree = presenceTree('busy', { statusUpdatedAt: Date.now() - 10_000 });
  const w = freshScanWatcher(tree.root);
  w.startedAt = Date.now() - 20_000;
  w.scan();
  // Le hook pose un pending maintenant (plus récent que la présence busy).
  w.setState('pres-1', STATES.PENDING, false, 'hook:PermissionRequest');
  w.scan();
  if (w.sessions.get('pres-1').state.name !== 'pending') throw new Error('older busy must not demote a newer pending');
  // Le CLI réécrit busy APRÈS le pending : la question a été traitée.
  const now = Date.now() + 1_000;
  writeSessionJsonRaw(tree.sessions, { pid: 9200, sessionId: 'pres-1', cwd: '/tmp/pres', startedAt: now - 60_000, entrypoint: 'cli', kind: 'interactive', status: 'busy', statusUpdatedAt: now, updatedAt: now });
  w.scan();
  if (w.sessions.get('pres-1').state.name !== 'running') throw new Error('newer busy must resolve the pending');
});

test('présence shell → waiting + shellBusy ; puis idle → bannière tardive une seule fois', () => {
  const tree = presenceTree('shell');
  const w = freshScanWatcher(tree.root);
  w.startedAt = Date.now() - 5_000;
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  w.scan();
  // Partir d'un état actif pour qu'une transition muette ait lieu.
  w.setState('pres-1', STATES.RUNNING, false, 'test');
  w.scan();
  const s = w.sessions.get('pres-1');
  if (s.state.name !== 'waiting' || s.shellBusy !== true) throw new Error(`expected waiting+shell, got ${s.state.name}/${s.shellBusy}`);
  if (notified.length !== 0) throw new Error('shell must mute the waiting notif');
  const now = Date.now() + 1_000;
  writeSessionJsonRaw(tree.sessions, { pid: 9200, sessionId: 'pres-1', cwd: '/tmp/pres', startedAt: now - 60_000, entrypoint: 'cli', kind: 'interactive', status: 'idle', statusUpdatedAt: now, updatedAt: now });
  w.lastNotifTime.delete('pres-1');
  w.scan();
  if (notified.length !== 1) throw new Error(`expected late notif once, got ${notified.length}`);
  if (s.shellBusy !== false) throw new Error('shellBusy should clear on idle');
  w.lastNotifTime.delete('pres-1');
  w.scan();
  if (notified.length !== 1) throw new Error('late notif must fire only once');
});

test('CLI ancien (pas de status) → aucun champ de présence posé', () => {
  const tree = makeFakeClaudeTree();
  writeSessionJson(tree.sessions, 9300, 'old-2', '/tmp/old');
  const w = freshScanWatcher(tree.root);
  w.scan();
  const s = w.sessions.get('old-2');
  if (s.presence !== null) throw new Error('presence should be null without statusUpdatedAt');
  if (s.shellBusy || s.dialogOpen || s.waitingFor) throw new Error('no presence flags expected');
});

test('scan: présence ignorée à la découverte si le PID est mort (jamais de pending fantôme)', () => {
  const tree = presenceTree('waiting', { waitingFor: 'permission prompt' });
  const w = freshScanWatcher(tree.root);
  w.isPidAlive = () => false; // avant le premier scan : le CLI a crashé, session.json traîne
  w.startedAt = Date.now() - 5_000;
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  w.scan();
  const s = w.sessions.get('pres-1');
  if (s && s.state.name === 'pending') throw new Error('dead PID must not be promoted to pending by presence');
  if (notified.length !== 0) throw new Error('dead PID must not notify');
});

test('présence idle après un mute : la bannière tardive respecte encore un bg process ouvert', () => {
  const tree = presenceTree('shell');
  const w = freshScanWatcher(tree.root);
  w.startedAt = Date.now() - 5_000;
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  w.scan();
  w.setState('pres-1', STATES.RUNNING, false, 'test');
  w.scan();
  const s = w.sessions.get('pres-1');
  if (notified.length !== 0) throw new Error('shell must mute the waiting notif');
  // Une tâche de fond s'ouvre pendant que le mute presence est actif.
  s.bgTasks = new Set(['t1']);
  const now = Date.now() + 1_000;
  writeSessionJsonRaw(tree.sessions, { pid: 9200, sessionId: 'pres-1', cwd: '/tmp/pres', startedAt: now - 60_000, entrypoint: 'cli', kind: 'interactive', status: 'idle', statusUpdatedAt: now, updatedAt: now });
  w.lastNotifTime.delete('pres-1');
  w.scan();
  if (notified.length !== 0) throw new Error(`bg process still open — late notif must stay muted, got ${notified.length}`);
  if (s.presenceMuted !== false) throw new Error('presenceMuted must still clear even when the late banner is skipped');
});

test('end_turn JSONL avec présence busy → reste running ; présence idle ensuite → waiting', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.startedAt = Date.now() - 5_000;
  w.sessions.set('et-1', makeSession('et-1', {
    state: STATES.RUNNING,
    presence: { status: 'busy', waitingFor: undefined, statusUpdatedAt: Date.now() - 1_000 },
    shellBusy: false, dialogOpen: false, waitingFor: null, presenceMuted: false,
  }));
  w.startWaitingTimer('et-1', false);
  await sleep(2_300); // WAITING_DELAY = 2000
  if (w.sessions.get('et-1').state.name !== 'running') throw new Error('end_turn must be ignored while presence is busy');
  w.applyPresence('et-1', { status: 'idle', statusUpdatedAt: Date.now(), updatedAt: Date.now() });
  if (w.sessions.get('et-1').state.name !== 'waiting') throw new Error('presence idle must release to waiting');
});

test('end_turn JSONL sans présence → waiting comme avant', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('et-2', makeSession('et-2', { state: STATES.RUNNING, presence: null }));
  w.startWaitingTimer('et-2', false);
  await sleep(2_300);
  if (w.sessions.get('et-2').state.name !== 'waiting') throw new Error('legacy path must still reach waiting');
});

test('F3 — garde symétrique : un event JSONL (tool_result) ne dégrade pas un pending que le CLI dit waiting', () => {
  const w = new SessionWatcher(makeMockConfig());
  const now = Date.now();
  w.sessions.set('f3-1', makeSession('f3-1', {
    state: STATES.PENDING,
    presence: { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: now },
    shellBusy: false, dialogOpen: false, waitingFor: 'permission prompt', presenceMuted: false,
  }));
  w.processEvent('f3-1', { type: 'user', message: { content: [{ type: 'tool_result' }] } }, false);
  if (w.sessions.get('f3-1').state.name !== 'pending') {
    throw new Error(`expected pending (JSONL ignoré tant que presence=waiting), got ${w.sessions.get('f3-1').state.name}`);
  }
  // Le CLI dit maintenant busy (statusUpdatedAt postérieur) : le dialogue est
  // refermé, la question a été traitée — la garde doit se lever.
  w.applyPresence('f3-1', { status: 'busy', statusUpdatedAt: now + 1_000, updatedAt: now + 1_000 });
  if (w.sessions.get('f3-1').state.name !== 'running') {
    throw new Error(`expected running once presence says busy, got ${w.sessions.get('f3-1').state.name}`);
  }
});

test('F4 — ordre d\'application (branche trackée de scan()) : applyPresence gagne sur le rejeu du tail par watchJsonl', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/f4';
  // statusUpdatedAt largement postérieur : garantit qu'il reste plus récent
  // que le stateSince que le stub watchJsonl posera pendant ce scan() (Date.now()
  // au moment de l'appel, donc forcément antérieur à future).
  const future = Date.now() + 60_000;
  writeSessionJsonRaw(tree.sessions, {
    pid: 9400, sessionId: 'f4-1', cwd, startedAt: Date.now() - 60_000, entrypoint: 'cli', kind: 'interactive',
    status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: future, updatedAt: Date.now(),
  });
  const w = freshScanWatcher(tree.root);
  w.sessions.set('f4-1', makeSession('f4-1', {
    pid: 9400, cwd, state: STATES.RUNNING, presence: null,
    shellBusy: false, dialogOpen: false, waitingFor: null, presenceMuted: false,
  }));
  // freshScanWatcher stubbe watchJsonl en no-op ; ici on le remplace pour
  // reproduire ce que fait fastInitialLoad en vrai — rejouer le tail JSONL et
  // retransitionner la session (ici vers waiting, simulant un end_turn) AVANT
  // qu'applyPresence n'ait son mot à dire. Si l'ordre scan() est mauvais
  // (applyPresence AVANT le bloc watchJsonl), ce stub écrase le pending.
  w.watchJsonl = (id) => { w.setState(id, STATES.WAITING, true, 'end_turn-initial'); };
  w.scan();
  const s = w.sessions.get('f4-1');
  if (s.state.name !== 'pending') {
    throw new Error(`expected pending (la présence doit gagner sur le rejeu du tail), got ${s.state.name}`);
  }
});

test('F5 — worker spare qui réutilise le PID d\'une session déjà trackée → retirée (pas un fantôme à vie)', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/f5';
  writeSessionJsonRaw(tree.sessions, { pid: 9500, sessionId: 'f5-1', cwd, startedAt: Date.now(), entrypoint: 'cli', kind: 'interactive' });
  const w = freshScanWatcher(tree.root);
  w.scan();
  if (!w.sessions.has('f5-1')) throw new Error('expected f5-1 tracked after first scan');
  // Le worker redevient spare (réutilisé par l'agent view) sous le même pid/cwd.
  writeSessionJsonRaw(tree.sessions, { pid: 9500, sessionId: 'f5-1', cwd, startedAt: Date.now(), entrypoint: 'cli', kind: 'daemon-worker', spare: true });
  const removed = [];
  w.on('session-removed', (id) => removed.push(id));
  w.scan();
  if (w.sessions.has('f5-1')) throw new Error('expected f5-1 removed once spare');
  if (removed[0] !== 'f5-1') throw new Error(`expected session-removed f5-1, got ${removed}`);
});

// ─── readNewLines (lignes partielles) ──────────────────
section('tâches de fond — fiches (serveur / tâche):');

function bashToolUse(id, description, command, extra = {}) {
  return { type: 'assistant', timestamp: '2026-09-07T10:00:00.000Z',
    message: { model: 'claude-opus-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'Bash', input: { description, command, ...extra } }] } };
}
function bgOpenResult(toolUseId, taskId, extraResult = {}) {
  return { type: 'user', timestamp: '2026-09-07T10:00:05.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: `Command running in background with ID: ${taskId}` }] },
    toolUseResult: { backgroundTaskId: taskId, ...extraResult } };
}

test('trackBgTask relie la tâche au Bash qui l\'a lancée : kind, description, commande, since', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('bg-1', makeSession('bg-1', { recentBash: new Map(), bgTaskInfo: new Map() }));
  const s = w.sessions.get('bg-1');
  w.processEvent('bg-1', bashToolUse('tu1', "Lancer l'app en mode dev", 'npm run dev > /tmp/o 2>&1', { run_in_background: true }), false);
  w.processEvent('bg-1', bgOpenResult('tu1', 'job1'), false);
  const d = w.bgTaskDetails(s);
  if (d.length !== 1) throw new Error(`expected 1 detail, got ${d.length}`);
  const [b] = d;
  if (b.kind !== 'server') throw new Error(`kind=${b.kind}`);
  if (b.description !== "Lancer l'app en mode dev") throw new Error(`description=${b.description}`);
  if (b.command !== 'npm run dev > /tmp/o 2>&1') throw new Error(`command=${b.command}`);
  if (b.since !== Date.parse('2026-09-07T10:00:05.000Z')) throw new Error(`since=${b.since}`);
  if (b.deliberate !== true) throw new Error('deliberate expected');
});

test('parquée après timeout → deliberate false, kind task ; fermeture purge la fiche', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('bg-2', makeSession('bg-2', { recentBash: new Map(), bgTaskInfo: new Map() }));
  const s = w.sessions.get('bg-2');
  w.processEvent('bg-2', bashToolUse('tu2', 'Suite de tests', 'npm test'), false);
  w.processEvent('bg-2', bgOpenResult('tu2', 'job2', { timedOutAfterMs: 120000 }), false);
  const [b] = w.bgTaskDetails(s);
  if (b.kind !== 'task' || b.deliberate !== false) throw new Error(`kind=${b.kind} deliberate=${b.deliberate}`);
  w.processEvent('bg-2', { type: 'user', message: { content: '<task-notification><task-id>job2</task-id><status>completed</status></task-notification>' } }, false);
  if (w.bgTaskDetails(s).length !== 0) throw new Error('detail should be purged on close');
  if (s.bgTaskInfo.size !== 0) throw new Error('bgTaskInfo should be empty');
});

// Le mute « bg ouvert » ne vaut que pour ce qui TRAVAILLE : un serveur ou un
// veilleur ne réveillera jamais la session, se taire dessus la rendait sourde
// jusqu'au garde-fou 45 min (aby-landing 2026-09-07).
test('serveur seul ouvert → la notif « Inactif » part quand même', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('bg-n1', makeSession('bg-n1', { state: STATES.RUNNING, recentBash: new Map(), bgTaskInfo: new Map() }));
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  w.processEvent('bg-n1', bashToolUse('tu1', 'Serveur dev', 'npm run dev', { run_in_background: true }), false);
  w.processEvent('bg-n1', bgOpenResult('tu1', 'srv1'), false);
  w.processEvent('bg-n1', endTurnEv(), false);
  await sleep(2200);
  if (w.sessions.get('bg-n1').state.name !== 'waiting') throw new Error('un serveur ouvert laisse waiting');
  if (notified.length !== 1) throw new Error(`serveur ouvert ≠ silence, ${notified.length} notif(s)`);
});

test('veilleur seul ouvert → notif émise ; la tâche qu\'il attend la tait', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('bg-n2', makeSession('bg-n2', { state: STATES.RUNNING, recentBash: new Map(), bgTaskInfo: new Map() }));
  const notified = [];
  w.on('session-waiting', (s) => notified.push(s.sessionId));
  // Le build tourne : le veilleur est légitime, la session ne t'attend pas.
  w.processEvent('bg-n2', bashToolUse('tu1', 'Build', 'npm run build', { run_in_background: true }), false);
  w.processEvent('bg-n2', bgOpenResult('tu1', 'build1'), false);
  w.processEvent('bg-n2', bashToolUse('tu2', 'Attendre la fin du build', 'until [ -f /tmp/out ]; do sleep 5; done; cat /tmp/out', { run_in_background: true }), false);
  w.processEvent('bg-n2', bgOpenResult('tu2', 'wait1'), false);
  w.processEvent('bg-n2', endTurnEv(), false);
  await sleep(2200);
  if (notified.length !== 0) throw new Error(`build en cours → silence, ${notified.length} notif(s)`);
  const [srv, wait] = w.bgTaskDetails(w.sessions.get('bg-n2'));
  if (srv.kind !== 'task' || wait.kind !== 'waiter') throw new Error(`kinds: ${srv.kind}/${wait.kind}`);
  // Le build se termine : il ne reste que le veilleur, qui attend dans le vide.
  w.processEvent('bg-n2', { type: 'user', message: { content: '<task-notification><task-id>build1</task-id><status>failed</status></task-notification>' } }, false);
  w.processEvent('bg-n2', endTurnEv(), false);
  await sleep(2200);
  if (notified.length !== 1) throw new Error(`veilleur seul → notif attendue, ${notified.length} émise(s)`);
});

test('tâche sans fiche (tool_use hors fenêtre) → détail anonyme kind task, compte cohérent', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('bg-3', makeSession('bg-3', { bgTasks: new Set(['orphan']) }));
  const d = w.bgTaskDetails(w.sessions.get('bg-3'));
  if (d.length !== 1 || d[0].kind !== 'task' || d[0].id !== 'orphan') throw new Error(JSON.stringify(d));
});

test('fastInitialLoad retrouve une tâche ouverte bien AVANT la fenêtre de tail (gros tool_results ensuite)', () => {
  const w = new SessionWatcher(makeMockConfig());
  const p = tmpJsonl('bgfar');
  const big = 'x'.repeat(200 * 1024); // 200 Ko de résultat d'outil, > MIN_TAIL 64 Ko
  const lines = [
    bashToolUse('tu7', 'Build long', 'npm run build', { run_in_background: true }),
    bgOpenResult('tu7', 'job7'),
    { type: 'assistant', timestamp: '2026-09-07T10:00:06.000Z', message: { model: 'claude-opus-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu8', name: 'Read', input: { file_path: '/x' } }] } },
    { type: 'user', timestamp: '2026-09-07T10:00:07.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu8', content: big }] } },
    { type: 'assistant', timestamp: '2026-09-07T10:00:08.000Z', message: { model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'fini' }] } },
  ];
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  w.sessions.set('bg-7', makeSession('bg-7', { startedAt: new Date(Date.now() - 60_000).toISOString() }));
  w.fastInitialLoad('bg-7', p);
  const d = w.bgTaskDetails(w.sessions.get('bg-7'));
  if (d.length !== 1 || d[0].kind !== 'task' || d[0].known !== true || d[0].description !== 'Build long') throw new Error(JSON.stringify(d));
});

test('fastInitialLoad : tâche fermée plus loin dans le fichier → pas de chip', () => {
  const w = new SessionWatcher(makeMockConfig());
  const p = tmpJsonl('bgclosed');
  const lines = [
    bashToolUse('tu5', 'Tests', 'npm test', { run_in_background: true }),
    bgOpenResult('tu5', 'job5'),
    { type: 'user', timestamp: '2026-09-07T10:00:09.000Z', message: { content: '<task-notification><task-id>job5</task-id><status>completed</status></task-notification>' } },
    { type: 'assistant', timestamp: '2026-09-07T10:00:10.000Z', message: { model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } },
  ];
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  w.sessions.set('bg-5', makeSession('bg-5', { startedAt: new Date(Date.now() - 60_000).toISOString() }));
  w.fastInitialLoad('bg-5', p);
  if (w.bgTaskDetails(w.sessions.get('bg-5')).length !== 0) throw new Error('closed task must not survive');
});

test('fastInitialLoad reconstruit les fiches depuis le tail (tool_use puis résultat)', () => {
  const w = new SessionWatcher(makeMockConfig());
  const p = tmpJsonl('bgtail');
  const lines = [
    bashToolUse('tu9', 'Serveur de dev', 'npx vite --port 5173', { run_in_background: true }),
    bgOpenResult('tu9', 'job9'),
    { type: 'assistant', timestamp: '2026-09-07T10:00:06.000Z', message: { model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } },
  ];
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  w.sessions.set('bg-9', makeSession('bg-9', { startedAt: new Date(Date.now() - 60_000).toISOString() }));
  w.fastInitialLoad('bg-9', p);
  const s = w.sessions.get('bg-9');
  const d = w.bgTaskDetails(s);
  if (d.length !== 1 || d[0].kind !== 'server' || d[0].description !== 'Serveur de dev') throw new Error(JSON.stringify(d));
});

section('readNewLines (lignes partielles):');

function makeReadWatcher(events) {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('sid-partial', makeSession('sid-partial'));
  w.processEvent = (id, ev) => events.push(ev);
  return w;
}

test('readNewLines: ligne partielle en fin de chunk → offset non avancé, event lu entier au poll suivant', () => {
  const file = path.join(os.tmpdir(), `aby-partial-${Date.now()}.jsonl`);
  const full = JSON.stringify({ type: 'assistant', message: { content: 'été noël ✓' } });
  const events = [];
  const w = makeReadWatcher(events);
  try {
    // Poll 1 : une ligne complète + le début d'une seconde (écriture en cours).
    fs.writeFileSync(file, '{"type":"user"}\n' + full.slice(0, 20));
    w.fileOffsets.set(file, 0);
    w.readNewLines('sid-partial', file);
    if (events.length !== 1) throw new Error(`1 event attendu au poll 1, reçu ${events.length}`);
    // Poll 2 : la ligne s'est terminée.
    fs.appendFileSync(file, full.slice(20) + '\n');
    w.readNewLines('sid-partial', file);
    if (events.length !== 2) throw new Error(`2 events attendus au poll 2, reçu ${events.length}`);
    if (events[1].message.content !== 'été noël ✓') throw new Error('event reconstruit corrompu (découpe UTF-8 ?)');
  } finally { fs.rmSync(file, { force: true }); }
});

test('readNewLines: chunk sans aucun \\n → offset inchangé, rien de perdu', () => {
  const file = path.join(os.tmpdir(), `aby-nonl-${Date.now()}.jsonl`);
  const events = [];
  const w = makeReadWatcher(events);
  try {
    fs.writeFileSync(file, '{"type":"user","messa');
    w.fileOffsets.set(file, 0);
    w.readNewLines('sid-partial', file);
    if (events.length !== 0) throw new Error('rien ne doit être parsé');
    if (w.fileOffsets.get(file) !== 0) throw new Error(`offset doit rester 0, vaut ${w.fileOffsets.get(file)}`);
    fs.appendFileSync(file, 'ge":{"content":"ok"}}\n');
    w.readNewLines('sid-partial', file);
    if (events.length !== 1) throw new Error('l\'event complet doit être parsé au poll suivant');
  } finally { fs.rmSync(file, { force: true }); }
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

test('poller re-resolves a moved JSONL (EnterWorktree) and keeps reading', async () => {
  // EnterWorktree change le cwd de la session : Claude Code DÉPLACE le JSONL
  // vers le dossier projet du nouveau cwd (rename, même sid). Le poller doit
  // re-résoudre le chemin au lieu d'avaler ENOENT à vie.
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'aby-mv-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'aby-mv-b-'));
  const fileA = path.join(dirA, 'MV.jsonl');
  const fileB = path.join(dirB, 'MV.jsonl');
  fs.writeFileSync(fileA, JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
    timestamp: '2026-08-05T12:00:00.000Z',
  }) + '\n');

  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('MV', makeSession('MV', { state: STATES.WAITING }));
  w.startFileWatch('MV', fileA);

  try {
    // Le déménagement : rename + le prochain findJsonlPath trouve le nouveau chemin.
    fs.renameSync(fileA, fileB);
    w.findJsonlPath = (sid) => (sid === 'MV' ? fileB : null);
    fs.appendFileSync(fileB, JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }], stop_reason: 'tool_use' },
      timestamp: '2026-08-05T12:00:05.000Z',
    }) + '\n');

    await sleep(700); // > 2 ticks de poll : ENOENT constaté puis re-résolution

    const s = w.sessions.get('MV');
    if (s.jsonlPath !== fileB) throw new Error(`jsonlPath not re-resolved: ${s.jsonlPath}`);
    if (s.state.name !== 'running') throw new Error(`expected running after move, got ${s.state.name}`);
  } finally {
    w.stop();
    try { fs.rmSync(dirA, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(dirB, { recursive: true, force: true }); } catch {}
  }
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

test('scan: flip isBackground when entrypoint changes between scans (resume-safe)', () => {
  const tree = makeFakeClaudeTree();
  const cwd = '/tmp/proj-flip';
  writeSessionJson(tree.sessions, 4005, 'FLIP-id', cwd, Date.now(), 'sdk-cli');
  writeJsonl(tree.projects, cwd, 'FLIP-id', Date.now() - 1000);
  const w = freshScanWatcher(tree.root);
  w.scan();
  if (w.sessions.get('FLIP-id').isBackground !== true) throw new Error('expected true after first scan');
  // Same pid/sessionId resumed interactively (entrypoint now cli)
  writeSessionJson(tree.sessions, 4005, 'FLIP-id', cwd, Date.now(), 'cli');
  w.scan();
  if (w.sessions.get('FLIP-id').isBackground !== false) throw new Error('expected false after entrypoint flip to cli');
});

section('background notification gating:');

test('background + cloche off → pas de session-waiting', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('BGN', makeSession('BGN', { isBackground: true, state: STATES.RUNNING }));
  let fired = false;
  w.on('session-waiting', () => { fired = true; });
  w.setState('BGN', STATES.WAITING, false, 'test');
  if (fired) throw new Error('session-waiting must NOT fire for silent background session');
});

test('background + cloche on → session-waiting émis', () => {
  const config = makeMockConfig();
  config._data.notifications['BGY'] = { modal: true, sound: true };
  const w = new SessionWatcher(config);
  w.sessions.set('BGY', makeSession('BGY', { isBackground: true, state: STATES.RUNNING }));
  let fired = false;
  w.on('session-waiting', () => { fired = true; });
  w.setState('BGY', STATES.WAITING, false, 'test');
  if (!fired) throw new Error('session-waiting must fire when bell is on');
});

test('interactive + cloche off → session-waiting émis (comportement inchangé)', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('FGN', makeSession('FGN', { isBackground: false, state: STATES.RUNNING }));
  let fired = false;
  w.on('session-waiting', () => { fired = true; });
  w.setState('FGN', STATES.WAITING, false, 'test');
  if (!fired) throw new Error('session-waiting must fire for interactive sessions');
});

// ─── refreshSession: relecture hors-bande ────────────────────────
// Le son pending différé décide de sonner sur l'état du watcher, qui retarde
// de jusqu'à ~300ms sur le clic réel (flush JSONL + poll 250ms). refreshSession
// force une relecture immédiate pour que le check au tir voie une approbation
// fraîchement écrite.
section('refreshSession — relecture hors-bande:');

test('voit une approbation fraîchement écrite sans attendre le poll', () => {
  const w = new SessionWatcher(makeMockConfig());
  const p = tmpJsonl('refresh');
  fs.writeFileSync(p, '');
  w.sessions.set('RFR', makeSession('RFR', { jsonlPath: p, state: STATES.PENDING }));
  w.fileOffsets.set(p, 0);
  // L'approbation vient d'être flushée par Claude Code — aucun poller armé.
  fs.appendFileSync(p, JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }],
      stop_reason: 'tool_use' },
  }) + '\n');
  if (w.sessions.get('RFR').state.name !== 'pending') throw new Error('précondition: pending');
  w.refreshSession('RFR');
  const got = w.sessions.get('RFR').state.name;
  if (got !== 'running') throw new Error(`état attendu running après refresh, obtenu ${got}`);
});

test('no-op sans crash pour session inconnue ou sans jsonlPath', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.refreshSession('inconnu');
  w.sessions.set('NOP', makeSession('NOP'));
  w.refreshSession('NOP');
});

// ─── Tâches de fond (Bash run_in_background) ────────────────────
section('bg process — end_turn sur une tâche de fond ouverte:');

const bgOpenEv = (id, ts) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bg', content: `Command running in background with ID: ${id}.` }] },
  toolUseResult: { stdout: '', stderr: '', backgroundTaskId: id },
  timestamp: ts || '2026-07-25T17:34:28.683Z',
});
const bgDoneEv = (id, ts, status = 'completed') => ({
  type: 'user',
  message: { role: 'user', content: `<task-notification> <task-id>${id}</task-id> <tool-use-id>toolu_bg</tool-use-id> <status>${status}</status> <summary>done</summary> </task-notification>` },
  timestamp: ts || '2026-07-25T17:38:45.423Z',
});
const endTurnEv = (ts) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Je te reviens dès que j\'ai les mesures.' }], stop_reason: 'end_turn' },
  timestamp: ts || '2026-07-25T17:34:43.099Z',
});

test('bgTaskOpened lit backgroundTaskId, ignore le reste', () => {
  if (bgTaskOpened(bgOpenEv('b82erfk9x')) !== 'b82erfk9x') throw new Error('ouverture non détectée');
  if (bgTaskOpened({ type: 'user', message: { content: 'hi' } }) !== null) throw new Error('faux positif sur prompt');
  if (bgTaskOpened({ type: 'assistant', toolUseResult: { backgroundTaskId: 'x' } }) !== null) throw new Error('assistant ne doit pas ouvrir');
  if (bgTaskOpened(null) !== null) throw new Error('null doit être toléré');
});

test('bgTaskClosed lit la task-notification (user ET queue-operation, tout statut)', () => {
  if (bgTaskClosed(bgDoneEv('b82erfk9x')) !== 'b82erfk9x') throw new Error('fermeture user non détectée');
  if (bgTaskClosed(bgDoneEv('b1', null, 'failed')) !== 'b1') throw new Error('un échec ferme aussi le job');
  const qEv = { type: 'queue-operation', operation: 'enqueue', content: '<task-notification> <task-id>qid</task-id> <status>completed</status> </task-notification>' };
  if (bgTaskClosed(qEv) !== 'qid') throw new Error('fermeture queue-operation non détectée');
  if (bgTaskClosed({ type: 'user', message: { content: 'parle-moi de <task-notification>' } }) !== null) throw new Error('sans <status> ne ferme pas');
  if (bgTaskClosed(bgOpenEv('z')) !== null) throw new Error('une ouverture ne ferme pas');
});

test('end_turn avec bg ouvert → waiting (la conv est dispo) mais SANS notification', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J1', makeSession('J1', { state: STATES.RUNNING }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });

  w.processEvent('J1', bgOpenEv('bgA'), false);
  w.processEvent('J1', endTurnEv(), false);
  await sleep(2200); // WAITING_DELAY
  const s = w.sessions.get('J1');
  if (s.state.name !== 'waiting') throw new Error(`attendu waiting, obtenu ${s.state.name}`);
  if (notified !== 0) throw new Error(`aucune notif attendue avec un bg ouvert, ${notified} émise(s)`);
  if (s.bgTasks.size !== 1) throw new Error('la tâche doit rester trackée (chip « bg process »)');
});

test('end_turn sans bg ouvert → waiting + notification (aucune régression)', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J2', makeSession('J2', { state: STATES.RUNNING }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });
  w.processEvent('J2', endTurnEv(), false);
  await sleep(2200);
  const got = w.sessions.get('J2').state.name;
  if (got !== 'waiting') throw new Error(`attendu waiting, obtenu ${got}`);
  if (notified !== 1) throw new Error(`notif attendue sans bg ouvert, ${notified} émise(s)`);
});

test('bg terminé avant le end_turn → waiting + notification', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J3', makeSession('J3', { state: STATES.RUNNING }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });
  w.processEvent('J3', bgOpenEv('bgB'), false);
  w.processEvent('J3', bgDoneEv('bgB'), false);
  w.processEvent('J3', endTurnEv(), false);
  await sleep(2200);
  const got = w.sessions.get('J3').state.name;
  if (got !== 'waiting') throw new Error(`attendu waiting, obtenu ${got}`);
  if (notified !== 1) throw new Error(`notif attendue une fois le bg fermé, ${notified} émise(s)`);
});

// Ouverture/fermeture d'un bg PENDANT running : setState(RUNNING) est un no-op
// muet (état inchangé) — sans émission explicite le chip resterait figé à
// l'écran jusqu'à la prochaine transition d'état (constaté en live 2026-07-27 :
// sleep terminé, chip toujours à « 2 bg process »).
test('un bg qui s\'ouvre ou se ferme sans transition d\'état émet session-updated', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J12', makeSession('J12', { state: STATES.RUNNING }));
  let updates = 0;
  w.on('session-updated', () => { updates++; });
  w.processEvent('J12', bgOpenEv('bgU'), false);
  if (updates !== 1) throw new Error(`ouverture → 1 session-updated attendu, obtenu ${updates}`);
  w.processEvent('J12', bgDoneEv('bgU'), false);
  if (updates !== 2) throw new Error(`fermeture → 2 session-updated attendus, obtenu ${updates}`);
  // Une re-fermeture du même id (2e injection de la task-notification) ne
  // change rien au Set → pas d'émission parasite.
  w.processEvent('J12', bgDoneEv('bgU'), false);
  if (updates !== 2) throw new Error(`re-fermeture → toujours 2, obtenu ${updates}`);
});

test('la task-notification relance en running, sans reset du cooldown notif', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J4', makeSession('J4', { state: STATES.WAITING }));
  w.lastNotifTime.set('J4', 12345);
  w.processEvent('J4', bgOpenEv('bgC'), false);
  w.processEvent('J4', bgDoneEv('bgC'), false);
  const s = w.sessions.get('J4');
  if (s.state.name !== 'running') throw new Error(`attendu running, obtenu ${s.state.name}`);
  if (w.lastNotifTime.get('J4') !== 12345) throw new Error('le cooldown ne doit pas être remis à zéro par une reprise auto');
  if (s.bgTasks.size !== 0) throw new Error('la tâche doit être refermée');
});

test('plusieurs bg : muet tant qu\'il en reste un, notifie au dernier fermé', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J5', makeSession('J5', { state: STATES.RUNNING }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });
  w.processEvent('J5', bgOpenEv('b1'), false);
  w.processEvent('J5', bgOpenEv('b2'), false);
  w.processEvent('J5', bgDoneEv('b1'), false);
  w.processEvent('J5', endTurnEv(), false);
  await sleep(2200);
  if (w.sessions.get('J5').state.name !== 'waiting') throw new Error('un bg restant → waiting quand même');
  if (w.sessions.get('J5').bgTasks.size !== 1) throw new Error('une tâche doit rester trackée');
  if (notified !== 0) throw new Error(`muet tant qu'un bg est ouvert, ${notified} émise(s)`);
  w.processEvent('J5', bgDoneEv('b2'), false);
  w.processEvent('J5', endTurnEv(), false);
  await sleep(2200);
  const got = w.sessions.get('J5').state.name;
  if (got !== 'waiting') throw new Error(`dernier bg fermé → waiting, obtenu ${got}`);
  if (notified !== 1) throw new Error(`notif attendue au dernier bg fermé, ${notified} émise(s)`);
});

test('fastInitialLoad reconstruit les bg depuis le tail (waiting + chip)', () => {
  const tmp = tmpJsonl('bg-restore');
  fs.writeFileSync(tmp, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' }, timestamp: '2026-07-25T17:30:00.000Z' }),
    JSON.stringify(bgOpenEv('bgR', '2026-07-25T17:34:28.683Z')),
    JSON.stringify(endTurnEv('2026-07-25T17:34:43.099Z')),
    '',
  ].join('\n'));

  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J6', makeSession('J6', { state: STATES.RUNNING, startedAt: new Date(Date.now() - 60000).toISOString() }));
  w.fastInitialLoad('J6', tmp);
  const s = w.sessions.get('J6');
  if (s.state.name !== 'waiting') throw new Error(`attendu waiting après restauration, obtenu ${s.state.name}`);
  if (s.bgTasks.size !== 1) throw new Error('le bg ouvert doit être restauré pour le chip');
});

test('fastInitialLoad : bg fermé dans le tail → waiting sans chip', () => {
  const tmp = tmpJsonl('bg-restore-done');
  fs.writeFileSync(tmp, [
    JSON.stringify(bgOpenEv('bgS', '2026-07-25T17:34:28.683Z')),
    JSON.stringify(bgDoneEv('bgS', '2026-07-25T17:38:45.423Z')),
    JSON.stringify(endTurnEv('2026-07-25T17:39:00.000Z')),
    '',
  ].join('\n'));

  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J7', makeSession('J7', { state: STATES.RUNNING, startedAt: new Date(Date.now() - 60000).toISOString() }));
  w.fastInitialLoad('J7', tmp);
  const s = w.sessions.get('J7');
  if (s.state.name !== 'waiting') throw new Error(`attendu waiting, obtenu ${s.state.name}`);
  if (s.bgTasks.size !== 0) throw new Error('aucun bg ne doit rester tracké');
});

test('le rappel idle 60s pendant un bg reste ignoré (waiting inchangé, pas de notif)', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J8', makeSession('J8', { state: STATES.WAITING, lastEventTime: Date.now() - 10000, bgTasks: new Set(['vivant']) }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });
  w.markPending('J8', 'Notification', null, true);
  await sleep(1200);
  const got = w.sessions.get('J8').state.name;
  if (got !== 'waiting') throw new Error(`waiting doit survivre au rappel idle, obtenu ${got}`);
  if (notified !== 0) throw new Error('le rappel idle ne doit pas re-notifier');
});

test('une vraie demande de permission pendant un bg passe pending ET notifie', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J9', makeSession('J9', { state: STATES.WAITING, lastEventTime: Date.now() - 10000, bgTasks: new Set(['vivant']) }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });
  w.markPending('J9', 'PermissionRequest', 'Bash', false);
  await sleep(1200);
  const got = w.sessions.get('J9').state.name;
  if (got !== 'pending') throw new Error(`attendu pending, obtenu ${got}`);
  if (notified !== 1) throw new Error(`une permission notifie, bg ouvert ou pas (${notified} émise(s))`);
});

section('markPending — quels pings valent « action requise »');

test('PreToolUse ne vaut plus pending : il part pour CHAQUE outil, auto-approuvé ou lancé par un sous-agent', async () => {
  const w = new SessionWatcher(makeMockConfig());
  // Parent muet depuis 10 s (bloqué sur un fan-out d'agents) : c'est exactement
  // le cas où l'ancien ping PreToolUse basculait la carte en ambre pour rien.
  w.sessions.set('P1', makeSession('P1', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });
  w.markPending('P1', 'PreToolUse', 'Bash', false);
  await sleep(1200);
  const got = w.sessions.get('P1').state.name;
  if (got !== 'running') throw new Error(`PreToolUse ne doit rien changer, obtenu ${got}`);
  if (notified !== 0) throw new Error('PreToolUse ne doit pas notifier');
});

test('PermissionRequest → pending, même en bypass (il ne part que devant un vrai prompt)', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('P2', makeSession('P2', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000, permissionMode: 'bypassPermissions' }));
  w.markPending('P2', 'PermissionRequest', 'Bash', false);
  await sleep(1200);
  const got = w.sessions.get('P2').state.name;
  if (got !== 'pending') throw new Error(`attendu pending, obtenu ${got}`);
});

test('Notification typée hors prompt (auth_success, agent_completed…) → ignorée', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('P3', makeSession('P3', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('P3', 'Notification', null, false, 'auth_success');
  w.markPending('P3', 'Notification', null, false, 'agent_completed');
  await sleep(1200);
  const got = w.sessions.get('P3').state.name;
  if (got !== 'running') throw new Error(`une notif non bloquante ne doit rien changer, obtenu ${got}`);
});

test('Notification permission_prompt / elicitation_dialog → pending', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('P4', makeSession('P4', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('P4', 'Notification', null, false, 'permission_prompt');
  await sleep(1200);
  if (w.sessions.get('P4').state.name !== 'pending') throw new Error('permission_prompt doit passer pending');
  w.sessions.set('P5', makeSession('P5', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('P5', 'Notification', null, false, 'elicitation_dialog');
  await sleep(1200);
  if (w.sessions.get('P5').state.name !== 'pending') throw new Error('elicitation_dialog doit passer pending');
});

test('Notification idle_prompt → correction en waiting (jamais pending), même sans le flag idle', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('P6', makeSession('P6', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('P6', 'Notification', null, false, 'idle_prompt');
  await sleep(1200);
  const got = w.sessions.get('P6').state.name;
  if (got !== 'waiting') throw new Error(`idle_prompt doit corriger en waiting, obtenu ${got}`);
});

test('Notification sans type (CLI ancien) → comportement historique : pending', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('P7', makeSession('P7', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('P7', 'Notification', null, false);
  await sleep(1200);
  if (w.sessions.get('P7').state.name !== 'pending') throw new Error('sans type, une Notification reste un pending');
});

section('pendingRequest — « Action requise » dit ce qu\'elle demande');

test('la cible du hook est portée par la session une fois le pending posé', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('R1', makeSession('R1', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('R1', 'PermissionRequest', 'Bash', false, null, 'supprimer node_modules');
  await sleep(1200);
  const s = w.sessions.get('R1');
  if (s.state.name !== 'pending') throw new Error(`attendu pending, obtenu ${s.state.name}`);
  if (!s.pendingRequest) throw new Error('pendingRequest manquant');
  if (s.pendingRequest.tool !== 'Bash') throw new Error(`tool = ${s.pendingRequest.tool}`);
  if (s.pendingRequest.target !== 'supprimer node_modules') throw new Error(`target = ${s.pendingRequest.target}`);
});

test('sortir du pending purge la demande (elle ne survit pas à la réponse)', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('R2', makeSession('R2', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('R2', 'PermissionRequest', 'Bash', false, null, 'supprimer node_modules');
  await sleep(1200);
  w.setState('R2', STATES.RUNNING, false, 'test');
  const s = w.sessions.get('R2');
  if (s.pendingRequest) throw new Error('pendingRequest aurait dû être purgé');
});

test('idle_prompt ne pose aucune demande : ce n\'est pas une question, c\'est un rappel', async () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('R3', makeSession('R3', { state: STATES.RUNNING, lastEventTime: Date.now() - 10000 }));
  w.markPending('R3', 'Notification', null, false, 'idle_prompt');
  await sleep(1200);
  const s = w.sessions.get('R3');
  if (s.state.name !== 'waiting') throw new Error(`attendu waiting, obtenu ${s.state.name}`);
  if (s.pendingRequest) throw new Error('un rappel idle ne demande rien');
});

test('la trace disque porte l\'outil DEMANDÉ, pas le dernier outil vu dans le JSONL', () => {
  const cfg = makeMockConfig();
  const w = new SessionWatcher(cfg);
  const session = makeSession('R4', { state: STATES.PENDING, lastTool: 'Read', jsonlPath: __filename });
  session.pendingRequest = { tool: 'Bash', target: 'supprimer node_modules' };
  w.sessions.set('R4', session);
  w.markPendingPersisted('R4', session);
  const mark = cfg._data.pendingMarks.R4;
  if (!mark) throw new Error('aucune trace écrite');
  if (mark.tool !== 'Bash') throw new Error(`la trace dit ${mark.tool}, le JSONL disait Read`);
  if (mark.target !== 'supprimer node_modules') throw new Error(`target = ${mark.target}`);
});

test('au redémarrage, la demande revient avec le pending restauré', () => {
  const cfg = makeMockConfig();
  const w = new SessionWatcher(cfg);
  const session = makeSession('R5', { state: STATES.RUNNING });
  w.sessions.set('R5', session);
  cfg._data.pendingMarks.R5 = { mtimeMs: 1000, tool: 'Bash', target: 'supprimer node_modules', at: 900 };
  const restored = w.restorePending('R5', { mtimeMs: 1000 });
  if (!restored) throw new Error('le pending aurait dû être restauré (mtime inchangé)');
  const s = w.sessions.get('R5');
  if (!s.pendingRequest || s.pendingRequest.target !== 'supprimer node_modules') {
    throw new Error(`demande non restaurée : ${JSON.stringify(s.pendingRequest)}`);
  }
});

test('une trace périmée (JSONL réécrit app éteinte) ne restaure aucune demande', () => {
  const cfg = makeMockConfig();
  const w = new SessionWatcher(cfg);
  w.sessions.set('R6', makeSession('R6', { state: STATES.RUNNING }));
  cfg._data.pendingMarks.R6 = { mtimeMs: 1000, tool: 'Bash', target: 'supprimer node_modules', at: 900 };
  const restored = w.restorePending('R6', { mtimeMs: 2000 });
  if (restored) throw new Error('mtime plus récent = la question a été traitée');
  if (w.sessions.get('R6').pendingRequest) throw new Error('aucune demande ne doit survivre');
});

section('findJsonlPath — plusieurs dossiers projet pour un même sid');

test('le journal le plus récemment écrit gagne (dossier projet renommé → copie périmée dans l\'ancien slug)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aby-jsonl-dup-'));
  const projects = path.join(root, 'projects');
  const now = Date.now();
  // L'ancien slug trie AVANT le nouveau (readdir lexicographique : « Priv-e » < « agents »),
  // c'est lui que le premier-trouvé renvoyait — copie figée depuis 3 semaines.
  const stale = writeJsonl(projects, '/Users/p/Project/Priv-e/agents-platform', 'dup-id', now - 21 * 86400 * 1000);
  const live = writeJsonl(projects, '/Users/p/Project/agents-platform', 'dup-id', now - 60 * 1000);
  const w = new SessionWatcher(makeMockConfig());
  const got = w.findJsonlPath('dup-id', projects);
  if (got !== live) throw new Error(`attendu la copie vivante ${live}, obtenu ${got}`);
  if (got === stale) throw new Error('la copie périmée a été choisie');
  if (w.findJsonlPath('absent-id', projects) !== null) throw new Error('sid inconnu → null');
});

test('garde-fou : bg muet depuis > 45 min → tâches lâchées + notif tardive', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J10', makeSession('J10', {
    state: STATES.WAITING,
    lastEventTime: Date.now() - 46 * 60 * 1000,
    bgTasks: new Set(['zombie']),
  }));
  let notified = 0;
  w.on('session-waiting', () => { notified++; });
  w.scan();
  const s = w.sessions.get('J10');
  if (s.bgTasks.size !== 0) throw new Error('la tâche zombie doit être lâchée');
  if (notified !== 1) throw new Error(`notif tardive attendue à la purge, ${notified} émise(s)`);
});

test('garde-fou : un bg récent n\'est pas lâché', () => {
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('J11', makeSession('J11', {
    state: STATES.WAITING,
    lastEventTime: Date.now() - 20 * 60 * 1000,
    bgTasks: new Set(['vivant']),
  }));
  w.scan();
  if (w.sessions.get('J11').bgTasks.size !== 1) throw new Error('un import de 20 min reste tracké');
});

section('Nom de session explicite (claude -n / /name)');

test('nameSource "user" → le nom est retenu', () => {
  const got = explicitSessionName({ name: '🦉 Athéna · perso', nameSource: 'user' });
  if (got !== '🦉 Athéna · perso') throw new Error(`got ${JSON.stringify(got)}`);
});

// Le cas réel de `claude -n "…" -p …` sur 2.1.220 : name écrit, nameSource OMIS.
// Filtrer sur nameSource === 'user' ratait précisément les bureaux headless.
test('nameSource ABSENT (claude -n en print/SDK) → le nom est retenu', () => {
  const got = explicitSessionName({ name: '🦉 Athéna · test', entrypoint: 'sdk-cli' });
  if (got !== '🦉 Athéna · test') throw new Error(`got ${JSON.stringify(got)}`);
});

test('nameSource "derived" → ignoré (doublon du dossier)', () => {
  if (explicitSessionName({ name: 'perso-agents-23', nameSource: 'derived' }) !== null) {
    throw new Error('un nom dérivé du dossier ne doit pas primer sur le basename');
  }
});

test('nameSource "auto" → ignoré (nom mouvant)', () => {
  if (explicitSessionName({ name: 'fixing the island', nameSource: 'auto' }) !== null) {
    throw new Error('un nom auto-généré peut changer en cours de session');
  }
});

test('nom vide / absent / non-string → null', () => {
  if (explicitSessionName({ name: '   ' }) !== null) throw new Error('espaces seules');
  if (explicitSessionName({ nameSource: 'user' }) !== null) throw new Error('nom absent');
  if (explicitSessionName({}) !== null) throw new Error('ni nom ni source');
  if (explicitSessionName({ name: 42, nameSource: 'user' }) !== null) throw new Error('nom non-string');
  if (explicitSessionName(null) !== null) throw new Error('data absent');
});

test('caractères de contrôle strippés, longueur capée à 60', () => {
  const got = explicitSessionName({ name: 'Athéna\n', nameSource: 'user' });
  if (got !== 'Athéna') throw new Error(`got ${JSON.stringify(got)}`);
  const long = explicitSessionName({ name: 'x'.repeat(200), nameSource: 'user' });
  if (long.length !== 60) throw new Error(`got ${long.length}`);
});

// ─── stateSince ───────────────────────────────────────────────────
section('stateSince');

test('setState pose stateSince à la transition (at explicite) et le persiste', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('a', makeSession('a', { state: STATES.RUNNING }));
  w.setState('a', STATES.WAITING, false, 'test', 12345);
  if (w.sessions.get('a').stateSince !== 12345) throw new Error('stateSince doit valoir le at explicite');
  if (config._data.sessions['a'].stateSince !== 12345) throw new Error('stateSince doit être persisté');
});

test('setState sans at → Date.now() approx', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('a', makeSession('a', { state: STATES.RUNNING }));
  const before = Date.now();
  w.setState('a', STATES.WAITING, false, 'test');
  const since = w.sessions.get('a').stateSince;
  if (!(since >= before && since <= Date.now())) throw new Error('stateSince doit dater de maintenant');
});

test('setState même état = no-op, stateSince conservé', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('a', makeSession('a', { state: STATES.WAITING, stateSince: 777 }));
  w.setState('a', STATES.WAITING, false, 'test', 99999);
  if (w.sessions.get('a').stateSince !== 777) throw new Error('un no-op ne doit pas retoucher stateSince');
});

test('no-op au démarrage : stateSince absent → amorcé au at de restauration', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  // Session restaurée d'une config écrite avant la feature : pas de stateSince,
  // et l'état déduit du JSONL est identique → setState est un no-op.
  w.sessions.set('a', makeSession('a', { state: STATES.WAITING }));
  w.sessions.get('a').stateSince = null;
  w.setState('a', STATES.WAITING, true, 'initial-scan', 4242);
  if (w.sessions.get('a').stateSince !== 4242) throw new Error('stateSince doit être amorcé au mtime');
  if (config._data.sessions['a'].stateSince !== 4242) throw new Error('amorçage doit être persisté');
});

test('no-op sans at (marche courante) : pas d’amorçage fabriqué', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('a', makeSession('a', { state: STATES.WAITING }));
  w.sessions.get('a').stateSince = null;
  w.setState('a', STATES.WAITING, false, 'test');
  if (w.sessions.get('a').stateSince != null) throw new Error('sans at, un no-op ne doit rien inventer');
});

// ═══ isRealModel ═══

test('isRealModel : un vrai slug de modèle est retenu', () => {
  if (!isRealModel('claude-opus-5')) throw new Error('claude-opus-5 doit être retenu');
});

test('isRealModel : <synthetic> rejeté (n’écrase pas le modèle réel)', () => {
  if (isRealModel('<synthetic>')) throw new Error('<synthetic> ne doit jamais écraser le modèle');
});

test('isRealModel : vide / absent / non-string rejetés', () => {
  if (isRealModel('') || isRealModel(null) || isRealModel(undefined) || isRealModel(42)) {
    throw new Error('valeurs non exploitables à rejeter');
  }
});

test('un changement de modèle EN COURS de session est repris (Opus 4.8 → Opus 5)', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  const s = makeSession('a', { state: STATES.RUNNING });
  s.model = 'claude-opus-4-8';
  w.sessions.set('a', s);
  w.processAssistantEvent('a', s, { message: { model: 'claude-opus-5', content: [] } }, false);
  if (s.model !== 'claude-opus-5') throw new Error(`modèle figé sur ${s.model}`);
});

test('un event assistant synthétique ne remplace pas le modèle de la session', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  const s = makeSession('a', { state: STATES.RUNNING });
  s.model = 'claude-opus-5';
  w.sessions.set('a', s);
  w.processAssistantEvent('a', s, { message: { model: '<synthetic>', content: [] } }, false);
  if (s.model !== 'claude-opus-5') throw new Error(`modèle écrasé : ${s.model}`);
});

// ═══ chip Chrome (détection) ═══

section('chip Chrome (détection):');

test('isChromeToolUse: prefixe mcp__claude-in-chrome__ uniquement', () => {
  if (!isChromeToolUse('mcp__claude-in-chrome__navigate')) throw new Error('navigate doit matcher');
  if (!isChromeToolUse('mcp__claude-in-chrome__browser_batch')) throw new Error('browser_batch doit matcher');
  if (isChromeToolUse('Bash')) throw new Error('Bash ne doit pas matcher');
  if (isChromeToolUse('mcp__browsermcp__browser_click')) throw new Error('browsermcp ne doit pas matcher');
  if (isChromeToolUse(undefined)) throw new Error('undefined ne doit pas matcher');
});

test('processAssistantEvent: tool_use chrome pose chromeLastUsedAt au timestamp de l\'event', () => {
  const w = new SessionWatcher(makeMockConfig());
  const s = makeSession('sid-chrome', { chromeLastUsedAt: null });
  w.sessions.set('sid-chrome', s);
  const ts = '2026-08-04T08:30:10.448Z';
  w.processAssistantEvent('sid-chrome', s, {
    type: 'assistant', timestamp: ts,
    message: { stop_reason: 'tool_use', content: [
      { type: 'text', text: 'go' },
      { type: 'tool_use', name: 'mcp__claude-in-chrome__navigate', input: {} },
    ] },
  }, true);
  if (s.chromeLastUsedAt !== Date.parse(ts)) throw new Error(`attendu ${Date.parse(ts)}, reçu ${s.chromeLastUsedAt}`);
});

test('processAssistantEvent: tool_use non-chrome ne touche pas chromeLastUsedAt', () => {
  const w = new SessionWatcher(makeMockConfig());
  const s = makeSession('sid-nochrome', { chromeLastUsedAt: 12345 });
  w.sessions.set('sid-nochrome', s);
  w.processAssistantEvent('sid-nochrome', s, {
    type: 'assistant', timestamp: '2026-08-04T09:00:00.000Z',
    message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
  }, true);
  if (s.chromeLastUsedAt !== 12345) throw new Error('chromeLastUsedAt ne doit pas bouger');
});

test('fastInitialLoad: restaure chromeLastUsedAt depuis le tail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aby-chrome-tail-'));
  const file = path.join(dir, 'sid-tail.jsonl');
  const ts = '2026-08-04T08:20:15.677Z';
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', timestamp: '2026-08-04T08:20:00.000Z', message: { role: 'user', content: 'vas-y' } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'mcp__claude-in-chrome__browser_batch', input: {} }] } }),
  ].join('\n') + '\n');
  const w = new SessionWatcher(makeMockConfig());
  w.sessions.set('sid-tail', makeSession('sid-tail', { chromeLastUsedAt: null }));
  w.findJsonlPath = () => file;
  w.fastInitialLoad('sid-tail', file);
  const s = w.sessions.get('sid-tail');
  if (s.chromeLastUsedAt !== Date.parse(ts)) throw new Error(`attendu ${Date.parse(ts)}, reçu ${s.chromeLastUsedAt}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

runAll().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
