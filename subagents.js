const fs = require('fs');
const path = require('path');

const TAIL_BYTES = 64 * 1024;
const ERROR_TIMEOUT_MS = 30000;

function readMeta(metaPath) {
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readLastEvent(jsonlPath) {
  let fd;
  try {
    const stat = fs.statSync(jsonlPath);
    if (stat.size === 0) return null;
    fd = fs.openSync(jsonlPath, 'r');
    let start = Math.max(0, stat.size - TAIL_BYTES);
    while (true) {
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const text = buf.toString('utf-8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (start === 0 || lines.length > 1) {
        const last = lines[lines.length - 1];
        if (!last) return null;
        try { return JSON.parse(last); } catch { return null; }
      }
      // Single (possibly truncated) line — grow window
      start = Math.max(0, start - TAIL_BYTES);
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function deriveState(lastEvent, mtimeMs, nowMs = Date.now()) {
  if (!lastEvent) return 'error';

  const msg = lastEvent.message || {};
  const stopReason = msg.stop_reason;
  const ageMs = nowMs - mtimeMs;

  if (stopReason === 'end_turn') return 'completed';
  if (stopReason == null && ageMs > ERROR_TIMEOUT_MS) return 'error';
  return 'running';
}

const WORKFLOW_STALE_MS = 30 * 60 * 1000;

// journal.jsonl d'un run de workflow : {"type":"started","agentId":...} à chaque
// dispatch, {"type":"result","agentId":...} à chaque fin. Dédupliqué par agentId
// (un resume peut rejouer des événements). Dernière ligne potentiellement
// tronquée (écriture en cours) → ignorée silencieusement.
function readJournalCounts(journalPath) {
  let text;
  try { text = fs.readFileSync(journalPath, 'utf-8'); } catch { return null; }
  const startedIds = new Set();
  const doneIds = new Set();
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (e.type === 'started' && e.agentId) startedIds.add(e.agentId);
    else if (e.type === 'result' && e.agentId) doneIds.add(e.agentId);
  }
  return { started: startedIds.size, done: doneIds.size };
}

// Le script du run est persisté dès le lancement sous
// workflows/scripts/<name>-<runId>.js — seul endroit où le nom du workflow
// existe avant la fin du run.
function workflowNameFromScripts(sessionDir, runId) {
  const scriptsDir = path.join(sessionDir, 'workflows', 'scripts');
  let entries;
  try { entries = fs.readdirSync(scriptsDir); } catch { return null; }
  const suffix = `-${runId}.js`;
  const match = entries.find(f => f.endsWith(suffix));
  return match ? match.slice(0, -suffix.length) : null;
}

// workflows/<runId>.json — écrit en fin de run. null si absent OU illisible
// (JSON tronqué pendant l'écriture) : l'appelant retentera au tick suivant.
function readWorkflowState(statePath) {
  try {
    const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (!data || typeof data !== 'object') return null;
    return {
      status: data.status || null,
      workflowName: data.workflowName || null,
      agentCount: typeof data.agentCount === 'number' ? data.agentCount : null,
      durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
    };
  } catch {
    return null;
  }
}

// Scanne les runs de workflow d'une session. Retourne TOUS les runs (y compris
// terminés/stale) — c'est l'appelant qui filtre pour l'UI ; la détection de fin
// de run a besoin des terminés. stateCache (Map runId → état) ne reçoit que les
// états terminaux : un état "running" doit être relu à chaque scan, sinon la
// complétion ne serait jamais vue.
function scanWorkflows(sessionDir, stateCache, nowMs = Date.now()) {
  const out = [];
  const wfDir = path.join(sessionDir, 'subagents', 'workflows');
  let entries;
  try { entries = fs.readdirSync(wfDir); } catch { return out; }

  for (const runId of entries) {
    if (!runId.startsWith('wf_')) continue;
    const journalPath = path.join(wfDir, runId, 'journal.jsonl');
    const counts = readJournalCounts(journalPath);
    if (!counts) continue; // journal absent/illisible → run ignoré

    let lastActivityTs = 0;
    try { lastActivityTs = fs.statSync(journalPath).mtimeMs; } catch {}

    let state = stateCache ? stateCache.get(runId) : undefined;
    if (state === undefined) {
      state = readWorkflowState(path.join(sessionDir, 'workflows', `${runId}.json`));
      if (state && state.status === 'completed' && stateCache) stateCache.set(runId, state);
    }

    let status;
    if (state && state.status === 'completed') status = 'completed';
    else if (nowMs - lastActivityTs > WORKFLOW_STALE_MS) status = 'stale'; // run tué sans état → badge retiré sans notif
    else status = 'running';

    out.push({
      runId,
      name: (state && state.workflowName) || workflowNameFromScripts(sessionDir, runId) || runId,
      status,
      started: counts.started,
      done: counts.done,
      running: Math.max(0, counts.started - counts.done),
      lastActivityTs,
      stats: (state && state.status === 'completed')
        ? { agentCount: state.agentCount, durationMs: state.durationMs }
        : null,
    });
  }
  return out;
}

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
    if (!meta) continue;

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

// Porte le cache des états terminaux de workflows (runId → état completed) ;
// le scan subagents reste stateless.
class SubagentTracker {
  constructor() {
    this.workflowStateCache = new Map();
  }

  snapshotForSession(sessionDir, dispatches) {
    // Show every running agent — foreground and background alike (the "fleet"
    // view). Background agents run detached (easy to forget); foreground ones
    // are the active team. Completed/errored agents are still excluded.
    return scanSession(sessionDir, dispatches)
      .filter(sa => sa.state === 'running');
  }

  // Tous les runs de workflow (terminés inclus — main.js détecte les
  // transitions ; l'UI filtre sur status === 'running').
  workflowsForSession(sessionDir) {
    return scanWorkflows(sessionDir, this.workflowStateCache);
  }
}

// True when the session is blocked on a synchronous (foreground) subagent: the
// parent is delegating and busy, NOT waiting on the user — so its pending/orange
// state and "needs you" notification are false positives. Background agents
// (runInBackground === true) run detached, so the parent can still legitimately
// be pending; they do not count. `snapshot` is the running-only list from
// snapshotForSession. Unknown dispatch mode (undefined) is treated as non-blocking.
function hasBlockingForegroundAgent(snapshot) {
  return Array.isArray(snapshot)
    && snapshot.some(sa => sa.state === 'running' && sa.runInBackground === false);
}

module.exports = {
  readMeta,
  readLastEvent,
  deriveState,
  scanSession,
  scanWorkflows,
  readJournalCounts,
  workflowNameFromScripts,
  readWorkflowState,
  SubagentTracker,
  hasBlockingForegroundAgent,
  ERROR_TIMEOUT_MS,
  TAIL_BYTES,
  WORKFLOW_STALE_MS,
};
