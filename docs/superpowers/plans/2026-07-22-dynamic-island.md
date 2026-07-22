# Dynamic Island — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le popover du tray par une « île » ancrée à l'encoche du MacBook : LEDs par session repliée, liste de sessions + jauge 5h au survol.

**Architecture:** Un module pur `island-model.js` (logique testable, double export node/navigateur), un module main-process `island.js` (fenêtre transparente always-on-top à taille fixe, click-through forwardé), un renderer `ui/island/`. Le popover (`preload-popover.js`, `ui/popover.*`) est supprimé ; le clic tray ouvre la fenêtre principale. Spec : `docs/superpowers/specs/2026-07-22-dynamic-island-design.md`.

**Tech Stack:** Electron 41 (vanilla JS, pas de framework), tests node purs (`node test/x.test.js`), pas de nouvelle dépendance.

## Global Constraints

- Commits signés Paul uniquement — AUCUN trailer `Co-Authored-By` ; jamais de `git push`.
- Piège `build.files` (whitelist) : tout nouveau fichier racine doit être ajouté à `package.json > build.files`, sinon crash DMG invisible en dev. `ui/**/*` couvre déjà `ui/island/`.
- L'île ne se déplie JAMAIS toute seule (décision produit) : pas d'auto-expand sur pending/error, seulement le pulse des LEDs.
- Écran intégré à encoche uniquement — heuristique `display.internal && (workArea.y - bounds.y) >= 30` ; pas d'île sinon.
- Headless (`isBackground`) : LEDs plus petites/ternes aile droite, pas de click-focus (règle existante).
- Textes UI via `i18n.js` (fr + en), couleurs d'état via les variables `--state-*` de `ui/styles.css`.
- Suite de tests : `npm test` doit rester verte après chaque tâche.
- Hors scope : code office (`ui/office*`), approbation de permissions depuis l'île.

---

### Task 1: `island-model.js` — logique pure + tests

**Files:**
- Create: `island-model.js`
- Test: `test/island-model.test.js`
- Modify: `package.json` (script `test`, `build.files`)

**Interfaces:**
- Consumes: sessions sérialisées par `serializeSession()` de main.js — `{ sessionId, projectName, customName, state: { name }, isBackground, lastEventTime, startedAt }` (le champ `lastEventTime` est ajouté en Task 2).
- Produces: `buildIsland(sessions, config, now?) → { left: { leds: [{ sessionId, state }], more }, right: { … }, rows: [{ sessionId, name, state, minutes, isBackground }], backgroundRows: […] }` ; `notchedInternalDisplay(displays) → display | null` ; `menuBarHeight(display) → number` ; constante `CAP_PER_WING = 4`. Double export : `module.exports` (node/main) + `window.islandModel` (renderer via `<script>`).

- [ ] **Step 1 : Écrire les tests (qui échouent)**

`test/island-model.test.js` :

```js
// Tests for island-model.js. Run: node test/island-model.test.js
const { buildIsland, notchedInternalDisplay, menuBarHeight, CAP_PER_WING } = require('../island-model.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// Display helpers — shapes mirror Electron's screen.getAllDisplays()
const notched = { internal: true, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
const plain = { internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const external = { internal: false, bounds: { x: 1512, y: 0, width: 2560, height: 1440 }, workArea: { x: 1512, y: 25, width: 2560, height: 1415 } };

console.log('\nnotchedInternalDisplay:');
test('detects notched internal display (menu bar ≥ 30)', () => {
  assertEq(notchedInternalDisplay([external, notched]) === notched, true);
});
test('plain internal display → null', () => {
  assertEq(notchedInternalDisplay([plain, external]), null);
});
test('no displays → null', () => {
  assertEq(notchedInternalDisplay([]), null);
});
test('menuBarHeight subtracts bounds.y (secondary display coords are absolute)', () => {
  const below = { internal: true, bounds: { x: 0, y: 900, width: 1512, height: 982 }, workArea: { x: 0, y: 937, width: 1512, height: 945 } };
  assertEq(menuBarHeight(below), 37);
  assertEq(notchedInternalDisplay([below]) === below, true);
});

// Session factory
const NOW = 1_000_000_000_000;
let n = 0;
function sess(state, opts = {}) {
  n++;
  return {
    sessionId: opts.id || `s${n}`,
    projectName: opts.name || `proj${n}`,
    customName: opts.customName || null,
    state: { name: state },
    isBackground: !!opts.bg,
    lastEventTime: opts.lastEventTime !== undefined ? opts.lastEventTime : NOW - 120000,
    startedAt: new Date(NOW - (opts.age || n) * 60000).toISOString(),
  };
}

console.log('\nbuildIsland:');
test('splits interactive (left) and background (right)', () => {
  const m = buildIsland([sess('running'), sess('waiting', { bg: true })], {}, NOW);
  assertEq(m.left.leds.length, 1);
  assertEq(m.right.leds.length, 1);
});
test('caps each wing at CAP_PER_WING with a more count', () => {
  const many = Array.from({ length: 6 }, () => sess('running'));
  const m = buildIsland(many, {}, NOW);
  assertEq(m.left.leds.length, CAP_PER_WING);
  assertEq(m.left.more, 2);
  assertEq(m.right.more, 0);
});
test('led carries sessionId and state name', () => {
  const m = buildIsland([sess('pending', { id: 'abc' })], {}, NOW);
  assertEq(m.left.leds[0], { sessionId: 'abc', state: 'pending' });
});
test('sessionOrder from config wins, then newest first', () => {
  const a = sess('running', { id: 'a', age: 10 });
  const b = sess('running', { id: 'b', age: 1 });
  const c = sess('running', { id: 'c', age: 5 });
  const m = buildIsland([a, b, c], { sessionOrder: ['c'] }, NOW);
  assertEq(m.rows.map(r => r.sessionId), ['c', 'b', 'a']);
});
test('row name prefers customName over projectName', () => {
  const m = buildIsland([sess('running', { name: 'proj', customName: 'mon-nom' })], {}, NOW);
  assertEq(m.rows[0].name, 'mon-nom');
});
test('minutes set for attention states (pending/error/waiting), null otherwise', () => {
  const m = buildIsland([
    sess('pending', { lastEventTime: NOW - 120000 }),
    sess('running', { lastEventTime: NOW - 120000 }),
  ], {}, NOW);
  assertEq(m.rows[0].minutes, 2);
  assertEq(m.rows[1].minutes, null);
});
test('minutes null when lastEventTime missing', () => {
  const m = buildIsland([sess('waiting', { lastEventTime: null })], {}, NOW);
  assertEq(m.rows[0].minutes, null);
});
test('backgroundRows flagged isBackground', () => {
  const m = buildIsland([sess('running', { bg: true })], {}, NOW);
  assertEq(m.rows.length, 0);
  assertEq(m.backgroundRows[0].isBackground, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run : `node test/island-model.test.js`
Attendu : `Error: Cannot find module '../island-model.js'`

- [ ] **Step 3 : Implémenter `island-model.js`**

```js
// ─── island-model.js ───
// Pure logic for the dynamic island — no Electron deps → unit-testable.
// Dual export: module.exports (main process, tests) + window.islandModel
// (island renderer, loaded via <script> like i18n.js).

const CAP_PER_WING = 4;
// Menu bar is ~37px on notched MacBooks vs ~25px otherwise. No public API
// exposes the notch — this heuristic is the standard technique.
const NOTCH_MENUBAR_MIN = 30;

function menuBarHeight(display) {
  return display.workArea.y - display.bounds.y;
}

function notchedInternalDisplay(displays) {
  return (displays || []).find(
    (d) => d.internal && menuBarHeight(d) >= NOTCH_MENUBAR_MIN
  ) || null;
}

// Same ordering as the main window / popover: user-defined sessionOrder
// first, then newest first. Stable → LEDs never jump on state changes.
function sortSessions(sessions, sessionOrder) {
  return sessions.slice().sort((a, b) => {
    const ai = sessionOrder.indexOf(a.sessionId);
    const bi = sessionOrder.indexOf(b.sessionId);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return new Date(b.startedAt) - new Date(a.startedAt);
  });
}

const ATTENTION = ['pending', 'error', 'waiting'];

function buildIsland(sessions, config, now = Date.now()) {
  const order = (config && config.sessionOrder) || [];
  const sorted = sortSessions(sessions || [], order);
  const interactive = sorted.filter((s) => !s.isBackground);
  const background = sorted.filter((s) => s.isBackground);

  const wing = (list) => ({
    leds: list.slice(0, CAP_PER_WING).map((s) => ({ sessionId: s.sessionId, state: s.state.name })),
    more: Math.max(0, list.length - CAP_PER_WING),
  });

  const row = (s) => ({
    sessionId: s.sessionId,
    name: s.customName || s.projectName,
    state: s.state.name,
    minutes: ATTENTION.includes(s.state.name) && s.lastEventTime
      ? Math.max(0, Math.floor((now - s.lastEventTime) / 60000))
      : null,
    isBackground: !!s.isBackground,
  });

  return {
    left: wing(interactive),
    right: wing(background),
    rows: interactive.map(row),
    backgroundRows: background.map(row),
  };
}

const api = { buildIsland, notchedInternalDisplay, menuBarHeight, CAP_PER_WING };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.islandModel = api;
```

- [ ] **Step 4 : Vérifier que le test passe**

Run : `node test/island-model.test.js`
Attendu : `12 passed, 0 failed`

- [ ] **Step 5 : Brancher dans `npm test` et `build.files`**

Dans `package.json` :
- script `test` : ajouter `&& node test/island-model.test.js` à la fin de la chaîne existante.
- `build.files` : ajouter `"island-model.js",` après `"ring-gauge.js",`.

- [ ] **Step 6 : Suite complète verte puis commit**

Run : `npm test`
Attendu : toutes les suites passent.

```bash
git add island-model.js test/island-model.test.js package.json
git commit -m "feat(island): island-model — logique pure LEDs/rangées + heuristique encoche"
```

---

### Task 2: `island.js` + `preload-island.js` + intégration main.js

**Files:**
- Create: `island.js`, `preload-island.js`, `ui/island/island.html` (squelette minimal, contenu réel en Task 3)
- Modify: `main.js` (require, IPC `island-hover`, `serializeSession` + `lastEventTime`, création au ready, listeners `screen`, envois d'updates), `package.json` (`build.files`)

**Interfaces:**
- Consumes: `notchedInternalDisplay` de `island-model.js` ; handlers IPC existants `get-sessions`, `get-config`, `get-usage`, `focus-terminal`.
- Produces: module `island` avec `refresh(enabled)`, `destroy()`, `sendUpdate()`, `setHover(hovering)`, `window()` ; canal renderer `island-update` ; pont `window.islandApi` (`getSessions`, `getConfig`, `getUsage`, `focusSession`, `setHover`, `onUpdate`) ; sessions sérialisées enrichies de `lastEventTime`.

- [ ] **Step 1 : Écrire `island.js`**

```js
// ─── island.js ───
// Dynamic island window anchored to the MacBook notch. Fixed-size transparent
// always-on-top window, click-through by default; the renderer drives hover
// via the 'island-hover' IPC (never resize on hover — transparent-window
// resizes flicker).

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { notchedInternalDisplay } = require('./island-model');

const WIN_W = 460;
const WIN_H = 340;

let win = null;

function position(display) {
  const x = Math.round(display.bounds.x + (display.bounds.width - WIN_W) / 2);
  win.setBounds({ x, y: display.bounds.y, width: WIN_W, height: WIN_H });
}

function create(display) {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-island.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'screen-saver' level → above the menu bar; visible over fullscreen apps
  // (the physical notch is still there).
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  position(display);
  win.loadFile(path.join(__dirname, 'ui', 'island', 'island.html'));
  win._loaded = false;
  win.webContents.once('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    win._loaded = true;
    win.showInactive();
    sendUpdate();
  });
  win.on('closed', () => { win = null; });
}

function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

// (Re)create, reposition or drop the island for the current displays + config.
// Called at startup, on every screen event, and when the setting toggles.
function refresh(enabled) {
  const display = notchedInternalDisplay(screen.getAllDisplays());
  if (!enabled || !display) return destroy();
  if (!win || win.isDestroyed()) return create(display);
  position(display);
}

function sendUpdate() {
  if (win && !win.isDestroyed() && win._loaded) win.webContents.send('island-update');
}

function setHover(hovering) {
  if (!win || win.isDestroyed()) return;
  if (hovering) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
}

module.exports = { refresh, destroy, sendUpdate, setHover, window: () => win };
```

- [ ] **Step 2 : Écrire `preload-island.js`**

```js
// ─── preload-island.js ───
// Context bridge for the island window. Same trust model as preload.js.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandApi', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getUsage: () => ipcRenderer.invoke('get-usage'),
  focusSession: (sessionId) => ipcRenderer.invoke('focus-terminal', sessionId),
  setHover: (hovering) => ipcRenderer.invoke('island-hover', hovering),
  onUpdate: (cb) => ipcRenderer.on('island-update', () => cb()),
});
```

- [ ] **Step 3 : Squelette `ui/island/island.html`** (contenu réel en Task 3 — ici juste de quoi voir la fenêtre en dev)

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Aby Claude Watcher — Island</title>
  <style>body { margin: 0; background: transparent; } .probe { width: 220px; height: 32px; background: #000; border-radius: 0 0 12px 12px; margin: 0 auto; }</style>
</head>
<body><div class="probe"></div></body>
</html>
```

- [ ] **Step 4 : Intégrer dans `main.js`**

1. En tête, après `const { trayGlance } = require('./tray-glance');` :
```js
const island = require('./island');
```
2. Dans `serializeSession()`, ajouter après `startedAt: session.startedAt,` :
```js
lastEventTime: session.lastEventTime || null,
```
3. Dans `setupIPC()`, ajouter :
```js
ipcMain.handle('island-hover', (_, hovering) => island.setHover(!!hovering));
```
4. Dans le handler `app.whenReady`, juste après l'appel `createPopoverWindow();` :
```js
island.refresh(!!config.get().islandEnabled);
const refreshIsland = () => island.refresh(!!config.get().islandEnabled);
screen.on('display-added', refreshIsland);
screen.on('display-removed', refreshIsland);
screen.on('display-metrics-changed', refreshIsland);
```
(`islandEnabled` n'existe pas encore dans config — `!!undefined` = false, l'île restera absente jusqu'à la Task 5 qui ajoute le défaut `true`. Pour vérifier visuellement dès cette tâche, voir Step 6.)
5. Dans `setupTray()`, dans le corps du `debouncedUpdate`, après l'envoi `popover-update` :
```js
island.sendUpdate();
```
6. Dans `setupUsageMonitor()`, dans le handler `'update'`, après `refreshTrayGlance();` :
```js
island.sendUpdate();
```
7. Dans le handler `set-language` (là où `popover-update` est envoyé, ~ligne 584) :
```js
island.sendUpdate();
```

- [ ] **Step 5 : `build.files`**

Dans `package.json > build.files`, ajouter `"island.js",` et `"preload-island.js",` après `"island-model.js",`.

- [ ] **Step 6 : Vérification manuelle**

Ajouter provisoirement `islandEnabled: true` dans `~/Library/Application Support/aby-claude-watcher/config.json` (l'app ne doit pas tourner pendant l'édition), puis :
Run : `pkill -f "aby-claude-watcher" ; npm run dev` (single-instance lock — l'ancienne instance doit mourir d'abord)
Attendu : pilule noire visible sous l'encoche, clics au travers (le bureau réagit derrière). Sur un Mac sans encoche ou écran externe seul : rien.

- [ ] **Step 7 : Tests + commit**

Run : `npm test`
Attendu : vert (aucune suite ne touche main.js).

```bash
git add island.js preload-island.js ui/island/island.html main.js package.json
git commit -m "feat(island): fenêtre île ancrée à l'encoche — click-through, updates, screen events"
```

---

### Task 3: Renderer `ui/island/` — LEDs, panneau, hover, focus

**Files:**
- Create: `ui/island/island.css`, `ui/island/island.js`
- Modify: `ui/island/island.html` (remplace le squelette), `i18n.js` (nouvelles clés fr + en)

**Interfaces:**
- Consumes: `window.islandApi` (Task 2), `window.islandModel.buildIsland` (Task 1), `window.i18n` (`t`, `setLanguage`, `detectSystemLanguage`), variables CSS `--state-*` et `--font-mono` de `ui/styles.css`, usage `{ fiveHour: { utilization, resetsAt } }`.
- Produces: île fonctionnelle — repliée (wings de LEDs, pulse pending/error), dépliée au survol (rangées cliquables, section headless, jauge 5h).

- [ ] **Step 1 : `ui/island/island.html` définitif**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Aby Claude Watcher — Island</title>
  <link rel="stylesheet" href="../styles.css">
  <link rel="stylesheet" href="island.css">
</head>
<body>
  <div class="island">
    <div class="pill" id="pill">
      <div class="wing wing-left" id="wingLeft"></div>
      <div class="notch-gap"></div>
      <div class="wing wing-right" id="wingRight"></div>
    </div>
    <div class="panel" id="panel">
      <div class="panel-inner">
        <div class="rows" id="rows"></div>
        <div class="rows rows-bg" id="rowsBg"></div>
        <div class="gauge-block" id="gaugeBlock" style="display:none;">
          <div class="gauge"><div class="gauge-fill" id="gaugeFill"></div></div>
          <div class="gauge-label"><span id="gaugeLeft"></span><span id="gaugeRight"></span></div>
        </div>
      </div>
    </div>
  </div>
  <script src="../../i18n.js"></script>
  <script src="../../island-model.js"></script>
  <script src="island.js"></script>
</body>
</html>
```

- [ ] **Step 2 : `ui/island/island.css`**

```css
/* Island — overrides styles.css body, keeps --state-* single-sourced there. */
body {
  margin: 0;
  overflow: hidden;
  background: transparent;
  user-select: none;
  -webkit-user-select: none;
}

.island { display: flex; flex-direction: column; align-items: center; }

/* Collapsed pill: fused with the physical notch (same black, bottom radius).
   .notch-gap reserves the zone hidden by the hardware notch — never put
   content there. */
.pill {
  display: flex;
  align-items: center;
  background: #000;
  border-radius: 0 0 12px 12px;
  height: 34px;
  padding: 0 14px;
}
.notch-gap { width: 180px; flex: none; }
.wing { display: flex; align-items: center; gap: 6px; min-width: 20px; }
.wing-left { justify-content: flex-end; }

.led {
  width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: var(--led, #555);
  box-shadow: 0 0 6px 1px color-mix(in srgb, var(--led, #555) 55%, transparent);
}
.led[data-state="thinking"] { --led: var(--state-thinking); }
.led[data-state="running"]  { --led: var(--state-running); }
.led[data-state="waiting"]  { --led: var(--state-waiting); }
.led[data-state="pending"]  { --led: var(--state-pending); }
.led[data-state="error"]    { --led: var(--state-error); }
/* Headless: smaller, dimmer, no glow. */
.led.bg { width: 6px; height: 6px; opacity: .55; box-shadow: none; }
/* Attention pulse — the ONLY autonomous motion of the island. */
.led[data-state="pending"], .led[data-state="error"] {
  animation: led-pulse 1.2s ease-in-out infinite;
}
@keyframes led-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: .7; }
}
.more { color: #6b7385; font-size: 9px; font-family: var(--font-mono); }

/* Expanded panel below the pill. max-height transition = fold animation. */
.panel {
  width: 340px;
  background: #000;
  border-radius: 0 0 16px 16px;
  overflow: hidden;
  max-height: 0;
  transition: max-height .22s ease;
}
body.expanded .panel { max-height: 300px; }
.panel-inner { padding: 6px 14px 12px; }
.rows { max-height: 190px; overflow-y: auto; }
.rows::-webkit-scrollbar { width: 4px; }
.rows::-webkit-scrollbar-thumb { background: #333c50; border-radius: 2px; }
.row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 0;
  font-size: 12px; color: #e8eaf0;
  cursor: pointer;
}
.row:hover { color: #fff; }
.row .r-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .r-state { margin-left: auto; flex: none; color: #6b7385; font-size: 11px; font-family: var(--font-mono); }
.rows-bg { border-top: 1px solid #1d2330; margin-top: 4px; padding-top: 4px; }
.rows-bg:empty { display: none; border: none; margin: 0; padding: 0; }
.rows-bg .row { cursor: default; opacity: .65; }
.island-empty { padding: 10px 0; text-align: center; color: #6b7385; font-size: 11px; }

.gauge-block { margin-top: 8px; }
.gauge { height: 4px; border-radius: 2px; background: #1d2330; overflow: hidden; }
.gauge-fill { height: 100%; border-radius: 2px; background: var(--state-waiting); transition: width .3s ease; }
.gauge-fill.warn { background: var(--state-pending); }
.gauge-fill.hot { background: var(--state-error); }
.gauge-label { display: flex; justify-content: space-between; margin-top: 4px; font-size: 10px; color: #6b7385; font-family: var(--font-mono); }
```

- [ ] **Step 3 : `ui/island/island.js`**

```js
// Island renderer — collapsed LEDs + expanded session list. Hover drives
// expansion: mousemove is forwarded even when the window is click-through
// (setIgnoreMouseEvents forward:true); entering the pill/panel asks main to
// take mouse events, leaving gives them back.

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmtMin(minutes) {
  if (minutes === null || minutes === undefined) return '';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function fmtRemaining(resetsAt) {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return fmtMin(Math.round(ms / 60000));
}

function ledHtml(led, bg) {
  return `<span class="led${bg ? ' bg' : ''}" data-state="${esc(led.state)}"></span>`;
}

function wingHtml(wing, bg) {
  return wing.leds.map((l) => ledHtml(l, bg)).join('')
    + (wing.more ? `<span class="more">+${wing.more}</span>` : '');
}

function rowHtml(row) {
  const dur = row.minutes !== null ? ` · ${fmtMin(row.minutes)}` : '';
  return `
    <div class="row" data-session="${esc(row.sessionId)}" data-bg="${row.isBackground ? '1' : ''}">
      <span class="led${row.isBackground ? ' bg' : ''}" data-state="${esc(row.state)}"></span>
      <span class="r-name">${esc(row.name)}</span>
      <span class="r-state">${esc(window.i18n.t('state_' + row.state))}${esc(dur)}</span>
    </div>`;
}

let refreshSeq = 0;
async function refresh() {
  const myId = ++refreshSeq;
  const sessions = await window.islandApi.getSessions();
  if (myId !== refreshSeq) return;
  const config = await window.islandApi.getConfig();
  if (myId !== refreshSeq) return;
  const usage = await window.islandApi.getUsage();
  if (myId !== refreshSeq) return;

  window.i18n.setLanguage(config.language || window.i18n.detectSystemLanguage());

  const m = window.islandModel.buildIsland(sessions, config);
  document.getElementById('wingLeft').innerHTML = wingHtml(m.left, false);
  document.getElementById('wingRight').innerHTML = wingHtml(m.right, true);

  const $rows = document.getElementById('rows');
  $rows.innerHTML = m.rows.length
    ? m.rows.map(rowHtml).join('')
    : `<div class="island-empty">${esc(window.i18n.t('island_empty'))}</div>`;
  document.getElementById('rowsBg').innerHTML = m.backgroundRows.map(rowHtml).join('');

  // Focus on click — interactive rows only (headless: no click-focus).
  document.querySelectorAll('#rows .row[data-session]').forEach((item) => {
    item.addEventListener('click', () => window.islandApi.focusSession(item.dataset.session));
  });

  const $gauge = document.getElementById('gaugeBlock');
  const five = usage && usage.fiveHour;
  if (five && typeof five.utilization === 'number') {
    const pct = Math.round(five.utilization);
    const $fill = document.getElementById('gaugeFill');
    $fill.style.width = `${Math.min(100, pct)}%`;
    $fill.className = 'gauge-fill' + (pct >= 80 ? ' hot' : pct >= 50 ? ' warn' : '');
    document.getElementById('gaugeLeft').textContent = `5H · ${pct}%`;
    const rem = five.resetsAt ? fmtRemaining(five.resetsAt) : '';
    document.getElementById('gaugeRight').textContent = rem
      ? window.i18n.t('island_reste', { t: rem }) : '';
    $gauge.style.display = '';
  } else {
    $gauge.style.display = 'none';
  }
}

// ── Hover machinery ──
let hovering = false;
function inRect(el, x, y, pad = 0) {
  const r = el.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
function setHover(next) {
  if (next === hovering) return;
  hovering = next;
  document.body.classList.toggle('expanded', hovering);
  window.islandApi.setHover(hovering);
}
document.addEventListener('mousemove', (e) => {
  const overPill = inRect(document.getElementById('pill'), e.clientX, e.clientY, 4);
  const overPanel = hovering && inRect(document.getElementById('panel'), e.clientX, e.clientY, 4);
  setHover(overPill || overPanel);
});
// Mouse left the window entirely (fast exit can skip the last mousemove).
document.addEventListener('mouseleave', () => setHover(false));
window.addEventListener('blur', () => setHover(false));

// Debounce rapid updates (same pattern as the old popover).
let refreshPending = null;
function scheduleRefresh() {
  if (refreshPending) return;
  refreshPending = setTimeout(() => { refreshPending = null; refresh(); }, 100);
}
window.islandApi.onUpdate(scheduleRefresh);
// Re-render every 30s so the "· N min" durations tick without session events.
setInterval(scheduleRefresh, 30000);
refresh();
```

- [ ] **Step 4 : Clés i18n**

Dans `i18n.js`, ajouter dans le bloc **fr** (près des clés `popover_*`) :
```js
island_empty: 'aucune session',
island_reste: 'reste {t}',
```
et dans le bloc **en** :
```js
island_empty: 'no sessions',
island_reste: '{t} left',
```

- [ ] **Step 5 : Vérification manuelle**

Run : `pkill -f "aby-claude-watcher" ; npm run dev` (avec le `islandEnabled: true` provisoire de la Task 2)
Attendu : LEDs des sessions en cours dans les ailes ; survol de la pilule → panneau se déplie ; liste + jauge ; clic sur une ligne → focus du terminal ; sortie → repli ; clics ailleurs traversent la fenêtre.

- [ ] **Step 6 : Tests + commit**

Run : `npm test`
Attendu : vert.

```bash
git add ui/island/ i18n.js
git commit -m "feat(island): renderer — LEDs par session, panneau au survol, focus, jauge 5h"
```

---

### Task 4: Suppression du popover, clic tray → fenêtre principale

**Files:**
- Delete: `preload-popover.js`, `ui/popover.html`, `ui/popover.js`
- Modify: `main.js`, `package.json` (`build.files`), `i18n.js`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `showMainWindow()` dans main.js (réutilisée par le clic tray) ; plus aucune référence `popover` dans le code.

- [ ] **Step 1 : Retirer le popover de `main.js`**

1. Supprimer `let popoverWindow;` (~ligne 164) et le bloc `window-all-closed` non-darwin qui le détruit (~lignes 306-309, garder le reste du handler).
2. Supprimer les envois `popover-update` dans le handler `session-updated` (~lignes 533-535), dans `set-language` (~lignes 584-586) et dans `debouncedUpdate` de `setupTray()` (~lignes 894-896) — les appels `island.sendUpdate()` ajoutés en Task 2 restent.
3. Supprimer les handlers IPC `popover-hide`, `popover-open-main`, `popover-quit`, `popover-resize` et les remplacer par rien — mais extraire d'abord le corps de `popover-open-main` en fonction :
```js
function showMainWindow() {
  if (!mainWindow) createWindow();
  else mainWindow.show();
  mainWindow.focus();
}
```
4. Supprimer les fonctions `createPopoverWindow()` et `togglePopover()` (+ `popoverToggleLock`), et l'appel `createPopoverWindow();` dans `app.whenReady`.
5. Dans `setupTray()` :
```js
tray.on('click', showMainWindow);
tray.on('right-click', showMainWindow);
```

- [ ] **Step 2 : Supprimer les fichiers et les références**

```bash
git rm preload-popover.js ui/popover.html ui/popover.js
```
Dans `package.json > build.files` : retirer `"preload-popover.js",`.
Dans `i18n.js` : retirer les clés `popover_header`, `popover_empty`, `popover_open`, `popover_quit`, `popover_quit_title` des deux blocs fr et en (vérifier d'abord avec `grep -rn "popover_" ui/ main.js` qu'il ne reste aucun usage).

- [ ] **Step 3 : Vérifier qu'aucune référence ne subsiste**

Run : `grep -rn "popover" main.js preload*.js ui/*.js ui/*.html package.json | grep -v office`
Attendu : aucune sortie.

- [ ] **Step 4 : Vérification manuelle**

Run : `pkill -f "aby-claude-watcher" ; npm run dev`
Attendu : clic sur l'icône tray → la fenêtre principale s'ouvre/se montre (plus de popover) ; l'île fonctionne comme avant ; la jauge du tray est intacte.

- [ ] **Step 5 : Tests + commit**

Run : `npm test`
Attendu : vert.

```bash
git add main.js package.json i18n.js
git commit -m "feat(island): suppression du popover — le clic tray ouvre la fenêtre principale"
```

---

### Task 5: Toggle « Île » dans les réglages

**Files:**
- Modify: `config.js`, `main.js` (IPC `set-island-enabled`), `preload.js`, `ui/index.html` (section réglages General), `ui/renderer.js`, `i18n.js`

**Interfaces:**
- Consumes: `island.refresh(enabled)` (Task 2).
- Produces: `config.islandEnabled` (défaut `true`), `config.setIslandEnabled(value)`, IPC `set-island-enabled`, `window.api.setIslandEnabled(value)`.

- [ ] **Step 1 : Test config (qui échoue)**

Dans `test/config.test.js`, ajouter à la suite existante (mêmes helpers `test`/`assert` que le fichier) :
```js
test('islandEnabled defaults to true and toggles', () => {
  const c = config.get();
  assertEq(c.islandEnabled, true);
  config.setIslandEnabled(false);
  assertEq(config.get().islandEnabled, false);
  config.setIslandEnabled(true);
  assertEq(config.get().islandEnabled, true);
});
```
(Les helpers `test`/`assertEq` sont ceux déjà définis en tête de `test/config.test.js`.)

Run : `node test/config.test.js`
Attendu : FAIL (`islandEnabled` undefined / `setIslandEnabled` is not a function).

- [ ] **Step 2 : Implémenter dans `config.js`**

Dans l'objet `config` par défaut, après `backgroundSectionCollapsed: false,` :
```js
islandEnabled: true,  // dynamic island sur l'encoche (macOS à encoche uniquement)
```
Après `setBackgroundSectionCollapsed` :
```js
function setIslandEnabled(value) {
  config.islandEnabled = !!value;
  save();
}
```
Et l'ajouter au `module.exports`.

Run : `node test/config.test.js`
Attendu : PASS.

- [ ] **Step 3 : IPC + preload**

`main.js`, dans `setupIPC()` :
```js
ipcMain.handle('set-island-enabled', (_, value) => {
  config.setIslandEnabled(value);
  island.refresh(!!config.get().islandEnabled);
});
```
`preload.js`, dans le bloc `exposeInMainWorld` à côté de `setAutoLaunch` :
```js
setIslandEnabled: (value) => ipcRenderer.invoke('set-island-enabled', value),
```
Retirer aussi le `islandEnabled: true` provisoire ajouté à la main dans le config.json local en Task 2 (il est désormais le défaut).

- [ ] **Step 4 : UI réglages**

`ui/index.html`, dans le panneau General après la section `vibrancyToggle` (~ligne 178) :
```html
<div class="settings-section">
  <div class="settings-toggle-row">
    <div>
      <div class="settings-label" data-i18n="island_label">Dynamic island</div>
      <div class="settings-hint" data-i18n="island_hint">Session LEDs around the notch, expands on hover (notched Macs only)</div>
    </div>
    <button class="settings-toggle" id="islandToggle" role="switch" aria-checked="false" data-i18n-title="island_label" title="Dynamic island">
      <span class="settings-toggle-knob"></span>
    </button>
  </div>
</div>
```
`ui/renderer.js` — suivre exactement le pattern `autoLaunch` (variable d'état chargée depuis la config, listener sur le bouton, classe `on` + `aria-checked` dans la fonction de rendu des réglages) :
```js
let islandEnabled = true;                       // près de `let autoLaunch = false;`
islandEnabled = config.islandEnabled !== false; // là où autoLaunch est lu depuis la config
const islandBtn = document.getElementById('islandToggle');           // près du wiring autoLaunchToggle
if (islandBtn) islandBtn.addEventListener('click', toggleIsland);
// dans la fonction qui met à jour l'état visuel des toggles :
const ib = document.getElementById('islandToggle');
if (ib) { ib.classList.toggle('on', islandEnabled); ib.setAttribute('aria-checked', String(islandEnabled)); }
// à côté de toggleAutoLaunch :
function toggleIsland() {
  islandEnabled = !islandEnabled;
  window.api.setIslandEnabled(islandEnabled);
  const ib = document.getElementById('islandToggle');
  if (ib) { ib.classList.toggle('on', islandEnabled); ib.setAttribute('aria-checked', String(islandEnabled)); }
}
```
`i18n.js` — bloc fr :
```js
island_label: 'Dynamic island',
island_hint: "LEDs des sessions autour de l'encoche, se déplie au survol (Mac à encoche uniquement)",
```
bloc en :
```js
island_label: 'Dynamic island',
island_hint: 'Session LEDs around the notch, expands on hover (notched Macs only)',
```

- [ ] **Step 5 : Vérification manuelle**

Run : `pkill -f "aby-claude-watcher" ; npm run dev`
Attendu : l'île apparaît sans édition manuelle du config.json (défaut `true`) ; réglages → toggle off = l'île disparaît immédiatement ; on = elle revient.

- [ ] **Step 6 : Tests + commit**

Run : `npm test`
Attendu : vert.

```bash
git add config.js main.js preload.js ui/index.html ui/renderer.js i18n.js test/config.test.js
git commit -m "feat(island): toggle île dans les réglages (défaut on)"
```

---

### Task 6: Vérification de bout en bout (CDP + états forgés)

**Files:**
- Aucune création — vérification uniquement (fixes éventuels en commits séparés).

**Interfaces:**
- Consumes: workflow CDP documenté en mémoire (`reference_cdp_verification`) : `electron --remote-debugging-port`, fausses sessions headless (`sleep` + `session.json` entrypoint `sdk-cli`).

- [ ] **Step 1 : Lancer avec CDP**

Run : `pkill -f "aby-claude-watcher" ; npx electron . --dev --remote-debugging-port=9222`
Attendu : l'app tourne, `curl -s localhost:9222/json | grep -i island` liste la page island.

- [ ] **Step 2 : Vérifier chaque état visuellement (screenshots CDP sur la page island)**

Avec de vraies sessions Claude Code ouvertes + une session headless forgée :
1. Repliée : LEDs interactives à gauche, headless plus petite/terne à droite.
2. \> 4 sessions d'un côté → « +N ».
3. Session pending (déclencher une permission) → LED ambre qui pulse, île TOUJOURS repliée (jamais d'auto-expand).
4. Survol (Input.dispatchMouseEvent mousemove sur la pilule) → panneau déplié : rangées, états fr, durée « · N min » sur waiting/pending, section headless, jauge 5h avec « reste … ».
5. Clic sur une rangée → le terminal iTerm2 prend le focus.
6. Sortie de survol → repli, et un clic hors pilule traverse (vérifier qu'une fenêtre derrière reçoit le clic).
7. Réglages : toggle off/on.

- [ ] **Step 3 : Suite complète + état git propre**

Run : `npm test && git status --short`
Attendu : tests verts ; aucun fichier non commité inattendu.

- [ ] **Step 4 : Rapport à Paul**

Capture d'écran de l'île repliée + dépliée à l'appui. AUCUN push, AUCUN tag, AUCUNE release sans son accord explicite (règle globale).
