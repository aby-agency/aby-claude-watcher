const fs = require('fs');
const path = require('path');
const os = require('os');
const { scanWorkflows, SubagentTracker, WORKFLOW_STALE_MS } = require('../subagents');

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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'workflows-test-'));
  tmpFiles.push(p);
  return p;
}
process.on('exit', () => {
  for (const p of tmpFiles) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
});

// Construit un sessionDir avec N runs de workflow.
// run = { runId, journalLines (array de strings brutes), scriptName, state (objet ou
//         string brute), journalAgoMs }
function setupWorkflowDir(runs = []) {
  const root = tmpDir();
  const sessionDir = path.join(root, 'sess1');
  for (const run of runs) {
    const runDir = path.join(sessionDir, 'subagents', 'workflows', run.runId);
    fs.mkdirSync(runDir, { recursive: true });
    if (run.journalLines != null) {
      fs.writeFileSync(path.join(runDir, 'journal.jsonl'), run.journalLines.join('\n') + '\n');
      if (run.journalAgoMs != null) {
        const mtime = (Date.now() - run.journalAgoMs) / 1000;
        fs.utimesSync(path.join(runDir, 'journal.jsonl'), mtime, mtime);
      }
    }
    if (run.scriptName) {
      const scriptsDir = path.join(sessionDir, 'workflows', 'scripts');
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(path.join(scriptsDir, `${run.scriptName}-${run.runId}.js`), '// stub');
    }
    if (run.state != null) {
      const wfDir = path.join(sessionDir, 'workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      const body = typeof run.state === 'string' ? run.state : JSON.stringify(run.state);
      fs.writeFileSync(path.join(wfDir, `${run.runId}.json`), body);
    }
  }
  return sessionDir;
}

function started(id) { return JSON.stringify({ type: 'started', agentId: id, key: 'k' + id }); }
function result(id) { return JSON.stringify({ type: 'result', agentId: id, key: 'k' + id, result: {} }); }

section('scanWorkflows — compteurs:');

test('compte started/done/running depuis le journal', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_abc123-x01',
    scriptName: 'deep-research',
    journalLines: [started('a1'), started('a2'), started('a3'), result('a1'), result('a2')],
  }]);
  const r = scanWorkflows(dir, new Map());
  if (r.length !== 1) throw new Error(`expected 1 run, got ${r.length}`);
  const wf = r[0];
  if (wf.started !== 3) throw new Error(`started=${wf.started}`);
  if (wf.done !== 2) throw new Error(`done=${wf.done}`);
  if (wf.running !== 1) throw new Error(`running=${wf.running}`);
  if (wf.status !== 'running') throw new Error(`status=${wf.status}`);
  if (wf.name !== 'deep-research') throw new Error(`name=${wf.name}`);
});

test('ignore la dernière ligne tronquée du journal', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_trunc-001',
    journalLines: [started('a1'), result('a1'), '{"type":"started","agen'],
  }]);
  const r = scanWorkflows(dir, new Map());
  if (r[0].started !== 1) throw new Error(`started=${r[0].started}`);
  if (r[0].done !== 1) throw new Error(`done=${r[0].done}`);
});

test('agentId dédupliqué (started répété ne compte qu\'une fois)', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_dup-001',
    journalLines: [started('a1'), started('a1'), result('a1')],
  }]);
  const r = scanWorkflows(dir, new Map());
  if (r[0].started !== 1) throw new Error(`started=${r[0].started}`);
  if (r[0].running !== 0) throw new Error(`running=${r[0].running}`);
});

section('scanWorkflows — robustesse:');

test('retourne [] sans dossier workflows', () => {
  const dir = tmpDir();
  const r = scanWorkflows(dir, new Map());
  if (!Array.isArray(r) || r.length !== 0) throw new Error('expected []');
});

test('run sans journal → ignoré, pas de crash', () => {
  const dir = setupWorkflowDir([{ runId: 'wf_nojournal-1' }]);
  const r = scanWorkflows(dir, new Map());
  if (r.length !== 0) throw new Error(`expected 0, got ${r.length}`);
});

test('entrées non-wf_ ignorées', () => {
  const dir = setupWorkflowDir([{ runId: 'wf_real-001', journalLines: [started('a1')] }]);
  fs.mkdirSync(path.join(dir, 'subagents', 'workflows', 'not-a-run'), { recursive: true });
  const r = scanWorkflows(dir, new Map());
  if (r.length !== 1) throw new Error(`expected 1, got ${r.length}`);
});

test('sans script file → nom fallback = runId', () => {
  const dir = setupWorkflowDir([{ runId: 'wf_noname-01', journalLines: [started('a1')] }]);
  const r = scanWorkflows(dir, new Map());
  if (r[0].name !== 'wf_noname-01') throw new Error(`name=${r[0].name}`);
});

section('scanWorkflows — fichier d\'état:');

test('état completed → status completed + stats', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_done-0001',
    journalLines: [started('a1'), result('a1')],
    state: { status: 'completed', workflowName: 'deep-research', agentCount: 103, durationMs: 364772 },
  }]);
  const r = scanWorkflows(dir, new Map());
  if (r[0].status !== 'completed') throw new Error(`status=${r[0].status}`);
  if (r[0].stats.agentCount !== 103) throw new Error(`agentCount=${r[0].stats.agentCount}`);
  if (r[0].stats.durationMs !== 364772) throw new Error(`durationMs=${r[0].stats.durationMs}`);
  if (r[0].name !== 'deep-research') throw new Error(`name=${r[0].name}`);
});

test('état JSON tronqué → pas caché, status reste running', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_partial-01',
    journalLines: [started('a1')],
    state: '{"status":"compl',  // écriture en cours
  }]);
  const cache = new Map();
  const r = scanWorkflows(dir, cache);
  if (r[0].status !== 'running') throw new Error(`status=${r[0].status}`);
  if (cache.has('wf_partial-01')) throw new Error('un état illisible ne doit pas être caché');
});

test('état completed mis en cache → relu depuis le cache au scan suivant', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_cache-001',
    journalLines: [started('a1'), result('a1')],
    state: { status: 'completed', agentCount: 5, durationMs: 1000 },
  }]);
  const cache = new Map();
  scanWorkflows(dir, cache);
  if (!cache.has('wf_cache-001')) throw new Error('état terminal non caché');
  // Supprimer le fichier : le cache doit suffire
  fs.unlinkSync(path.join(dir, 'workflows', 'wf_cache-001.json'));
  const r = scanWorkflows(dir, cache);
  if (r[0].status !== 'completed') throw new Error(`status=${r[0].status} (cache non utilisé)`);
});

test('état non-terminal (status running) → PAS mis en cache (sinon la fin est ratée)', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_midrun-01',
    journalLines: [started('a1')],
    state: { status: 'running' },
  }]);
  const cache = new Map();
  const r = scanWorkflows(dir, cache);
  if (r[0].status !== 'running') throw new Error(`status=${r[0].status}`);
  if (cache.has('wf_midrun-01')) throw new Error('un état non-terminal ne doit pas être caché');
});

section('scanWorkflows — stale:');

test('journal inactif > WORKFLOW_STALE_MS sans état → status stale', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_stale-001',
    journalLines: [started('a1')],
    journalAgoMs: WORKFLOW_STALE_MS + 60_000,
  }]);
  const r = scanWorkflows(dir, new Map());
  if (r[0].status !== 'stale') throw new Error(`status=${r[0].status}`);
});

test('journal récent → running (pas stale)', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_fresh-001',
    journalLines: [started('a1')],
    journalAgoMs: 1000,
  }]);
  const r = scanWorkflows(dir, new Map());
  if (r[0].status !== 'running') throw new Error(`status=${r[0].status}`);
});

section('SubagentTracker.workflowsForSession:');

test('utilise le cache interne du tracker entre deux appels', () => {
  const dir = setupWorkflowDir([{
    runId: 'wf_trk-00001',
    journalLines: [started('a1'), result('a1')],
    state: { status: 'completed', agentCount: 2, durationMs: 500 },
  }]);
  const tracker = new SubagentTracker();
  tracker.workflowsForSession(dir);
  fs.unlinkSync(path.join(dir, 'workflows', 'wf_trk-00001.json'));
  const r = tracker.workflowsForSession(dir);
  if (r[0].status !== 'completed') throw new Error('cache du tracker non utilisé');
});

runAll().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
