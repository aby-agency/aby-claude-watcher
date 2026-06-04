# Détection des workflows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher un badge agrégé par workflow multi-agents actif sous chaque session, avec compteurs live et notification de fin de run.

**Architecture:** Nouveau scanner `scanWorkflows()` dans `subagents.js` (journal.jsonl pour le live, script filename pour le nom, fichier d'état pour la fin + stats). `main.js` sérialise `workflows: [...]`, suit les runs actifs via un tick 2 s et émet une notif one-shot à la complétion. `ui/renderer.js` rend le badge dans le bloc subagents existant (3 vues).

**Tech Stack:** Electron (main + renderer vanilla JS), tests Node natifs maison (pattern `test/subagents.test.js`).

**Spec:** `docs/superpowers/specs/2026-06-04-workflow-detection-design.md`

**Convention commits :** messages signés Paul uniquement — JAMAIS de trailer `Co-Authored-By: Claude` (règle CLAUDE.md global, override le défaut système).

---

## Rappel des sources de données

Pour `<sessionDir> = <projectDir>/<sessionId>` :

- `<sessionDir>/subagents/workflows/wf_<runId>/journal.jsonl` — live, événements `{"type":"started","agentId":...}` / `{"type":"result","agentId":...}` (un par agent). Compteurs : lancés / terminés.
- `<sessionDir>/workflows/scripts/<name>-wf_<runId>.js` — présent dès le lancement, nom = préfixe du filename.
- `<sessionDir>/workflows/wf_<runId>.json` — écrit en fin de run : `{status:"completed", workflowName, agentCount, durationMs, ...}`. Peut être gros (160 Ko) et peut être lu en cours d'écriture (JSON tronqué).

Note : dans les paths réels, le dossier du run s'appelle `wf_bcb66db1-c51` et le runId complet est `wf_bcb66db1-c51` — le nom de dossier EST le runId, préfixe `wf_` inclus.

---

### Task 1 : Scanner `scanWorkflows` dans `subagents.js`

**Files:**
- Modify: `subagents.js` (ajouts avant `module.exports`, constructeur de `SubagentTracker`, exports)
- Create: `test/workflows.test.js`
- Modify: `package.json:10` (script `test`)

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `test/workflows.test.js` :

```js
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

test('agentId dédupliqué (started répété ne compte qu’une fois)', () => {
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

section('scanWorkflows — fichier d’état:');

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
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run : `node test/workflows.test.js`
Expected : crash immédiat `TypeError: scanWorkflows is not a function` (l'import vaut `undefined`).

- [ ] **Step 3 : Implémenter dans `subagents.js`**

Ajouter après la fonction `deriveState` (avant `scanSession`) :

```js
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
```

Modifier la classe `SubagentTracker` (le commentaire « Stateless today » saute — elle porte maintenant le cache d'états terminaux) :

```js
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
```

Compléter `module.exports` :

```js
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
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run : `node test/workflows.test.js`
Expected : `14 passed, 0 failed`

- [ ] **Step 5 : Brancher la suite + non-régression**

Dans `package.json`, ligne 10, ajouter le nouveau fichier à la fin du script `test` :

```json
"test": "node test/url.test.js && node test/focus.test.js && node test/config.test.js && node test/updater.test.js && node test/watcher.test.js && node test/subagents.test.js && node test/workflows.test.js"
```

Run : `npm test`
Expected : toutes les suites passent (la suite subagents existante ne doit pas régresser — le constructeur ajouté est sans argument).

Note : PAS de changement à `build.files` — aucun nouveau module runtime, `test/` n'est pas embarqué dans le DMG.

- [ ] **Step 6 : Commit**

```bash
git add subagents.js test/workflows.test.js package.json
git commit -m "feat(subagents): scanner de workflows multi-agents (journal + script + état)"
```

---

### Task 2 : Sérialisation, tick live et notification dans `main.js`

**Files:**
- Modify: `main.js` (serializeSession ~l.489, setupWatcher ~l.175, zone des helpers ~l.27)

- [ ] **Step 1 : Suivi des runs actifs + notification (helpers)**

Dans `main.js`, après la fonction `effectiveStateName` (~l.41), ajouter :

```js
// ─── Workflows multi-agents (tool Workflow) ───
// workflowActive : sessionId → Set(runId) vus "running" au dernier scan. Sert
// d'amorçage au tick ET de mémoire de transition : un run découvert déjà
// completed (watcher démarré après la fin) n'y entre jamais → pas de notif
// rétroactive. notifiedWorkflowRuns : garde one-shot par runId (un run ne se
// termine qu'une fois, pas besoin du cooldown 30 s).
const WORKFLOW_TICK_MS = 2000;
const workflowActive = new Map();
const notifiedWorkflowRuns = new Set();

function notifyWorkflowDone(session, wf) {
  log.info(`[workflow] ${wf.runId} (${wf.name}) completed — ${wf.stats ? wf.stats.agentCount : wf.started} agents`);
  const prefs = config.getNotificationPrefs(session.sessionId);
  sendToRenderer('show-notification', {
    sessionId: session.sessionId,
    projectName: session.projectName,
    customName: config.getCustomName(session.sessionId),
    slug: session.slug,
    kind: 'workflow-done',
    workflowName: wf.name,
    agentCount: (wf.stats && wf.stats.agentCount) || wf.started,
    durationMs: (wf.stats && wf.stats.durationMs) || null,
  });
  if (prefs.sound) {
    sendToRenderer('play-sound', { kind: 'waiting', sessionId: session.sessionId });
  }
}

// Tick 2 s : le JSONL parent peut rester silencieux pendant tout un run (Claude
// a fini son tour, le workflow tourne détaché) — sans ce tick, ni le badge ni
// la notif de fin ne bougeraient. No-op disque quand aucun run n'est suivi.
function workflowTick() {
  if (!watcher || workflowActive.size === 0) return;
  const sessions = watcher.getSessions();
  // Copie : serializeSession ré-insère les clés pendant l'itération, et une clé
  // delete+set serait revisitée par l'itérateur du Map (boucle infinie).
  for (const [sessionId, activeRuns] of [...workflowActive]) {
    const session = sessions.find(s => s.sessionId === sessionId);
    const dir = session ? sessionDirFor(session) : null;
    if (!dir) { workflowActive.delete(sessionId); continue; }

    const all = subagentTracker.workflowsForSession(dir);
    for (const wf of all) {
      if (wf.status === 'completed' && activeRuns.has(wf.runId) && !notifiedWorkflowRuns.has(wf.runId)) {
        notifiedWorkflowRuns.add(wf.runId);
        notifyWorkflowDone(session, wf);
      }
    }
    // serializeSession remet à jour workflowActive (ou la session en sort si
    // plus aucun run actif) et pousse le badge frais au renderer.
    workflowActive.delete(sessionId);
    sendToRenderer('session-updated', serializeSession(session));
  }
}
```

- [ ] **Step 2 : Sérialiser `workflows` + amorcer le suivi**

Dans `serializeSession()` (~l.489), après le calcul de `subagents` et avant le calcul de `state`, ajouter :

```js
  // Workflows actifs (badge agrégé). Les agents de workflow tournent dans une
  // task background : ils ne comptent PAS dans hasBlockingForegroundAgent et
  // ne mutent pas l'état du parent.
  const workflows = (sessionDir ? subagentTracker.workflowsForSession(sessionDir) : [])
    .filter(wf => wf.status === 'running')
    .map(wf => ({ runId: wf.runId, name: wf.name, started: wf.started, done: wf.done, running: wf.running }));
  if (workflows.length) {
    workflowActive.set(session.sessionId, new Set(workflows.map(w => w.runId)));
  }
```

Et dans l'objet retourné, après `subagents,` :

```js
    workflows,
```

- [ ] **Step 3 : Démarrer le tick**

À la fin de `setupWatcher()` (~l.212), après `watcher.start();` :

```js
  setInterval(workflowTick, WORKFLOW_TICK_MS);
```

- [ ] **Step 4 : Vérification statique + suites**

Run : `node -e "require('./subagents'); console.log('subagents ok')" && npm test`
Expected : tout passe. (`main.js` ne se require pas hors Electron — la vérification runtime se fait en Task 4.)

- [ ] **Step 5 : Commit**

```bash
git add main.js
git commit -m "feat(main): suivi live des workflows + notification de fin de run"
```

---

### Task 3 : Badge UI + toast + i18n + styles

**Files:**
- Modify: `ui/renderer.js` (subagentsBlockHTML ~l.803, showToast ~l.1162)
- Modify: `ui/styles.css` (après le bloc `.subagent-*` ~l.2166)
- Modify: `i18n.js` (sections fr et en)

- [ ] **Step 1 : Clés i18n**

Dans `i18n.js`, section `fr` (après `state_error` / `background_section`, ~l.13) :

```js
      workflow_progress: '{running} agent{s} actif{s} ({done}/{started})',
      workflow_done: 'terminé',
      workflow_agents: '{n} agent{s}',
```

Section `en` (même position relative, ~l.157) :

```js
      workflow_progress: '{running} agent{s} active ({done}/{started})',
      workflow_done: 'done',
      workflow_agents: '{n} agent{s}',
```

(Le `{s}` est pluralisé par `t()` via `params.n` — passer `n: running` / `n: agentCount`.)

- [ ] **Step 2 : Badge dans `ui/renderer.js`**

Remplacer `subagentsBlockHTML` (~l.803) et ajouter `workflowRowHTML` juste avant :

```js
function workflowRowHTML(wf) {
  const progress = t('workflow_progress', {
    running: wf.running, done: wf.done, started: wf.started, n: wf.running,
  });
  return `
    <div class="workflow-row" data-run="${escAttr(wf.runId)}">
      <span class="subagent-spinner workflow-spinner"></span>
      <span class="workflow-name" title="${escAttr(wf.name)}">⚡ ${esc(wf.name)}</span>
      <span class="workflow-progress">${esc(progress)}</span>
    </div>
  `;
}

// Bloc commun aux 3 vues : badges workflows (agrégés) au-dessus des rows
// subagents. Le header ne compte que les subagents directs — les agents d'un
// workflow sont résumés par leur badge.
function subagentsBlockHTML(s) {
  const workflows = s.workflows || [];
  const subs = s.subagents || [];
  if (workflows.length === 0 && subs.length === 0) return '';
  const wfRows = workflows.map(workflowRowHTML).join('');
  const count = subs.length;
  const label = count === 1 ? 'sous-agent' : 'sous-agents';
  const header = count ? `<div class="subagents-header">${count} ${label} en cours</div>` : '';
  const rows = subs.map(subagentRowHTML).join('');
  return `
    <div class="subagents-block" data-count="${count}">
      ${wfRows}
      ${header}
      ${rows}
    </div>
  `;
}
```

(Aucun changement aux 3 call sites — `cardHTML` l.868, `microItemHTML` l.902, `compactItemHTML` l.954 appellent déjà `subagentsBlockHTML(s)`.)

- [ ] **Step 3 : Toast `workflow-done` dans `showToast`**

Dans `showToast` (~l.1162), remplacer les deux premières lignes :

```js
  const kind = data.kind === 'pending' ? 'pending' : 'waiting';
  const stateLabel = kind === 'pending' ? t('state_pending') : t('state_waiting');
```

par :

```js
  const kind = data.kind === 'pending' ? 'pending'
    : data.kind === 'workflow-done' ? 'workflow-done'
    : 'waiting';
  const stateLabel = kind === 'pending' ? t('state_pending')
    : kind === 'workflow-done' ? workflowDoneLabel(data)
    : t('state_waiting');
```

Et ajouter juste au-dessus de `showToast` :

```js
// « ⚡ deep-research terminé — 103 agents, 6 min ». Retour pré-échappé : il est
// injecté tel quel dans le innerHTML du toast.
function workflowDoneLabel(data) {
  const parts = [];
  if (data.agentCount) parts.push(t('workflow_agents', { n: data.agentCount }));
  if (data.durationMs) parts.push(`${Math.max(1, Math.round(data.durationMs / 60000))} min`);
  const suffix = parts.length ? ` — ${parts.join(', ')}` : '';
  return `⚡ ${esc(data.workflowName || '')} ${t('workflow_done')}${esc(suffix)}`;
}
```

- [ ] **Step 4 : Styles**

Dans `ui/styles.css`, après `.subagent-desc` (~l.2166), ajouter :

```css
/* Workflow badge — une ligne agrégée par run multi-agents, accent violet
   (thinking) pour le distinguer des subagents directs (bleu running) */
.workflow-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: color-mix(in srgb, var(--state-thinking) 8%, transparent);
  border-left: 2px solid var(--state-thinking);
  border-radius: 3px;
  font-size: 11px;
  overflow: hidden;
}
.workflow-spinner {
  border-color: color-mix(in srgb, var(--state-thinking) 35%, transparent);
  border-top-color: var(--state-thinking);
}
.workflow-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  min-width: 0;
}
.workflow-progress {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.compact-card .workflow-row {
  padding: 3px 6px;
  font-size: 10px;
  gap: 6px;
}
.notification-toast[data-kind="workflow-done"] {
  border-left-color: var(--state-thinking);
}
```

(Vérifier en l'écrivant que le pattern `border-left-color` correspond à ce que fait `.notification-toast[data-kind="pending"]` l.1141 — sinon copier la même propriété qu'utilise le kind pending avec `var(--state-thinking)`.)

- [ ] **Step 5 : Vérification syntaxe + suites**

Run : `node --check ui/renderer.js && node --check i18n.js && npm test`
Expected : pas d'erreur de syntaxe, suites vertes.

- [ ] **Step 6 : Commit**

```bash
git add ui/renderer.js ui/styles.css i18n.js
git commit -m "feat(ui): badge workflow agrégé + toast de fin de run"
```

---

### Task 4 : Vérification manuelle de bout en bout

**Files:** aucun (validation)

- [ ] **Step 1 : Fixture de workflow factice**

Identifier une session active dans `~/.claude/sessions/*.json` (champ `sessionId` + en déduire `<projectDir>` via le JSONL connu du watcher), puis créer une fixture dans son sessionDir :

```bash
# Adapter SESSION_DIR à une vraie session visible dans le watcher
SESSION_DIR=~/.claude/projects/<projectSlug>/<sessionId>
mkdir -p "$SESSION_DIR/subagents/workflows/wf_test12-345" "$SESSION_DIR/workflows/scripts"
printf '%s\n%s\n%s\n' \
  '{"type":"started","agentId":"t1","key":"k1"}' \
  '{"type":"started","agentId":"t2","key":"k2"}' \
  '{"type":"result","agentId":"t1","key":"k1"}' \
  > "$SESSION_DIR/subagents/workflows/wf_test12-345/journal.jsonl"
touch "$SESSION_DIR/workflows/scripts/demo-research-wf_test12-345.js"
```

- [ ] **Step 2 : Lancer l'app et vérifier le badge**

Rappel mémoire projet : tuer l'instance Electron existante d'abord (single-instance lock), pas de devtools par défaut.

Run : `pkill -f "aby-claude-watcher" ; npm start`
Expected : la session affiche un badge violet `⚡ demo-research — 1 agent actif (1/2)` dans les 2 s (tick), dans les vues grid et compact. Vérifier dans `~/Library/Logs/aby-claude-watcher/main.log` qu'aucune erreur ne sort.

- [ ] **Step 3 : Simuler la fin de run et vérifier la notif**

```bash
printf '%s\n' '{"type":"result","agentId":"t2","key":"k2"}' \
  >> "$SESSION_DIR/subagents/workflows/wf_test12-345/journal.jsonl"
cat > "$SESSION_DIR/workflows/wf_test12-345.json" <<'EOF'
{"runId":"wf_test12-345","status":"completed","workflowName":"demo-research","agentCount":2,"durationMs":120000}
EOF
```

Expected : dans les 2 s, toast « ⚡ demo-research terminé — 2 agents, 2 min » (bordure violette), badge disparu, ligne `[workflow] wf_test12-345 (demo-research) completed` dans main.log. Le toast n'apparaît qu'UNE fois (one-shot).

- [ ] **Step 4 : Nettoyer la fixture**

```bash
rm -rf "$SESSION_DIR/subagents/workflows/wf_test12-345" \
       "$SESSION_DIR/workflows/wf_test12-345.json" \
       "$SESSION_DIR/workflows/scripts/demo-research-wf_test12-345.js"
```

Expected : badge absent au tick suivant, aucune erreur de scan dans main.log.

- [ ] **Step 5 : Commit final (si retouches)**

Si les étapes 2-3 ont nécessité des corrections, les committer :

```bash
git add -p
git commit -m "fix(workflows): ajustements après vérification manuelle"
```

---

## Couverture spec → tasks

| Exigence spec | Task |
|---|---|
| §1 Scanner (journal, nom, état, cache terminal, stale) | 1 |
| §2 Sérialisation `workflows`, pas d'impact blocking | 2 |
| §3 Tick 2 s + amorçage session-added/updated | 2 (l'amorçage passe par serializeSession, appelée par les deux events) |
| §4 Notif one-shot, pas de notif rétroactive ni stale | 2 |
| §5 Badge 3 vues + style | 3 |
| Cas limites (journal tronqué, état tronqué, fallback nom, stale, multi-runs) | 1 (tests) |
| Rappel build.files | aucun nouveau module runtime → rien à faire (vérifié Task 1 Step 5) |
