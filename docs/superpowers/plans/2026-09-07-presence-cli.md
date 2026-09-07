# Présence CLI (status de session.json) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire du `status` / `waitingFor` que Claude Code écrit dans `~/.claude/sessions/<pid>.json` l'autorité de l'état gros grain (waiting / pending / running), en gardant le JSONL pour thinking/running et les métadonnées, et masquer les lignes parasites (`parkedJobId`, `spare`, `kind` non interactif).

**Architecture:** Un module pur `presence.js` (lecture + décision, sans effet) ; `scan()` dans `watcher.js` applique la décision à chaque passage (2 s) via `setState`, avec deux gardes dans la machine JSONL (end_turn ignoré si le CLI dit `busy`, notif mutée si `busy`/`shell`/dialogue ouvert) ; `main.js` et le renderer exposent `dialogOpen`, `waitingFor`, et comptent la présence `busy` comme délégation.

**Tech Stack:** Node/Electron main process (CommonJS), tests maison `node test/*.test.js` (runner à queue dans `test/watcher.test.js`), aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-09-07-presence-cli-design.md`

## Global Constraints

- CLI sans champ `status` valide (`busy` | `shell` | `idle` | `waiting`) ou sans `statusUpdatedAt` numérique → **aucun** changement de comportement ; les tests existants doivent rester verts sans modification.
- Jamais de `Date.now()` pour dater une transition venue de la présence : `at = statusUpdatedAt`.
- Une présence antérieure au démarrage du watcher est appliquée en silence (`isInitial = true`) : aucune notif rétroactive.
- `waitingFor === 'dialog open'` ne passe JAMAIS en pending ni ne notifie.
- `SCAN_INTERVAL` reste à 2000 ms.
- Commits signés Paul uniquement (pas de trailer `Co-Authored-By`), pas de `git push`.
- Textes UI en fr ET en dans `i18n.js` (deux blocs, lignes ~16 et ~183).
- Le tableau du volet A de la spec est le contrat de `presenceDecision` ; toute divergence est un bug.

---

### Task 1: Module pur `presence.js` + tests

**Files:**
- Create: `presence.js`
- Create: `test/presence.test.js`
- Modify: `package.json:13` (script `test`)

**Interfaces:**
- Produces:
  - `readPresence(data: object) → { status, waitingFor: string|undefined, statusUpdatedAt: number } | null`
  - `presenceDecision({ presence, currentState: string, stateSince: number|null, watcherStartedAt: number }) → { target: 'waiting'|'pending'|'running'|null, trigger: string|null, at: number, silent: boolean, mute: boolean, shell: boolean, dialogOpen: boolean, waitingFor: string|null }`
  - constantes `PRESENCE_STATUSES`, `DIALOG_OPEN`

- [ ] **Step 1: Écrire les tests (ils échouent : module absent)**

```js
// test/presence.test.js
// Module pur : lecture de la présence CLI (session.json) + décision d'état.
// Run via `node test/presence.test.js`.
const assert = require('assert');
const { readPresence, presenceDecision, DIALOG_OPEN } = require('../presence');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nreadPresence:');
test('status valide + statusUpdatedAt numérique → objet', () => {
  const p = readPresence({ status: 'idle', statusUpdatedAt: 1000, waitingFor: undefined });
  assert.deepStrictEqual(p, { status: 'idle', waitingFor: undefined, statusUpdatedAt: 1000 });
});
test('waitingFor string conservé', () => {
  const p = readPresence({ status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: 5 });
  assert.strictEqual(p.waitingFor, 'permission prompt');
});
test('waitingFor non string → undefined', () => {
  const p = readPresence({ status: 'waiting', waitingFor: 42, statusUpdatedAt: 5 });
  assert.strictEqual(p.waitingFor, undefined);
});
test('status absent → null (CLI ancien)', () => {
  assert.strictEqual(readPresence({ pid: 1, sessionId: 'x', updatedAt: 3 }), null);
});
test('status inconnu → null (jamais interprété)', () => {
  assert.strictEqual(readPresence({ status: 'compacting', statusUpdatedAt: 5 }), null);
});
test('statusUpdatedAt absent ou non numérique → null', () => {
  assert.strictEqual(readPresence({ status: 'idle' }), null);
  assert.strictEqual(readPresence({ status: 'idle', statusUpdatedAt: '5' }), null);
});
test('data non objet → null', () => {
  assert.strictEqual(readPresence(null), null);
  assert.strictEqual(readPresence('x'), null);
});

console.log('\npresenceDecision:');
const T0 = 1_000_000; // démarrage du watcher
const later = T0 + 10_000;
const earlier = T0 - 10_000;
function decide(status, currentState, extra = {}) {
  const { waitingFor, statusUpdatedAt = later, stateSince = null, watcherStartedAt = T0 } = extra;
  return presenceDecision({
    presence: { status, waitingFor, statusUpdatedAt },
    currentState, stateSince, watcherStartedAt,
  });
}

// idle
test('idle sur thinking/running/pending → waiting, trigger presence:idle', () => {
  for (const s of ['thinking', 'running', 'pending']) {
    const d = decide('idle', s);
    assert.strictEqual(d.target, 'waiting', s);
    assert.strictEqual(d.trigger, 'presence:idle');
    assert.strictEqual(d.mute, false);
  }
});
test('idle sur waiting → no-op, pas de mute', () => {
  const d = decide('idle', 'waiting');
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.mute, false);
  assert.strictEqual(d.shell, false);
  assert.strictEqual(d.dialogOpen, false);
});

// shell
test('shell sur running → waiting + shell + mute', () => {
  const d = decide('shell', 'running');
  assert.strictEqual(d.target, 'waiting');
  assert.strictEqual(d.trigger, 'presence:shell');
  assert.strictEqual(d.shell, true);
  assert.strictEqual(d.mute, true);
});
test('shell sur waiting → no-op + shell + mute', () => {
  const d = decide('shell', 'waiting');
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.shell, true);
  assert.strictEqual(d.mute, true);
});

// waiting (dialogue bloquant)
test('waiting/permission prompt sur running → pending + waitingFor', () => {
  const d = decide('waiting', 'running', { waitingFor: 'permission prompt' });
  assert.strictEqual(d.target, 'pending');
  assert.strictEqual(d.trigger, 'presence:waiting');
  assert.strictEqual(d.waitingFor, 'permission prompt');
  assert.strictEqual(d.mute, false);
});
test('waiting/input needed sur waiting → pending', () => {
  assert.strictEqual(decide('waiting', 'waiting', { waitingFor: 'input needed' }).target, 'pending');
});
test('waiting sans waitingFor → pending quand même (valeur par défaut CLI = permission prompt)', () => {
  const d = decide('waiting', 'running');
  assert.strictEqual(d.target, 'pending');
  assert.strictEqual(d.waitingFor, null);
});
test('waiting sur pending → no-op mais waitingFor rafraîchi', () => {
  const d = decide('waiting', 'pending', { waitingFor: 'sandbox request' });
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.waitingFor, 'sandbox request');
});

// waiting / dialog open
test('dialog open sur running → waiting + dialogOpen + mute, jamais pending', () => {
  const d = decide('waiting', 'running', { waitingFor: DIALOG_OPEN });
  assert.strictEqual(d.target, 'waiting');
  assert.strictEqual(d.trigger, 'presence:dialog');
  assert.strictEqual(d.dialogOpen, true);
  assert.strictEqual(d.mute, true);
});
test('dialog open sur pending → waiting (le prompt a laissé place à un menu)', () => {
  assert.strictEqual(decide('waiting', 'pending', { waitingFor: DIALOG_OPEN }).target, 'waiting');
});
test('dialog open sur waiting → no-op + dialogOpen + mute', () => {
  const d = decide('waiting', 'waiting', { waitingFor: DIALOG_OPEN });
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.dialogOpen, true);
  assert.strictEqual(d.mute, true);
});

// busy
test('busy sur pending → running (question traitée)', () => {
  const d = decide('busy', 'pending', { stateSince: T0 + 5_000 });
  assert.strictEqual(d.target, 'running');
  assert.strictEqual(d.trigger, 'presence:busy');
});
test('busy sur waiting → no-op + mute (délégation)', () => {
  const d = decide('busy', 'waiting');
  assert.strictEqual(d.target, null);
  assert.strictEqual(d.mute, true);
});
test('busy sur thinking/running → no-op sans mute', () => {
  for (const s of ['thinking', 'running']) {
    const d = decide('busy', s);
    assert.strictEqual(d.target, null, s);
    assert.strictEqual(d.mute, false, s);
  }
});

// garde d'ordre temporel
test('busy ANTÉRIEUR à un pending posé par le hook → ignoré', () => {
  const d = decide('busy', 'pending', { statusUpdatedAt: T0 + 1_000, stateSince: T0 + 2_000 });
  assert.strictEqual(d.target, null);
});
test('idle ANTÉRIEUR à un pending → ignoré aussi', () => {
  const d = decide('idle', 'pending', { statusUpdatedAt: T0 + 1_000, stateSince: T0 + 2_000 });
  assert.strictEqual(d.target, null);
});
test('garde inactive si stateSince null', () => {
  const d = decide('busy', 'pending', { statusUpdatedAt: T0 + 1_000, stateSince: null });
  assert.strictEqual(d.target, 'running');
});
test('garde inactive hors pending : idle antérieur sur running → waiting', () => {
  const d = decide('idle', 'running', { statusUpdatedAt: T0 + 1_000, stateSince: T0 + 2_000 });
  assert.strictEqual(d.target, 'waiting');
});

// at / silent
test('at = statusUpdatedAt, jamais Date.now()', () => {
  assert.strictEqual(decide('idle', 'running', { statusUpdatedAt: 4242 }).at, 4242);
});
test('silent quand statusUpdatedAt < watcherStartedAt', () => {
  assert.strictEqual(decide('idle', 'running', { statusUpdatedAt: earlier }).silent, true);
  assert.strictEqual(decide('idle', 'running', { statusUpdatedAt: later }).silent, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `node test/presence.test.js`
Expected: `Error: Cannot find module '../presence'`

- [ ] **Step 3: Écrire `presence.js`**

```js
// presence.js — Présence de session publiée par Claude Code.
//
// Depuis ~2.1.260 le CLI réécrit ~/.claude/sessions/<pid>.json à chaque rendu
// avec `status` (busy | shell | idle | waiting), `waitingFor` (libellé du
// dialogue bloquant) et `statusUpdatedAt`. Dérivation côté CLI, vérifiée dans
// le binaire 2.1.263 :
//   waiting : un dialogue bloque (waitingFor = "permission prompt" par défaut,
//             "input needed", "sandbox request", "worker request",
//             "goal proposal", "dialog open" = menu /model, /config…)
//   busy    : isLoading || delegatedActive (tour en cours OU agents/teammates/
//             workflows/monitors actifs)
//   shell   : idle mais une tâche Bash de fond (local_bash) tourne encore
//   idle    : rien de tout ça
// Ce module est PUR : lecture + décision, aucun effet. Spec :
// docs/superpowers/specs/2026-09-07-presence-cli-design.md (volet A).

const PRESENCE_STATUSES = ['busy', 'shell', 'idle', 'waiting'];
const DIALOG_OPEN = 'dialog open';

// session.json brut → présence exploitable, ou null (CLI ancien, status inconnu,
// statusUpdatedAt absent). Un status inconnu n'est JAMAIS interprété : mieux
// vaut retomber sur la machine JSONL que deviner.
function readPresence(data) {
  if (!data || typeof data !== 'object') return null;
  if (!PRESENCE_STATUSES.includes(data.status)) return null;
  if (typeof data.statusUpdatedAt !== 'number' || !Number.isFinite(data.statusUpdatedAt)) return null;
  return {
    status: data.status,
    waitingFor: typeof data.waitingFor === 'string' ? data.waitingFor : undefined,
    statusUpdatedAt: data.statusUpdatedAt,
  };
}

// Que faire de cette présence pour une session dans `currentState` ?
//   target     : état cible ('waiting' | 'pending' | 'running') ou null (no-op)
//   trigger    : libellé pour main.log
//   at         : date de la transition = statusUpdatedAt (jamais Date.now())
//   silent     : transition antérieure au démarrage du watcher → pas de notif
//   mute       : la notif « Inactif » doit rester muette dans cet état
//   shell      : une tâche Bash de fond tourne (chip « bg process »)
//   dialogOpen : menu/dialogue local ouvert (chip « Dialogue ouvert », vert)
//   waitingFor : libellé brut du dialogue bloquant (tooltip), sinon null
function presenceDecision({ presence, currentState, stateSince, watcherStartedAt }) {
  const base = {
    target: null,
    trigger: null,
    at: presence.statusUpdatedAt,
    silent: presence.statusUpdatedAt < watcherStartedAt,
    mute: false,
    shell: false,
    dialogOpen: false,
    waitingFor: null,
  };
  // Garde d'ordre : un pending posé par le hook APRÈS l'écriture de cette
  // présence ne doit pas être dégradé par elle (course hook → scan).
  if (currentState === 'pending' && typeof stateSince === 'number'
      && presence.statusUpdatedAt < stateSince) {
    return base;
  }

  switch (presence.status) {
    case 'idle':
      if (currentState !== 'waiting') return { ...base, target: 'waiting', trigger: 'presence:idle' };
      return base;
    case 'shell':
      if (currentState !== 'waiting') return { ...base, target: 'waiting', trigger: 'presence:shell', shell: true, mute: true };
      return { ...base, shell: true, mute: true };
    case 'waiting':
      if (presence.waitingFor === DIALOG_OPEN) {
        if (currentState !== 'waiting') return { ...base, target: 'waiting', trigger: 'presence:dialog', dialogOpen: true, mute: true };
        return { ...base, dialogOpen: true, mute: true };
      }
      if (currentState !== 'pending') {
        return { ...base, target: 'pending', trigger: 'presence:waiting', waitingFor: presence.waitingFor || null };
      }
      return { ...base, waitingFor: presence.waitingFor || null };
    case 'busy':
      if (currentState === 'pending') return { ...base, target: 'running', trigger: 'presence:busy' };
      if (currentState === 'waiting') return { ...base, mute: true };
      return base; // thinking / running : le JSONL raffine déjà
    default:
      return base;
  }
}

module.exports = { readPresence, presenceDecision, PRESENCE_STATUSES, DIALOG_OPEN };
```

- [ ] **Step 4: Lancer les tests**

Run: `node test/presence.test.js`
Expected: toutes les lignes `✓`, `0 failed`.

- [ ] **Step 5: Brancher dans `npm test`**

Dans `package.json`, à la fin de la chaîne du script `test`, ajouter ` && node test/presence.test.js`.

Run: `npm test`
Expected: tout vert, la dernière ligne vient de presence.test.js.

- [ ] **Step 6: Commit**

```bash
git add presence.js test/presence.test.js package.json
git commit -m "feat(presence): module pur de lecture/décision de la présence CLI"
```

---

### Task 2: `scan()` — `spare`, `parkedJobId`, `kind` (volet D)

**Files:**
- Modify: `watcher.js:250-262` (tête de la boucle `for (const data of liveSessions)`)
- Test: `test/watcher.test.js` (section « scan() integration »)

**Interfaces:**
- Consumes: rien de Task 1.
- Produces: `session.isBackground` tient compte de `kind` ; les lignes `spare`/`parkedJobId` ne créent jamais de session.

- [ ] **Step 1: Ajouter un helper de test et les tests (échec attendu)**

Dans `test/watcher.test.js`, juste après `writeSessionJson` (ligne ~362), ajouter :

```js
// Variante libre : écrit exactement `data` (présence, kind, parkedJobId…).
function writeSessionJsonRaw(sessionsDir, data) {
  fs.writeFileSync(path.join(sessionsDir, `${data.pid}.json`), JSON.stringify(data));
}
```

À la fin de la section « scan() integration » (avant `runAll()`), ajouter :

```js
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
```

Vérifier que `removeSession` émet bien `session-removed` (`grep -n "session-removed" watcher.js`) ; si l'event porte un objet plutôt qu'un id, adapter le test — l'assertion utile est `!w.sessions.has('park-1')`.

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `node test/watcher.test.js 2>&1 | tail -12`
Expected: les 3 nouveaux tests en `✗` (spare tracké, park-1 encore présent, bg-1 non background).

- [ ] **Step 3: Implémenter dans `scan()`**

Dans `watcher.js`, remplacer le bloc de tête de la boucle :

```js
          const { pid, sessionId, cwd, startedAt, entrypoint } = data;

          if (!sessionId) continue;

          // Headless (`claude -p`, SDK, …) write entrypoint "sdk-cli"; interactive
          // terminals write "cli". Unknown future entrypoints default to background
          // (read-only + silent is the safe degradation). Absent field = old Claude
          // Code version → keep the historical interactive behavior.
          const isBackground = !!entrypoint && entrypoint !== 'cli';
```

par :

```js
          const { pid, sessionId, cwd, startedAt, entrypoint, kind } = data;

          if (!sessionId) continue;

          // Worker pré-chauffé par l'agent view (`claude agents`) : PID vivant,
          // aucun JSONL, jamais d'activité — une carte fantôme que la purge
          // « fichier disparu + PID mort » ne retirerait pas.
          if (data.spare === true) continue;

          // Session passée en arrière-plan (Ctrl+B, /background, --bg) : le CLI
          // crée une COPIE sous un autre sid et laisse l'original « stalled »
          // avec parkedJobId, PID vivant. `claude agents` masque ces lignes ;
          // sans ça la carte resterait figée sur le dernier état pour toujours.
          if (data.parkedJobId !== undefined && data.parkedJobId !== null) {
            for (const [id, s] of this.sessions) {
              if (s.pid === pid && s.cwd === cwd) {
                log.info(`[watcher] parked ${id.slice(0, 8)} masqué (job ${String(data.parkedJobId).slice(0, 12)})`);
                this.removeSession(id);
                break;
              }
            }
            continue;
          }

          // Headless : `kind` (interactive | bg | daemon | daemon-worker) quand le
          // CLI l'écrit, sinon la règle historique sur `entrypoint` ("cli" =
          // terminal interactif, tout le reste = headless). Champ absent = CLI
          // ancien → comportement historique.
          const isBackground = (!!kind && kind !== 'interactive')
            || (!!entrypoint && entrypoint !== 'cli');
```

- [ ] **Step 4: Lancer les tests**

Run: `node test/watcher.test.js 2>&1 | tail -12`
Expected: les 3 tests en `✓`, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "fix(scan): masque les workers spare et le jumeau parked, kind bg/daemon → headless"
```

---

### Task 3: `scan()` — application de la présence (volet B)

**Files:**
- Modify: `watcher.js` (constructeur ~122-133, `start()` ~134, boucle `scan()` branches découverte ~319-352 et trackée ~353-380, exports ligne 1428)
- Test: `test/watcher.test.js`

**Interfaces:**
- Consumes: `readPresence`, `presenceDecision` (Task 1).
- Produces: sur chaque session trackée : `presence` (objet | null), `shellBusy`, `dialogOpen`, `waitingFor`, `presenceMuted` ; `this.startedAt` sur le watcher ; méthode `applyPresence(sessionId, data)`.

- [ ] **Step 1: Tests (échec attendu)**

Dans `test/watcher.test.js`, en tête, ajouter à l'import : rien (on passe par `w.sessions`). Ajouter à la fin de la section scan :

```js
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
```

Note : `writeSessionJson` (helper existant) écrit `status: 'busy'` SANS `statusUpdatedAt` → `readPresence` renvoie null, ce qui garantit que les tests scan existants ne sont pas affectés.

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `node test/watcher.test.js 2>&1 | tail -15`
Expected: les 6 nouveaux tests en `✗`.

- [ ] **Step 3: Implémenter**

(a) En tête de `watcher.js`, après `const log = …` / les requires existants :

```js
const { readPresence, presenceDecision } = require('./presence');
```

(b) Constructeur : ajouter `this.startedAt = Date.now();` (les tests l'écrasent). Dans `start()`, première ligne du corps : `this.startedAt = Date.now();`.

(c) Nouvelle méthode, à placer juste avant `setState` :

```js
  // Applique la présence publiée par le CLI (session.json) — l'autorité sur
  // l'état gros grain quand elle existe. Décision pure dans presence.js ;
  // ici les effets : flags de carte, transition via setState, bannière
  // tardive quand un mute (shell / dialogue / délégation) se lève.
  applyPresence(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const presence = readPresence(data);
    session.presence = presence;
    if (!presence) {
      // CLI ancien : aucun flag ne doit rester d'une version précédente.
      if (session.shellBusy || session.dialogOpen || session.waitingFor) {
        session.shellBusy = false; session.dialogOpen = false; session.waitingFor = null;
        this.emit('session-updated', session);
      }
      return;
    }
    const decision = presenceDecision({
      presence,
      currentState: session.state.name,
      stateSince: session.stateSince ?? null,
      watcherStartedAt: this.startedAt,
    });
    const flagsChanged = session.shellBusy !== decision.shell
      || session.dialogOpen !== decision.dialogOpen
      || (session.waitingFor || null) !== decision.waitingFor;
    // Flags AVANT setState : le mute de notif les lit.
    session.shellBusy = decision.shell;
    session.dialogOpen = decision.dialogOpen;
    session.waitingFor = decision.waitingFor;

    if (decision.target) {
      const target = Object.values(STATES).find(s => s.name === decision.target);
      this.clearWaitingTimer(sessionId);
      this.clearPendingTimer(sessionId);
      this.setState(sessionId, target, decision.silent, decision.trigger, decision.at);
    } else if (flagsChanged) {
      // Rien dans le JSONL ne dira qu'un menu s'est ouvert ou qu'un shell
      // s'est terminé : on émet nous-mêmes (même raison que sessionName).
      this.emit('session-updated', session);
    }

    // Levée de mute : la session est redevenue vraiment inactive alors qu'une
    // notif « Inactif » avait été tue (shell / dialogue / délégation) →
    // bannière tardive, une seule fois (même logique que purgeStaleBgTasks).
    if (presence.status === 'idle') {
      if (session.presenceMuted && session.state.name === 'waiting' && !decision.target && !decision.silent) {
        log.info(`[notif] ${sessionId.slice(0, 8)} mute levé (presence idle)`);
        this.maybeNotifyWaiting(sessionId, session);
      }
      session.presenceMuted = false;
    }
  }
```

(d) Dans `scan()`, branche découverte : après `this.watchJsonl(effectiveId);` et AVANT `this.persistSession(...)`, ajouter :

```js
            this.applyPresence(effectiveId, data);
```

et dans l'objet créé par `this.sessions.set(effectiveId, { … })`, ajouter les champs :

```js
              presence: null,
              shellBusy: false,
              dialogOpen: false,
              waitingFor: null,
              presenceMuted: false,
```

Branche trackée : après le bloc `if (pidAlive && session.state === STATES.ERROR) { … }`, ajouter :

```js
            if (pidAlive) this.applyPresence(effectiveId, data);
```

(e) Dans `start()`, la restauration depuis `config.sessions` construit des objets session : y ajouter les mêmes 5 champs (`presence: null, shellBusy: false, dialogOpen: false, waitingFor: null, presenceMuted: false`) pour que le shape soit uniforme. Repérer l'objet avec `grep -n "agentDispatches: new Map()" watcher.js` (il y a deux occurrences : découverte et restauration).

(f) Le mute côté `setState` (nécessaire pour le test shell) : remplacer

```js
      if (newState.name === 'waiting' && this.hasOpenBgTask(sessionId)) {
        log.info(`[notif] ${sessionId.slice(0, 8)} muet (bg process ouvert)`);
      } else {
```

par

```js
      const muteReason = newState.name !== 'waiting' ? null
        : this.hasOpenBgTask(sessionId) ? 'bg process ouvert'
        : session.shellBusy ? 'presence shell'
        : session.dialogOpen ? 'presence dialog open'
        : (session.presence && session.presence.status === 'busy') ? 'presence busy'
        : null;
      if (muteReason) {
        log.info(`[notif] ${sessionId.slice(0, 8)} muet (${muteReason})`);
        if (muteReason.startsWith('presence')) session.presenceMuted = true;
      } else {
```

- [ ] **Step 4: Lancer les tests**

Run: `node test/watcher.test.js 2>&1 | tail -15 && node test/presence.test.js | tail -1`
Expected: tout `✓`, `0 failed` dans les deux.

Si le test « bannière tardive » échoue sur la 2e notif : vérifier que `presenceMuted` est bien remis à `false` dans la branche `idle` de `applyPresence` et que `w.lastNotifTime.delete` est bien appelé avant le 2e scan dans le test (le cooldown 30 s masquerait sinon le bug inverse).

- [ ] **Step 5: `npm test` complet**

Run: `npm test 2>&1 | grep -E "passed|failed" `
Expected: chaque fichier `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "feat(presence): status de session.json appliqué dans scan() (autorité d'état)"
```

---

### Task 4: Garde JSONL — `end_turn` ignoré quand le CLI dit `busy` (volet C)

**Files:**
- Modify: `watcher.js:1092-1110` (`startWaitingTimer`)
- Test: `test/watcher.test.js`

**Interfaces:**
- Consumes: `session.presence` (Task 3).
- Produces: rien de nouveau.

- [ ] **Step 1: Test (échec attendu)**

Ajouter dans la section « présence CLI » :

```js
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
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `node test/watcher.test.js 2>&1 | grep -E "end_turn JSONL"`
Expected: le premier en `✗`, le second en `✓`.

- [ ] **Step 3: Implémenter**

Dans `startWaitingTimer`, remplacer le corps du `setTimeout` :

```js
    const timer = setTimeout(() => {
      // Le CLI dit busy alors que le JSONL a vu end_turn : des délégués
      // (agents en arrière-plan, teammates, workflow) travaillent encore et
      // réveilleront la session. On reste running ; la présence idle fera
      // la transition (applyPresence). Sans présence : chemin historique.
      const s = this.sessions.get(sessionId);
      if (s && s.presence && s.presence.status === 'busy') {
        log.info(`[state] ${sessionId.slice(0, 8)} end_turn ignoré (presence busy)`);
        return;
      }
      // Le trigger distingue dans main.log un tour vraiment fini d'un tour
      // suspendu à une tâche de fond (même état waiting, notif mutée).
      this.setState(sessionId, STATES.WAITING, false,
        this.hasOpenBgTask(sessionId) ? 'end_turn-bg-open' : 'end_turn-idle');
    }, WAITING_DELAY);
```

- [ ] **Step 4: Lancer les tests**

Run: `npm test 2>&1 | grep -E "passed|failed"`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "fix(state): end_turn ignoré tant que le CLI se dit busy (délégation en arrière-plan)"
```

---

### Task 5: Surfaces — main.js, renderer, i18n, CSS (volet E)

**Files:**
- Modify: `main.js:47-63` (`delegatingNow` / `effectiveStateName`), `main.js:~775-812` (`serializeSession`)
- Modify: `ui/renderer.js:920-945` (tooltip badge, chips), `ui/renderer.js:1023-1026` et `1131-1134` (cartes grid et compact)
- Modify: `i18n.js:16` et `i18n.js:183` (clés fr/en)
- Modify: `ui/styles.css:777` (après `.compact-card-row .bg-chip`)

**Interfaces:**
- Consumes: `session.presence`, `session.shellBusy`, `session.dialogOpen`, `session.waitingFor` (Task 3).
- Produces: `serializeSession` expose `bgTaskCount` (présence incluse), `dialogOpen`, `waitingFor`.

- [ ] **Step 1: main.js — délégation par présence**

Remplacer `delegatingNow` :

```js
function delegatingNow(session) {
  // Le CLI compte lui-même ses délégués (agents locaux ET distants, teammates
  // in-process, workflows, monitors) dans son status busy : quand il le dit
  // alors que le JSONL a vu la fin du tour, c'est une délégation, même si
  // aucune ligne d'agent n'est visible dans <session>/subagents/.
  if (session.presence && session.presence.status === 'busy') return true;
  const dir = sessionDirFor(session);
  if (!dir) return false;
  return hasLiveDelegation(
    subagentTracker.snapshotForSession(dir, session.agentDispatches || new Map()),
    subagentTracker.workflowsForSession(dir)
  );
}
```

Dans `serializeSession`, remplacer :

```js
  } else if (state.name === 'waiting' && hasLiveDelegation(subagents, workflows)) {
```

par :

```js
  } else if (state.name === 'waiting'
      && ((session.presence && session.presence.status === 'busy') || hasLiveDelegation(subagents, workflows))) {
```

et dans l'objet retourné, remplacer la ligne `bgTaskCount: …` par :

```js
    // Tâches Bash de fond : compte JSONL quand il l'a vu ; sinon la présence
    // CLI (`status: shell`) dit « au moins une » → 1.
    bgTaskCount: (session.bgTasks && session.bgTasks.size) || (session.shellBusy ? 1 : 0),
    // Présence CLI : menu/dialogue local ouvert (chip vert, pas d'action) et
    // libellé brut du dialogue bloquant (tooltip du badge pending).
    dialogOpen: !!session.dialogOpen,
    waitingFor: session.waitingFor || null,
```

- [ ] **Step 2: i18n**

`i18n.js` ligne 16 (bloc fr), après `bg_chip` : `dialog_chip: 'Dialogue ouvert',`
`i18n.js` ligne 183 (bloc en), après `bg_chip` : `dialog_chip: 'Dialog open',`

- [ ] **Step 3: renderer — chip + tooltip**

Après `bgChipHTML` (ligne ~941), ajouter :

```js
// Chip « Dialogue ouvert » : le CLI signale un menu/dialogue local ouvert
// (/model, /config, « Session paused »…). Reste vert et muet — le plus
// souvent c'est l'utilisateur qui l'a ouvert, rien n'est requis de lui.
function dialogChipHTML(s) {
  if (!s.dialogOpen) return '';
  return `<span class="bg-chip dialog-chip">${t('dialog_chip')}</span>`;
}
```

Remplacer `stateSinceTitle` par une version qui préfixe `waitingFor` en pending :

```js
function stateSinceTitle(s) {
  const parts = [];
  if (s.state && s.state.name === 'pending' && s.waitingFor) parts.push(s.waitingFor);
  if (typeof s.stateSince === 'number') {
    const d = new Date(s.stateSince);
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const abs = (Date.now() - s.stateSince > 86_400_000)
      ? `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${time}`
      : time;
    parts.push(t('state_since_abs', { t: abs }));
  }
  if (!parts.length) return '';
  return ` title="${escAttr(parts.join(' — '))}"`;
}
```

Cartes : ligne ~1026 (grid) `</div>${bgChip}${chromeChipHTML(s)}` → `</div>${bgChip}${dialogChipHTML(s)}${chromeChipHTML(s)}` ; ligne ~1134 (compact) `${bgChipHTML(s)}${chromeChipHTML(s)}` → `${bgChipHTML(s)}${dialogChipHTML(s)}${chromeChipHTML(s)}`.

- [ ] **Step 4: CSS**

Après `.compact-card-row .bg-chip { … }` (ligne 777) :

```css
/* Chip « Dialogue ouvert » : même gabarit que bg-chip, teinte verte alignée
   sur le badge waiting — un menu ouvert n'appelle aucune action. Décliné sur
   background/color uniquement (.bg-chip n'a ni border ni box-shadow). */
.dialog-chip { background: rgba(34, 197, 94, 0.14); color: #22c55e; }
```

- [ ] **Step 5: Vérification syntaxe + tests**

Run: `node -e "require('./main.js')" 2>&1 | head -3` n'est PAS utilisable (Electron). À la place :
`node --check main.js && node --check ui/renderer.js && node --check i18n.js && npm test 2>&1 | grep -E "passed|failed"`
Expected: aucune erreur de syntaxe, tests verts.

- [ ] **Step 6: Commit**

```bash
git add main.js ui/renderer.js i18n.js ui/styles.css
git commit -m "feat(ui): chip « Dialogue ouvert », tooltip waitingFor, délégation par présence CLI"
```

---

### Task 6: Vérification live + docs (volet F)

**Files:**
- Modify: `CLAUDE.md` (tableau States + Key decisions)
- Modify: `CHANGELOG.md` (section `## [Unreleased]` en tête)

- [ ] **Step 1: Test en local sur de vraies sessions**

Run: `npm run dev` (dans un terminal séparé, laisser tourner). Dans une autre session Claude Code interactive (CLI ≥ 2.1.260) :

1. Provoquer un prompt de permission (ex. `Bash` non allowlisté) → carte ambre en ≤ 2 s, tooltip du badge = « permission prompt » ; répondre → carte bleue/verte, log `presence:busy` ou `presence:idle`.
2. Ouvrir `/model` sans choisir → chip « Dialogue ouvert », badge vert, aucune bannière ; fermer → chip disparaît.
3. Lancer une commande avec `run_in_background` puis laisser le tour finir → chip « 1 bg process », pas de bannière ; à la fin du process → bannière tardive `[notif] … mute levé (presence idle)`.
4. Lancer un sous-agent et laisser le parent rendre la main → carte « Délégation » cyan, log `end_turn ignoré (presence busy)` ; fin de l'agent → « Inactif » + bannière.
5. Quitter et relancer l'app pendant qu'un prompt de permission est affiché → carte ambre restaurée sans bannière (`presence:waiting`, `initial`).

Relire `main.log` : `grep -E "presence|mute levé|end_turn ignoré" ~/Library/Logs/aby-claude-watcher/main.log | tail -40` (adapter le chemin si `log.transports.file` pointe ailleurs : `grep -n "transports.file" main.js`). Noter tout écart dans le message final à Paul ; ne pas « corriger » sans preuve.

- [ ] **Step 2: CLAUDE.md**

Dans le tableau States, remplacer la colonne « Trigger » des lignes `waiting` et `pending` par une mention de la présence en tête : `waiting` → « `status: idle`/`shell` de session.json (CLI ≥ 2.1.260) ; sinon `end_turn` + 2s no activity » ; `pending` → « `status: waiting` (sauf `waitingFor: dialog open`) ; hook `PermissionRequest` pour l'instantanéité ». Ajouter un paragraphe « Key decisions » :

```
- **Présence CLI (v2.13.0) — `status` de `~/.claude/sessions/<pid>.json` est l'AUTORITÉ sur l'état gros grain.** Depuis ~2.1.260 le CLI réécrit ce fichier à chaque rendu : `status` = `busy` (tour en cours OU délégués actifs — agents locaux/distants, teammates in-process, workflows, monitors) | `idle` | `shell` (idle + Bash de fond ouvert) | `waiting` (dialogue bloquant, `waitingFor` = « permission prompt » par défaut, « input needed », « sandbox request », « worker request », « goal proposal », « dialog open » = menu local) ; `statusUpdatedAt` date la transition. Module pur `presence.js` (`readPresence` + `presenceDecision`, tableau de décision testé `test/presence.test.js`), appliqué par `applyPresence` à chaque `scan()`. Règles : `at = statusUpdatedAt` (jamais Date.now()) ; présence antérieure au démarrage → transition SILENCIEUSE (restaure le pending sans `pendingMarks`, conservé en fallback CLI ancien) ; garde d'ordre = une présence plus vieille qu'un pending posé par le hook ne le dégrade pas ; « dialog open » ne passe JAMAIS en pending (chip vert « Dialogue ouvert », choix Paul) ; `end_turn` JSONL ignoré tant que le CLI dit `busy` (délégation en arrière-plan, défaut depuis CLI 2.1.232) ; notif « Inactif » mutée sous `shell`/dialogue/`busy` avec bannière tardive au retour `idle` (`presenceMuted`). `delegatingNow` compte aussi `presence.status === 'busy'` (couvre les teammates in-process et agents distants invisibles dans `subagents/`). CLI sans `status` valide → comportement historique intact. `scan()` masque aussi les workers `spare` et le jumeau `parkedJobId` d'une session passée en arrière-plan (comme `claude agents`), et `kind` ≠ `interactive` vaut headless. Vérifié dans le binaire 2.1.263 (fonctions `QVe`/`sOo`, enum `["busy","shell","idle","waiting"]`).
```

Corriger aussi `/name` → `/rename` dans le paragraphe « Nom de carte ».

- [ ] **Step 3: CHANGELOG**

En tête de `CHANGELOG.md`, avant `## [2.12.1]` :

```
## [Unreleased]

### Changed
- **L'état de la carte vient désormais de Claude Code lui-même.** Le CLI
  (≥ 2.1.260) publie sa présence dans `~/.claude/sessions/<pid>.json`
  (`busy` / `idle` / `waiting` / `shell`) ; le watcher s'y fie pour
  Inactif / Action requise / bg process, et ne déduit plus ces états du
  seul journal de transcript. Conséquences : plus de pending fantôme, un
  tour rendu pendant que des agents en arrière-plan travaillent reste
  « Délégation » (ce que Claude Code fait par défaut depuis 2.1.232), et un
  prompt de permission est restauré au redémarrage sans ancre locale.
  Un CLI plus ancien garde le comportement précédent.

### Added
- Chip vert « Dialogue ouvert » quand un menu local (`/model`, `/config`…)
  est ouvert dans la session ; jamais ambre, jamais de bannière.
- Tooltip du badge « Action requise » : nature du dialogue (permission,
  elicitation MCP, sandbox, message d'une autre session…).

### Fixed
- Une session passée en arrière-plan (`Ctrl+B`, `/background`) n'affiche
  plus de carte figée pour l'original « parked » ; les workers pré-chauffés
  de `claude agents` n'apparaissent plus.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: présence CLI comme autorité d'état (CLAUDE.md, CHANGELOG)"
```

Le bump de version (2.13.0) et le build DMG restent à la main de Paul.
