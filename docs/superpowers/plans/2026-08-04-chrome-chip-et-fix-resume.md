# Chip Chrome + fix session fantôme au resume + readNewLines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger la session fantôme créée au resume (carte figée « Inactif » à vie), durcir la lecture incrémentale du JSONL contre les lignes partielles, et afficher un chip « Chrome » quand une session a utilisé Claude in Chrome il y a moins de 5 minutes.

**Architecture:** Tout le volet détection vit dans `watcher.js` (state machine + scan d'attribution). L'exposition passe par `serializeSession` (main.js). Le rendu et l'expiration du chip vivent côté renderer (`ui/renderer.js` + nouveau module pur `ui/chrome-chip.js`), sur le ticker 1 s existant. Spec : `docs/superpowers/specs/2026-08-04-chrome-chip-et-fix-resume-design.md`.

**Tech Stack:** Electron (main = Node CJS, renderer = vanilla JS via `<script src>`), tests maison `node test/<file>.test.js` (pas de framework).

## Global Constraints

- Jamais de `Date.now()` pour horodater un event JSONL — toujours le champ `timestamp` de l'event (resume-safe).
- Modules renderer chargés par `<script>` : IIFE obligatoire, JAMAIS de `const`/`let` au niveau racine (scope global partagé — `island-model.js` y déclare déjà `const api`).
- `build.files` du package.json contient déjà `ui/**/*` → un nouveau fichier sous `ui/` est packé sans modif. Tout nouveau module HORS `ui/` devrait y être ajouté (aucun dans ce plan).
- Commits signés Paul, sans trailer Co-Authored-By. Pas de push.
- Les tests se lancent un par un : `node test/watcher.test.js`, etc. Lancer TOUTE la suite modifiée avant chaque commit.
- Libellés utilisateur : fr + en dans `i18n.js` (clé identique dans les deux blocs).

---

### Task 1: Fix A — adoption du vrai sessionId au resume (session fantôme)

**Files:**
- Modify: `watcher.js` — branche `if (trackedId)` de `scan()` (~ligne 254), helper à ajouter près de `_isSidStale` (~ligne 413), `removeSession` (~ligne 1169)
- Test: `test/watcher.test.js` (section `scan() integration:`, harnais `freshScanWatcher` existant ~ligne 386)

**Interfaces:**
- Consumes: `_cwdToProjectDir(cwd)` (existant), `migrateSession(oldId, newId)` (existant, déclenché par la ligne ~272 de `scan()` quand `effectiveId !== trackedId`), harnais de test `makeFakeClaudeTree`/`writeSessionJson`/`writeJsonl`/`freshScanWatcher`/`makeSession` (existants).
- Produces: `_jsonlExists(sid, cwd)` → boolean (méthode de `SessionWatcher`, utilisée uniquement en interne).

**Contexte pour l'implémenteur.** Bug réel constaté : au quit → relance → resume, le CLI écrit d'abord un `session.json` avec un sessionId provisoire qui n'aura jamais de JSONL. Le watcher tracke ce fantôme par (pid, cwd), et `_isSidStale` retourne `false` pour un JSONL ABSENT (contrat voulu : « missing JSONL: not stale, just absent », watcher.js:421) → `effectiveId = trackedId` à chaque scan, pour toujours ; le vrai JSONL n'est plus jamais lu. On ne change PAS le contrat de `_isSidStale` : on apprend à la décision d'attribution à distinguer « absent ».

- [ ] **Step 1: Écrire les deux tests qui échouent** — dans `test/watcher.test.js`, section `scan() integration:` (après le test `brand-new Claude`, ~ligne 549), en réutilisant les helpers du fichier :

```js
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
```

- [ ] **Step 2: Vérifier que le premier test échoue**

Run: `node test/watcher.test.js`
Expected: FAIL — « le fantôme aurait dû être migré/retiré » (le second test passe déjà : il documente le comportement existant à préserver).

- [ ] **Step 3: Implémenter** — dans `watcher.js` :

(a) Nouveau helper juste au-dessus de `_isSidStale` (~ligne 413) :

```js
  // Le JSONL de ce sid existe-t-il sur disque ? Distinct de _isSidStale :
  // « absent » n'est PAS « stale » (contrat conservé), mais l'attribution de
  // scan() doit savoir qu'un trackedId sans JSONL ne peut pas gagner contre
  // un sid de session.json dont le JSONL existe.
  _jsonlExists(sid, cwd) {
    const projDir = this._cwdToProjectDir(cwd);
    if (!projDir) return false;
    return fs.existsSync(path.join(projDir, `${sid}.jsonl`));
  }
```

(b) Dans `scan()`, branche `if (trackedId)` (~ligne 254), ajouter la règle EN TÊTE — le bloc devient :

```js
          let effectiveId = sessionId;
          if (trackedId) {
            if (!this._jsonlExists(trackedId, cwd) && sessionId !== trackedId
                && this._jsonlExists(sessionId, cwd)) {
              // Fantôme de resume : le trackedId n'a pas (plus) de JSONL — sid
              // provisoire écrit par le CLI au lancement, remplacé ensuite par
              // le vrai sid dans session.json. Sans cette branche, « absent »
              // n'étant pas « stale », le fantôme gagnait l'attribution à
              // chaque scan et le vrai JSONL n'était plus jamais lu (session
              // figée « Inactif », constaté le 2026-08-04 sur Agnès Guédeu).
              effectiveId = sessionId;
              log.info(`[watcher] resume adopt ${trackedId.slice(0, 8)} → ${sessionId.slice(0, 8)} (pid=${pid})`);
            } else if (!this._isSidStale(trackedId, cwd)) {
              effectiveId = trackedId;
            } else if (sessionId !== trackedId) {
```

(le reste de la chaîne `else` est inchangé). La migration elle-même est faite par la ligne existante `if (trackedId && trackedId !== effectiveId && !this._isSidStale(effectiveId, cwd)) this.migrateSession(...)` — `migrateSession` préserve nom custom, prefs, position, ferme l'ancien watcher et appelle `watchJsonl(newId)` qui recalcule l'état depuis le JSONL cible via `startFileWatch` → `fastInitialLoad`. Rien d'autre à brancher.

(c) Observabilité de `removeSession` (~ligne 1169), première ligne du corps :

```js
    log.info(`[watcher] removed ${String(sessionId).slice(0, 8)}`);
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node test/watcher.test.js`
Expected: PASS (les deux nouveaux + toute la section scan existante — les tests d'oscillation /clear ne doivent PAS régresser : leurs trackedId ont tous un JSONL sur disque, la nouvelle branche ne s'active pas pour eux).

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "fix: le scan adopte le sid de session.json quand le trackedId n'a pas de JSONL (fantôme de resume)"
```

---

### Task 2: Fix B — readNewLines ne consomme que jusqu'au dernier \n

**Files:**
- Modify: `watcher.js` — `readNewLines` (~ligne 775), constante module à ajouter près des autres constantes du haut de fichier
- Test: `test/watcher.test.js`

**Interfaces:**
- Consumes: `this.fileOffsets` (Map path → offset bytes, existant), `this.processEvent(sessionId, event, false)` (existant).
- Produces: comportement interne uniquement ; la constante `MAX_PARTIAL_BYTES = 16 * 1024 * 1024` (module-level, non exportée).

**Contexte.** L'implémentation actuelle avance l'offset à `stat.size` puis skippe les lignes non parsables : si le poll (250 ms) tombe pendant l'écriture d'un gros event (screenshots claude-in-chrome de 100-400 KB mesurés), la ligne tronquée est perdue définitivement — transition d'état ratée. Fix : ne consommer que `buffer[0 .. dernier \n]`, positions en BYTES sur le buffer brut (pas après décodage UTF-8, qui fausserait les offsets sur les accents).

- [ ] **Step 1: Écrire les tests qui échouent** — dans `test/watcher.test.js`, nouvelle section après les tests scan :

```js
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
```

Note : le test 1 coupe `full` à 20 chars ASCII, mais le contenu accentué vérifie que le décodage de la ligne recomposée est intact — c'est le contrat « positions en bytes, décodage seulement sur la tranche complète ».

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `node test/watcher.test.js`
Expected: FAIL — l'implémentation actuelle parse l'event partiel (skip silencieux) et avance l'offset : « offset doit rester 0 » et « 2 events attendus au poll 2 » échouent.

- [ ] **Step 3: Implémenter** — remplacer le corps de `readNewLines` (~ligne 775) :

```js
  readNewLines(sessionId, jsonlPath) {
    try {
      const stat = fs.statSync(jsonlPath);
      const currentOffset = this.fileOffsets.get(jsonlPath) || 0;

      if (stat.size <= currentOffset) return;

      const fd = fs.openSync(jsonlPath, 'r');
      const buffer = Buffer.alloc(stat.size - currentOffset);
      fs.readSync(fd, buffer, 0, buffer.length, currentOffset);
      fs.closeSync(fd);

      // Ne consommer que jusqu'au dernier \n : la dernière ligne peut être en
      // cours d'écriture (gros tool_result, ex. screenshots claude-in-chrome
      // de 100-400 KB) — avancer l'offset au-delà la perdrait pour toujours
      // (parse fail skippé + offset déjà avancé). Positions en BYTES sur le
      // buffer brut : décoder d'abord fausserait les offsets sur l'UTF-8.
      const lastNL = buffer.lastIndexOf(0x0A);
      if (lastNL === -1) {
        // Aucune ligne complète dans le chunk. Garde-fou : une « ligne » qui
        // dépasse MAX_PARTIAL_BYTES sans \n est pathologique — on la saute
        // plutôt que de relire un chunk géant à chaque poll pour toujours.
        if (buffer.length > MAX_PARTIAL_BYTES) this.fileOffsets.set(jsonlPath, stat.size);
        return;
      }
      this.fileOffsets.set(jsonlPath, currentOffset + lastNL + 1);

      const lines = buffer.toString('utf-8', 0, lastNL).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          this.processEvent(sessionId, event, false);
        } catch (e) {
          // skip malformed lines
        }
      }
    } catch (e) {
      // file access error
    }
  }
```

Et près des constantes du haut de fichier (chercher `const SCAN_INTERVAL` / `POLL_INTERVAL`) :

```js
// Garde-fou readNewLines : une ligne JSONL sans \n au-delà de cette taille est
// pathologique (aligné sur MAX_TAIL de fastInitialLoad) — on l'abandonne.
const MAX_PARTIAL_BYTES = 16 * 1024 * 1024;
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node test/watcher.test.js`
Expected: PASS (nouveaux + anciens).

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "fix: readNewLines n'avance l'offset que jusqu'au dernier \\n (events perdus sur gros tool_results)"
```

---

### Task 3: Chip Chrome — détection watcher + restauration tail

**Files:**
- Modify: `watcher.js` — helpers purs du haut de fichier (près de `bgTaskOpened`, ~ligne 77), `processAssistantEvent` (~ligne 887), boucle de `fastInitialLoad` (branche `event.type === 'assistant'`, ~ligne 633), création de session dans `scan()` (~ligne 285), `module.exports` (~ligne 1311)
- Test: `test/watcher.test.js`

**Interfaces:**
- Consumes: `session.chromeLastUsedAt` initialisé à `null` à la création.
- Produces: `isChromeToolUse(name)` → boolean, EXPORTÉ dans `module.exports` ; `session.chromeLastUsedAt` (epoch ms ou null) — consommé par Task 4 (`serializeSession`).

- [ ] **Step 1: Écrire les tests qui échouent** — dans `test/watcher.test.js` :

```js
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
```

Ajouter `isChromeToolUse` au destructuring du `require('../watcher')` en tête du fichier de test.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `node test/watcher.test.js`
Expected: FAIL — `isChromeToolUse is not a function` (export absent).

- [ ] **Step 3: Implémenter** — dans `watcher.js` :

(a) Helpers purs, sous `bgTaskClosed` (~ligne 90) :

```js
const CHROME_TOOL_PREFIX = 'mcp__claude-in-chrome__';

// Tool de l'extension Claude in Chrome ? Sert au chip « Chrome » : usage
// récent = la session pilote le navigateur de l'utilisateur — combiné à
// « Inactif », l'action attendue est probablement côté Chrome.
function isChromeToolUse(name) {
  return typeof name === 'string' && name.startsWith(CHROME_TOOL_PREFIX);
}
```

(b) `processAssistantEvent`, juste après `const lastToolUse = [...content].reverse().find(c => c.type === 'tool_use');` (~ligne 915) :

```js
    if (content.some(c => c.type === 'tool_use' && isChromeToolUse(c.name))) {
      // Timestamp de l'EVENT, jamais Date.now() : au replay initial (tail),
      // l'horodatage réel de l'usage est ce qui décide de l'expiration du chip.
      const at = event.timestamp ? Date.parse(event.timestamp) : NaN;
      if (Number.isFinite(at)) session.chromeLastUsedAt = at;
    }
```

(c) `fastInitialLoad`, dans la branche `if (event.type === 'assistant')` de la boucle (~ligne 633), après le bloc usage/tokens :

```js
              const evContent = (event.message && event.message.content) || [];
              if (Array.isArray(evContent) && evContent.some(c => c.type === 'tool_use' && isChromeToolUse(c.name))) {
                const at = event.timestamp ? Date.parse(event.timestamp) : NaN;
                if (Number.isFinite(at)) session.chromeLastUsedAt = at;
              }
```

(Les events sont lus dans l'ordre chronologique : la dernière assignation gagne, pas besoin de max. La fenêtre extensible relit un superset — même résultat.)

(d) Création de session dans `scan()` (~ligne 314, à côté de `stateSince: null`) :

```js
              chromeLastUsedAt: null,
```

(e) Export (~ligne 1311) :

```js
module.exports = { SessionWatcher, STATES, bgTaskOpened, bgTaskClosed, explicitSessionName, isRealModel, isChromeToolUse };
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node test/watcher.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "feat: détection de l'usage Claude in Chrome (chromeLastUsedAt, tail compris)"
```

---

### Task 4: Chip Chrome — module pur, exposition et rendu

**Files:**
- Create: `ui/chrome-chip.js`
- Create: `test/chrome-chip.test.js`
- Modify: `main.js` — `serializeSession` (~ligne 811, à côté de `bgTaskCount`)
- Modify: `ui/renderer.js` — nouvelle fonction sous `bgChipHTML` (~ligne 938), template grid (~ligne 1018 `)${bgChip}`), template compact (~ligne 1126 `${bgChipHTML(s)}`), `updateDurations` (~ligne 1143)
- Modify: `ui/index.html` — `<script src="chrome-chip.js">` avant `renderer.js` (~ligne 345)
- Modify: `i18n.js` — clé `chrome_chip` dans les blocs fr ET en (à côté de `bg_chip`, lignes 16 et 181)
- Modify: `ui/styles.css` — variante `.chrome-chip` sous `.bg-chip` (~ligne 776)

**Interfaces:**
- Consumes: `session.chromeLastUsedAt` (Task 3) ; `t('chrome_chip')` ; classe CSS `.bg-chip` (gabarit réutilisé).
- Produces: `window.chromeChip.chromeChipVisible(lastUsedAt, now)` → boolean et `window.chromeChip.CHROME_RECENT_MS` (300 000) ; champ `chromeLastUsedAt` dans le payload sérialisé (renderer + île le reçoivent, seul le renderer le consomme).

- [ ] **Step 1: Écrire le test du module pur qui échoue** — `test/chrome-chip.test.js` :

```js
// Tests du module pur ui/chrome-chip.js (visibilité du chip « Chrome »).
// Run via `node test/chrome-chip.test.js`.
const { chromeChipVisible, CHROME_RECENT_MS } = require('../ui/chrome-chip');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}

const NOW = 1785832000000;

test('CHROME_RECENT_MS vaut 5 minutes', () => {
  if (CHROME_RECENT_MS !== 5 * 60 * 1000) throw new Error(`${CHROME_RECENT_MS}`);
});
test('visible juste après usage', () => {
  if (!chromeChipVisible(NOW - 1000, NOW)) throw new Error('devrait être visible');
});
test('visible juste sous la borne', () => {
  if (!chromeChipVisible(NOW - CHROME_RECENT_MS + 1, NOW)) throw new Error('devrait être visible');
});
test('invisible à la borne exacte', () => {
  if (chromeChipVisible(NOW - CHROME_RECENT_MS, NOW)) throw new Error('devrait être expiré');
});
test('null / undefined / 0 → invisible (jamais de timestamp fabriqué)', () => {
  if (chromeChipVisible(null, NOW) || chromeChipVisible(undefined, NOW) || chromeChipVisible(0, NOW)) {
    throw new Error('absence de donnée = pas de chip');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `node test/chrome-chip.test.js`
Expected: FAIL — `Cannot find module '../ui/chrome-chip'`.

- [ ] **Step 3: Créer `ui/chrome-chip.js`** — IIFE, double export node/window, AUCUN `const` au niveau racine (piège du scope global partagé des `<script>`) :

```js
// Visibilité du chip « Chrome » : usage de l'extension Claude in Chrome il y a
// moins de CHROME_RECENT_MS. Module pur — l'expiration vit côté renderer (le
// main n'émet aucun event à l'expiration), d'où le `now` injecté.
(function () {
  const CHROME_RECENT_MS = 5 * 60 * 1000;

  function chromeChipVisible(lastUsedAt, now) {
    return typeof lastUsedAt === 'number' && lastUsedAt > 0 && (now - lastUsedAt) < CHROME_RECENT_MS;
  }

  const api = { chromeChipVisible, CHROME_RECENT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.chromeChip = api;
})();
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `node test/chrome-chip.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Brancher exposition + rendu** — quatre modifications :

(a) `main.js`, `serializeSession`, juste après la ligne `bgTaskCount:` (~811) :

```js
    chromeLastUsedAt: session.chromeLastUsedAt || null,
```

(b) `i18n.js`, à côté de `bg_chip` dans les DEUX blocs (fr ligne ~16, en ligne ~181) :

```js
      chrome_chip: 'Chrome',
```

(c) `ui/index.html`, avant `renderer.js` :

```html
  <script src="chrome-chip.js"></script>
```

(d) `ui/renderer.js` :

Sous `bgChipHTML` (~ligne 941) :

```js
// Chip « Chrome » : la session a piloté le navigateur il y a < 5 min. Même
// famille visuelle que .bg-chip ; data-chrome-since permet au ticker 1 s de
// retirer le chip à l'expiration sans re-render (le main n'émet rien).
function chromeChipHTML(s) {
  if (!window.chromeChip.chromeChipVisible(s.chromeLastUsedAt, Date.now())) return '';
  return `<span class="bg-chip chrome-chip" data-chrome-since="${s.chromeLastUsedAt}">${t('chrome_chip')}</span>`;
}
```

Template grid — la ligne `      </div>${bgChip}` (~1018) devient :

```js
      </div>${bgChip}${chromeChipHTML(s)}
```

(La variable locale `const bgChip = bgChipHTML(s);` en tête de `cardHTML` reste telle quelle ; l'appel `chromeChipHTML(s)` se fait inline comme en compact.)

Template compact — la ligne `        ${bgChipHTML(s)}` (~1126) devient :

```js
        ${bgChipHTML(s)}${chromeChipHTML(s)}
```

`updateDurations` (~1143), ajouter en fin de fonction :

```js
  // Expiration du chip Chrome — retrait pur DOM : aucun event main à
  // l'expiration, c'est le ticker qui fait foi (même approche que la durée
  // d'état). Un nouvel usage re-rendra la carte avec un chip frais.
  document.querySelectorAll('.chrome-chip[data-chrome-since]').forEach(el => {
    const since = Number(el.dataset.chromeSince);
    if (!window.chromeChip.chromeChipVisible(since, Date.now())) el.remove();
  });
```

(e) `ui/styles.css`, sous le bloc `.compact-card-row .bg-chip` (~ligne 777) :

```css
/* Chip Chrome : même gabarit que bg-chip (famille « ça se passe ailleurs »),
   teinte cyan légèrement distincte pour le différencier d'un bg process. */
.chrome-chip { color: #22d3ee; border-color: rgba(34, 211, 238, 0.35); }
```

(Vérifier à l'implémentation les propriétés réelles de `.bg-chip` lignes 762-776 : si la couleur passe par d'autres propriétés — background, etc. — décliner les mêmes en variante cyan clair, sans halo : le chip n'appelle aucune action.)

- [ ] **Step 6: Lancer toute la suite**

Run: `for f in test/*.test.js; do node "$f" || break; done`
Expected: tous PASS.

- [ ] **Step 7: Vérification visuelle au CDP** (leçon Paul : à la VRAIE largeur de fenêtre) — lancer `npm run dev` (tuer l'instance Electron existante d'abord : single-instance lock), forger si besoin une session avec `chromeLastUsedAt` récent, screenshot des cartes grid ET compact, vérifier le chip et son expiration (attendre la borne ou forger un timestamp à 4 min 50).

- [ ] **Step 8: Commit**

```bash
git add ui/chrome-chip.js test/chrome-chip.test.js main.js ui/renderer.js ui/index.html i18n.js ui/styles.css
git commit -m "feat: chip « Chrome » sur les cartes (usage Claude in Chrome < 5 min)"
```

---

### Task 5: Documentation (CLAUDE.md + CHANGELOG si release)

**Files:**
- Modify: `CLAUDE.md` — section « Key decisions »

**Interfaces:** aucune (documentation).

- [ ] **Step 1: Ajouter deux décisions dans CLAUDE.md** (style existant, compact) :

Une entrée sur le fix resume — points à couvrir : sid provisoire écrit par le CLI avant le choix du resume ; « absent ≠ stale » conservé dans `_isSidStale` mais l'attribution de `scan()` adopte le sid de session.json quand le trackedId n'a pas de JSONL et que le sid rapporté en a un (`_jsonlExists`) ; migration via la mécanique existante ; logs `resume adopt` / `removed` ajoutés parce que tout ce chemin était muet (diagnostic Agnès Guédeu 2026-08-04, carte figée « Inactif » 20+ min pendant une navigation Chrome active).

Une entrée sur le chip Chrome — points à couvrir : usage récent < 5 min (choix Paul : savoir que ça se passe dans Chrome MAINTENANT ; « Inactif » + chip = l'action attendue est côté navigateur) ; détection `isChromeToolUse` pur JSONL dans `processAssistantEvent` + tail ; timestamp de l'event, jamais `Date.now()` ; expiration côté renderer sur le ticker 1 s (`chromeChipVisible`, module pur `ui/chrome-chip.js`) ; pas de persistance (TTL 5 min < fenêtre de tail, même dégradation gracieuse que bgTasks) ; aucun nouvel état, aucune notif/mute ; surfaces grid + compact seulement. Mentionner aussi le durcissement `readNewLines` (dernier `\n`, garde-fou 16 Mo).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: décisions fix resume fantôme + chip Chrome + readNewLines"
```

---

## Self-review (fait à l'écriture du plan)

- Spec coverage : volet A → Task 1 ; volet B → Task 2 ; volet C → Tasks 3-4 ; observabilité → Task 1 (logs) ; rappel build.files → couvert par `ui/**/*` (vérifié, aucun ajout nécessaire) ; hors-scope respecté (pas de pattern-matching d'erreurs Chrome, île/micro/toasts exclus).
- Placeholders : aucun — chaque step a son code.
- Cohérence des types : `chromeLastUsedAt` epoch ms ou null partout ; `isChromeToolUse` exporté Task 3, consommé Task 3 (interne) ; `chromeChipVisible(lastUsedAt, now)` défini Task 4 et utilisé Task 4 uniquement ; `_jsonlExists(sid, cwd)` interne Task 1.
