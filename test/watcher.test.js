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
    endedAt: null,
    tokens: { input: 0, output: 0 },
    remoteUrl: null,
    terminalApp: null,
    terminalId: null,
    lastEventTime: Date.now(),
    hasActivity: true,
    wasResumed: false,
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

// ─── /clear migration safety ─────────────────────────────────────
section('migration safety:');

test('shouldMigrateOnClear: true when old session shares same PID', () => {
  const w = new SessionWatcher(makeMockConfig());
  const old = makeSession('A', { pid: 1234 });
  if (w._shouldMigrateOnClear(old, 1234) !== true) throw new Error('expected true for same PID');
});

test('shouldMigrateOnClear: false when old session has different alive PID', () => {
  const w = new SessionWatcher(makeMockConfig());
  // Use this process's PID as the "old" PID so isPidAlive returns true
  const old = makeSession('A', { pid: process.pid });
  if (w._shouldMigrateOnClear(old, process.pid + 1) !== false) {
    throw new Error('expected false for different alive PID');
  }
});

test('shouldMigrateOnClear: true when old session PID is dead', () => {
  const w = new SessionWatcher(makeMockConfig());
  // PID 999999 unlikely to be alive
  const old = makeSession('A', { pid: 999999 });
  if (w._shouldMigrateOnClear(old, 1234) !== true) throw new Error('expected true for dead PID');
});

test('shouldMigrateOnClear: true when old session has no PID', () => {
  const w = new SessionWatcher(makeMockConfig());
  const old = makeSession('A', { pid: null });
  if (w._shouldMigrateOnClear(old, 1234) !== true) throw new Error('expected true for null PID');
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
  config._data.sessions['A'] = { stateName: 'completed' };
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

runAll().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
