# Background Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Détecter les sessions Claude Code headless (`claude -p`, `entrypoint: "sdk-cli"`) et les afficher dans une section dédiée repliable sous les sessions interactives, silencieuse par défaut.

**Architecture:** Le watcher lit le champ `entrypoint` déjà présent dans `~/.claude/sessions/<pid>.json` et pose un flag `isBackground` sur la session (persisté, résistant au resume et au `/clear`). `setState()` supprime l'émission `session-waiting` pour ces sessions sauf cloche activée. Le renderer partitionne la liste en deux groupes (interactives puis background) avec un en-tête de section repliable, et neutralise le clic-focus.

**Tech Stack:** Electron (main + renderer vanilla JS), tests `node test/*.test.js` (runner maison, pas de framework).

**Spec:** `docs/superpowers/specs/2026-06-04-background-sessions-design.md`

**Référence terrain :** un session.json headless réel ressemble à
`{"pid":13244,"sessionId":"87bf…","cwd":"/Users/…/aby-agents","startedAt":1780583911496,"version":"2.1.162","kind":"interactive","entrypoint":"sdk-cli"}`
(NB : `kind` vaut `"interactive"` même en headless — c'est bien `entrypoint` le discriminant. Les sessions terminal ont `"entrypoint":"cli"`.)

**Garde-fous repo :** aucun nouveau module `.js` n'est créé par ce plan → pas de modif `package.json build.files`. Ne jamais `git push` (règle globale Paul). Pas de trailer `Co-Authored-By` dans les commits.

---

### Task 1: Watcher — flag `isBackground` (détection, persistance, restauration, migration)

**Files:**
- Modify: `watcher.js` (scan ~l.141/196/222, start ~l.50, persistSession ~l.829)
- Test: `test/watcher.test.js`

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `test/watcher.test.js`, étendre le helper `writeSessionJson` (l.236) pour accepter un entrypoint :

```js
function writeSessionJson(sessionsDir, pid, sessionId, cwd, updatedAt = Date.now(), entrypoint = 'cli') {
  const data = { pid, sessionId, cwd, startedAt: Date.now(), status: 'busy', updatedAt, entrypoint };
  fs.writeFileSync(path.join(sessionsDir, `${pid}.json`), JSON.stringify(data));
}
```

Puis ajouter une section avant le `runAll()` final :

```js
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
  // Écrit un session.json SANS champ entrypoint
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
  // scan() crée la session puis persistSession() — vérifier le config mock
  const saved = w.config.getSavedSessions()['PBG-id'];
  if (!saved) throw new Error('session not persisted');
  if (saved.isBackground !== true) throw new Error(`expected persisted isBackground=true, got ${saved.isBackground}`);
});

test('start(): restaure isBackground depuis config', () => {
  const config = makeMockConfig();
  config._data.sessions['RESTORED-bg'] = { stateName: 'waiting', isBackground: true, cwd: '/tmp/x', projectName: 'x' };
  const w = new SessionWatcher(config);
  w.scan = () => {}; // pas de scan filesystem
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
```

Note : les 4 tests `scan:` existants utilisent `writeSessionJson` sans 6e argument → ils passent désormais `entrypoint: 'cli'`, ce qui ne change pas leur comportement (sessions interactives).

- [ ] **Step 2: Vérifier l'échec**

Run: `node test/watcher.test.js`
Expected: les 6 nouveaux tests FAIL (`expected isBackground=true, got undefined`), les anciens PASS.

- [ ] **Step 3: Implémenter dans watcher.js**

a) Dans `scan()`, l.141, destructurer et calculer le flag :

```js
const { pid, sessionId, cwd, startedAt, entrypoint } = data;

if (!sessionId) continue;

// Headless (`claude -p`, SDK, …) write entrypoint "sdk-cli"; interactive
// terminals write "cli". Unknown future entrypoints default to background
// (read-only + silent is the safe degradation). Absent field = old Claude
// Code version → keep the historical interactive behavior.
const isBackground = !!entrypoint && entrypoint !== 'cli';
```

b) Dans la création de session (l.196, objet `this.sessions.set(effectiveId, {…})`), ajouter après `permissionMode:` :

```js
isBackground,
```

c) Dans la branche update (l.222, après `session.cwd = cwd;`) :

```js
session.isBackground = isBackground;
```

d) Dans `start()`, l.50, dans l'objet restauré (après `terminalId:`) :

```js
isBackground: !!data.isBackground,
```

e) Dans `persistSession()` (l.829), ajouter au payload :

```js
isBackground: !!session.isBackground,
```

(`migrateSession` réutilise l'objet session en place → le flag survit sans modification, le test le verrouille.)

- [ ] **Step 4: Vérifier que tout passe**

Run: `node test/watcher.test.js`
Expected: tous PASS (anciens + 6 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "feat(watcher): detect headless sessions via session.json entrypoint"
```

---

### Task 2: Watcher — notifications silencieuses pour les sessions background

**Files:**
- Modify: `watcher.js` (`setState`, bloc notification ~l.811-819)
- Test: `test/watcher.test.js`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `test/watcher.test.js` :

```js
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
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node test/watcher.test.js`
Expected: le premier nouveau test FAIL (l'event est émis), les deux autres PASS déjà (ne pas s'en inquiéter — ils verrouillent le non-régression).

- [ ] **Step 3: Implémenter dans setState()**

Remplacer le bloc notification (l.811-819) :

```js
    // Trigger notification on waiting/pending — with 30s cooldown to avoid spam
    // Handles: stale timer → waiting, end_turn → waiting, permission hook → pending
    if (!isInitial && (newState.name === 'waiting' || newState.name === 'pending')) {
      // Background (headless) sessions are driven by their own channels
      // (Telegram workers, cron, …) — stay silent unless the user explicitly
      // enabled this session's bell. Deliberate exception to the v1.7.2 rule
      // "compact toast shows even with bell off".
      let muted = false;
      if (session.isBackground && this.config) {
        const p = this.config.getNotificationPrefs(sessionId);
        muted = !p.modal && !p.sound;
      }
      if (!muted) {
        const lastNotif = this.lastNotifTime.get(sessionId) || 0;
        if (Date.now() - lastNotif > 30000) {
          this.lastNotifTime.set(sessionId, Date.now());
          this.emit('session-waiting', session);
        }
      }
    }
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `node test/watcher.test.js`
Expected: tous PASS.

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "feat(watcher): mute waiting/pending notifications for background sessions"
```

---

### Task 3: main.js — exposer `isBackground` au renderer

**Files:**
- Modify: `main.js` (`serializeSession`, l.484-510)

(Pas de harnais de test pour main.js — changement d'une ligne, vérifié par la vérif manuelle de la Task 8.)

- [ ] **Step 1: Ajouter le champ**

Dans l'objet retourné par `serializeSession()` (après `cwd: session.cwd,`) :

```js
    isBackground: !!session.isBackground,
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "feat(main): expose isBackground in serialized sessions"
```

---

### Task 4: config.js — réglage `backgroundSectionCollapsed`

**Files:**
- Modify: `config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `test/config.test.js` (avant le bilan final passed/failed) :

```js
console.log('\nbackgroundSectionCollapsed:');
test('defaults to false', () => {
  assertEq(!!config.get().backgroundSectionCollapsed, false);
});
test('setter coerces to bool', () => {
  config.setBackgroundSectionCollapsed(1);
  assertEq(config.get().backgroundSectionCollapsed, true);
  config.setBackgroundSectionCollapsed(false);
  assertEq(config.get().backgroundSectionCollapsed, false);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node test/config.test.js`
Expected: FAIL avec `config.setBackgroundSectionCollapsed is not a function`.

- [ ] **Step 3: Implémenter**

a) Dans le défaut `config` (l.11-28), après `customNames: {},` :

```js
  backgroundSectionCollapsed: false, // "Background" section folded in the session list
```

b) Après `setCompactMode` (l.78-81) :

```js
function setBackgroundSectionCollapsed(value) {
  config.backgroundSectionCollapsed = !!value;
  save();
}
```

c) L'ajouter au `module.exports` (après `setCompactMode,`) :

```js
  setBackgroundSectionCollapsed,
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `node test/config.test.js`
Expected: tous PASS.

- [ ] **Step 5: Commit**

```bash
git add config.js test/config.test.js
git commit -m "feat(config): persist background section collapsed state"
```

---

### Task 5: IPC + preload — `set-background-collapsed`

**Files:**
- Modify: `main.js` (`setupIPC`, à côté de `set-view-mode` l.279)
- Modify: `preload.js` (à côté de `setViewMode` l.19)

- [ ] **Step 1: Handler IPC dans main.js**

Après le handler `set-view-mode` :

```js
  ipcMain.handle('set-background-collapsed', (_, value) => {
    config.setBackgroundSectionCollapsed(value);
    return true;
  });
```

- [ ] **Step 2: Exposer dans preload.js**

Après la ligne `setViewMode:` :

```js
  setBackgroundCollapsed: (value) => ipcRenderer.invoke('set-background-collapsed', value),
```

- [ ] **Step 3: Commit**

```bash
git add main.js preload.js
git commit -m "feat(ipc): set-background-collapsed channel"
```

---

### Task 6: i18n — label de section

**Files:**
- Modify: `i18n.js`

- [ ] **Step 1: Ajouter la clé dans les deux langues**

Bloc `fr` (après `state_error: 'Erreur',` l.12) :

```js
      background_section: 'Background ({n})',
```

Bloc `en` (après son `state_error`, ~l.155) :

```js
      background_section: 'Background ({n})',
```

(Même libellé dans les deux langues — « Background » est le terme que Paul utilise ; le ⚙ est dans le HTML, pas dans la chaîne.)

- [ ] **Step 2: Commit**

```bash
git add i18n.js
git commit -m "feat(i18n): background section label"
```

---

### Task 7: Renderer — section dédiée, repli, focus neutralisé, drag par groupe

**Files:**
- Modify: `ui/renderer.js`
- Modify: `ui/styles.css`

(Pas de harnais renderer — vérification manuelle en Task 8. Garder les modifs minimales et localisées.)

- [ ] **Step 1: État + init**

En haut de `ui/renderer.js`, après `let draggedId = null;` (l.37) :

```js
let backgroundCollapsed = false; // "Background" section folded — persisted in config
```

Dans `init()`, après `sessionOrder = config.sessionOrder || [];` (l.86) :

```js
  backgroundCollapsed = !!config.backgroundSectionCollapsed;
```

- [ ] **Step 2: Partition + en-tête de section dans fullRender()**

Remplacer `fullRender()` (l.660-665) :

```js
function fullRender() {
  const sorted = getRenderableSessions();
  const htmlFn = viewItemHTML();
  // Interactive sessions first, headless (claude -p) below under a
  // collapsible "Background" divider. Header only in grid/compact —
  // micro is too small, the partition order alone is enough there.
  const interactive = sorted.filter(s => !s.isBackground);
  const background = sorted.filter(s => s.isBackground);
  let html = interactive.map(s => htmlFn(s)).join('');
  if (background.length > 0) {
    if (viewMode !== 'micro') html += backgroundSectionHeaderHTML(background.length);
    if (viewMode === 'micro' || !backgroundCollapsed) {
      html += background.map(s => htmlFn(s)).join('');
    }
  }
  viewContainer().innerHTML = html;
  reapplyAllBells();
}

function backgroundSectionHeaderHTML(count) {
  return `
    <div class="bg-section-header${backgroundCollapsed ? ' collapsed' : ''}" onclick="toggleBackgroundSection()">
      <span class="bg-section-chevron">${backgroundCollapsed ? '▸' : '▾'}</span>
      <span class="bg-section-label">⚙ ${esc(t('background_section', { n: count }))}</span>
    </div>
  `;
}

function toggleBackgroundSection() {
  backgroundCollapsed = !backgroundCollapsed;
  window.api.setBackgroundCollapsed(backgroundCollapsed);
  render();
}
```

- [ ] **Step 3: updateSession — ignorer les sessions repliées**

Dans `updateSession(s)` (l.667), juste après la déclaration de `existing` :

```js
  if (!existing && s.isBackground && backgroundCollapsed && viewMode !== 'micro') {
    // Collapsed background session: not in the DOM by design. Without this
    // guard the `!existing` branch below would fullRender() on every token
    // update of every hidden headless session.
    updateStatusBar();
    return;
  }
```

- [ ] **Step 4: Neutraliser le focus**

Remplacer `handleFocus` (l.933-935) :

```js
function handleFocus(sessionId) {
  const s = sessions.get(sessionId);
  // Headless sessions have no terminal to focus — covers card click,
  // micro item click and toast click in one place.
  if (s && s.isBackground) return;
  window.api.focusTerminal(sessionId);
}
```

- [ ] **Step 5: Classe CSS sur les items background**

Dans `cardHTML` (l.787) : `class="card"` → `class="card${s.isBackground ? ' bg-session' : ''}"`.
Dans `compactItemHTML` (l.890) : `class="compact-card"` → `class="compact-card${s.isBackground ? ' bg-session' : ''}"`.
Dans `microItemHTML` (l.858) : `class="micro-item"` → `class="micro-item${s.isBackground ? ' bg-session' : ''}"`.

- [ ] **Step 6: Drag-and-drop confiné à chaque groupe**

Dans `onDragOver` (l.1397), après `if (!target || target.dataset.session === draggedId) return;` :

```js
  // No cross-section drag: the group is dictated by isBackground, not by position.
  const ds = sessions.get(draggedId);
  const ts = sessions.get(target.dataset.session);
  if (!ds || !ts || !!ds.isBackground !== !!ts.isBackground) return;
```

- [ ] **Step 7: Styles**

Dans `ui/styles.css`, à la fin du fichier (réutiliser les variables CSS existantes du `:root` si elles existent — vérifier `grep -n ":root" ui/styles.css` — sinon garder les fallbacks ci-dessous) :

```css
/* ═══ Background (headless) section ═══ */
.bg-section-header {
  grid-column: 1 / -1; /* span full width in grid & compact (both display:grid) */
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px 2px;
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  user-select: none;
}
.bg-section-header:hover { color: #d1d5db; }
.bg-section-chevron { font-size: 9px; }
.card.bg-session,
.compact-card.bg-session,
.micro-item.bg-session { cursor: default; }
```

- [ ] **Step 8: Lancer la suite complète (sanity)**

Run: `npm test`
Expected: tous PASS (le renderer n'est pas couvert, mais aucun test existant ne doit casser).

- [ ] **Step 9: Commit**

```bash
git add ui/renderer.js ui/styles.css
git commit -m "feat(ui): collapsible Background section for headless sessions"
```

---

### Task 8: Vérification manuelle + note CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (section Key decisions)

- [ ] **Step 1: Vérification manuelle dans l'app**

⚠️ Single-instance lock : quitter l'app de prod (icône tray → Quit, ou `pkill -f "Aby Claude Watcher"`) avant de lancer le dev, sinon `npm run dev` sort immédiatement.

```bash
npm run dev
```

Checklist (les workers Telegram aby-agents de Paul fournissent des sessions `sdk-cli` réelles en permanence ; sinon en générer une : `cd /tmp && claude -p "dis bonjour" &`) :

1. Les sessions headless apparaissent sous l'en-tête « ⚙ Background (N) », sous les interactives — en grid ET en compact.
2. Cliquer l'en-tête replie/déplie ; relancer l'app → l'état replié est conservé.
3. Clic sur une carte background → aucun focus terminal (les cartes interactives focusent toujours).
4. Renommer une carte background → le nom persiste.
5. Une session background qui passe en waiting (worker qui finit son tour) ne déclenche NI toast NI son, même en vue compacte. Activer sa cloche → le toast revient.
6. Drag d'une carte interactive : impossible de la déposer dans la section background (et inversement).
7. Micro view : les sessions background sont listées après les interactives, sans en-tête, clic inerte.
8. Aucune régression sur les sessions interactives (focus, toast compact avec cloche off, bells).

- [ ] **Step 2: Documenter la décision dans CLAUDE.md**

Ajouter à la table « States » rien ; ajouter dans « Key decisions » :

```markdown
- Headless sessions (`session.json entrypoint !== "cli"`) → `isBackground`: dedicated collapsible UI section below interactive ones, no click-focus, notifications muted unless the per-session bell is on (deliberate exception to the v1.7.2 compact-toast rule)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record background sessions design decision"
```

---

## Couverture spec → tasks

| Exigence spec | Task |
|---|---|
| Détection `entrypoint`, défaut interactif si absent | 1 |
| Persistance + restauration + survie `/clear` | 1 |
| Notifications muettes sauf cloche | 2 |
| `serializeSession` expose le flag | 3 |
| `backgroundSectionCollapsed` config | 4, 5 |
| Section sous les interactives, grid + compact, repliable | 6, 7 |
| Pas de clic-focus, lecture seule | 7 |
| Drag confiné par groupe | 7 |
| Renommage/cloche persistants | déjà acquis (sessionId stable), vérifié en 8 |
| Pas de nouveau module → build.files OK | garde-fou en tête de plan |
