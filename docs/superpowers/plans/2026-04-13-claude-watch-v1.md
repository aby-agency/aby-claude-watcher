# Claude Watch v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Claude Watch from a functional v0 to a polished, feature-complete v1 with git branch display, cost estimation, keyboard shortcuts, status bar, dock badge, session launcher, auto-cleanup, and packaging.

**Architecture:** All features build on the existing Electron main/renderer/watcher architecture. New data (git branch, cost) is extracted in watcher.js and passed through existing IPC. UI features (shortcuts, status bar, context menu) are added in renderer.js/styles.css. Packaging uses electron-builder.

**Tech Stack:** Electron 41, Node.js, HTML/CSS/JS vanilla, electron-builder for packaging.

---

## File Structure

**Existing files to modify:**
- `watcher.js` — add git branch extraction, cost calculation, auto-cleanup
- `main.js` — add keyboard shortcuts, dock badge, new-session IPC, global shortcuts
- `preload.js` — expose new IPC methods
- `config.js` — add cleanup settings
- `ui/renderer.js` — status bar, context menu, search, message preview, keyboard nav
- `ui/styles.css` — status bar styles, context menu styles, search bar
- `ui/index.html` — status bar element, search input, context menu container

**New files to create:**
- `assets/icon.png` — app icon (1024x1024)
- `assets/icon.icns` — macOS app icon
- `build/` — electron-builder config and resources
- `.gitignore` — ignore node_modules, dist, .superpowers
- `CLAUDE.md` — project development instructions

---

### Task 0: Git Init + First Commit

**Files:**
- Create: `.gitignore`
- Create: `CLAUDE.md`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/invictorius/Project/ClaudeWatch
git init
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
dist/
.superpowers/
/config.json
*.log
.DS_Store
```

- [ ] **Step 3: Create CLAUDE.md**

```markdown
# Claude Watch

Electron desktop app monitoring Claude Code sessions in real-time.

## Dev

npm install
npm start        # production
npm run dev      # with devtools

## Architecture

- main.js: Electron main process, window, IPC, tray
- watcher.js: Session discovery (~/.claude/sessions/), JSONL parsing, state machine
- socket.js: Unix socket IPC for cc/cwa wrappers
- focus.js: Terminal focus (AppleScript iTerm2/Terminal/Warp)
- config.js: Persistence (debounced writes)
- preload.js: Context bridge
- ui/: Renderer (vanilla HTML/CSS/JS)

## States

thinking (purple) → running (green) → waiting (blue) → idle (grey) → completed (dark grey)
Stale timer: 8s no JSONL activity while thinking/running → waiting

## Key decisions

- JSONL tool_use events only written AFTER user approves permission
- Polling at 250ms (fs.watch unreliable on macOS)
- Config saves debounced 500ms, saveSync on shutdown
- Session completed only when: last-prompt event OR (session file gone + PID dead)
```

- [ ] **Step 4: Stage and commit**

```bash
git add -A
git commit -m "feat: Claude Watch v0 — session monitoring, notifications, tray, drag-drop"
```

---

### Task 1: Git Branch in Cards

**Files:**
- Modify: `watcher.js` — extract `gitBranch` from events
- Modify: `main.js:serializeSession` — add `gitBranch`
- Modify: `ui/renderer.js:cardHTML` — display branch
- Modify: `ui/styles.css` — branch pill style

- [ ] **Step 1: Add gitBranch to session data in watcher.js**

In the session object creation (around line 106), add `gitBranch: null` field.
In the restored sessions (around line 65), add `gitBranch: data.gitBranch || null`.
In `persistSession`, add `gitBranch: session.gitBranch`.

- [ ] **Step 2: Extract gitBranch from events in processEvent**

In `processEvent`, after the slug extraction:

```javascript
if (event.gitBranch) {
  session.gitBranch = event.gitBranch;
}
```

Also in `fastInitialLoad`, inside the event loop:

```javascript
if (event.gitBranch) {
  session.gitBranch = event.gitBranch;
}
```

- [ ] **Step 3: Add gitBranch to serializeSession in main.js**

```javascript
gitBranch: session.gitBranch || null,
```

- [ ] **Step 4: Display branch in cardHTML in renderer.js**

Replace the Model detail block in cardHTML with a 3-column grid showing Model, Branch, Tokens:

```javascript
<div class="card-details">
  <div class="detail">
    <span class="detail-label">Outil</span>
    <span class="detail-value">${(stateName === 'running' || stateName === 'thinking') ? toolPill(s.lastTool) : toolPill(null)}</span>
  </div>
  <div class="detail">
    <span class="detail-label">Durée</span>
    <span class="detail-value ...">${...}</span>
  </div>
  <div class="detail">
    <span class="detail-label">Modèle</span>
    <span class="detail-value">${formatModel(s.model)}</span>
  </div>
  <div class="detail">
    <span class="detail-label">Branche</span>
    <span class="detail-value branch-value">${esc(s.gitBranch || '—')}</span>
  </div>
  <div class="detail">
    <span class="detail-label">Tokens</span>
    <span class="detail-value">${tokens}</span>
  </div>
  <div class="detail">
    <span class="detail-label">Coût</span>
    <span class="detail-value">${formatCost(s.tokens, s.model)}</span>
  </div>
</div>
```

- [ ] **Step 5: Add branch CSS**

```css
.branch-value {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 6: Commit**

```bash
git add watcher.js main.js ui/renderer.js ui/styles.css
git commit -m "feat: display git branch in session cards"
```

---

### Task 2: Cost Estimation

**Files:**
- Modify: `ui/renderer.js` — add `formatCost` function

- [ ] **Step 1: Add formatCost function in renderer.js**

Add after `formatTokens`:

```javascript
function formatCost(tokens, model) {
  if (!tokens) return '—';
  const input = tokens.input || 0;
  const output = tokens.output || 0;
  if (input === 0 && output === 0) return '—';

  // Pricing per 1M tokens (USD) — approximate
  const pricing = {
    'opus': { input: 15, output: 75 },
    'sonnet': { input: 3, output: 15 },
    'haiku': { input: 0.25, output: 1.25 },
  };

  let tier = pricing.sonnet; // default
  if (model) {
    const m = model.toLowerCase();
    if (m.includes('opus')) tier = pricing.opus;
    else if (m.includes('haiku')) tier = pricing.haiku;
    else if (m.includes('sonnet')) tier = pricing.sonnet;
  }

  const cost = (input * tier.input + output * tier.output) / 1000000;
  if (cost < 0.01) return '<$0.01';
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(1)}`;
}
```

- [ ] **Step 2: Add cost to cardHTML**

Already included in Task 1 Step 4 card details grid.

- [ ] **Step 3: Commit**

```bash
git add ui/renderer.js
git commit -m "feat: display estimated cost per session"
```

---

### Task 3: Status Bar

**Files:**
- Modify: `ui/index.html` — add status bar element
- Modify: `ui/styles.css` — status bar styles
- Modify: `ui/renderer.js` — compute and update stats

- [ ] **Step 1: Add status bar HTML in index.html**

Before `<script src="renderer.js">`, add:

```html
<!-- Status bar -->
<div class="status-bar" id="statusBar">
  <span class="status-item" id="statActive">0 actives</span>
  <span class="status-sep">·</span>
  <span class="status-item" id="statWaiting">0 en attente</span>
  <span class="status-sep">·</span>
  <span class="status-item" id="statTokens">0 tokens</span>
  <span class="status-sep">·</span>
  <span class="status-item" id="statCost">$0.00</span>
</div>
```

- [ ] **Step 2: Add status bar CSS**

```css
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
  padding-left: 96px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 24px;
}

.status-sep {
  color: var(--border);
}
```

Update `.content` height to account for status bar:
```css
height: calc(100vh - 45px - 24px);
```

- [ ] **Step 3: Add updateStatusBar function in renderer.js**

```javascript
function updateStatusBar() {
  const all = Array.from(sessions.values());
  const active = all.filter(s => !['completed', 'idle'].includes(s.state.name));
  const waiting = all.filter(s => s.state.name === 'waiting');
  const totalTokens = all.reduce((sum, s) => sum + (s.tokens?.input || 0) + (s.tokens?.output || 0), 0);

  document.getElementById('statActive').textContent = `${active.length} active${active.length !== 1 ? 's' : ''}`;
  document.getElementById('statWaiting').textContent = `${waiting.length} en attente`;
  document.getElementById('statTokens').textContent = `${formatTokens({ input: totalTokens, output: 0 })} tokens`;

  // Total cost across all sessions
  let totalCost = 0;
  for (const s of all) {
    const input = s.tokens?.input || 0;
    const output = s.tokens?.output || 0;
    const model = s.model || '';
    let rate = { input: 3, output: 15 }; // sonnet default
    if (model.includes('opus')) rate = { input: 15, output: 75 };
    else if (model.includes('haiku')) rate = { input: 0.25, output: 1.25 };
    totalCost += (input * rate.input + output * rate.output) / 1000000;
  }
  document.getElementById('statCost').textContent = totalCost < 0.01 ? '$0.00' : `$${totalCost.toFixed(2)}`;
}
```

Call `updateStatusBar()` at the end of `render()`, `updateSession()`, and `removeSessionFromDOM()`.

- [ ] **Step 4: Commit**

```bash
git add ui/index.html ui/styles.css ui/renderer.js
git commit -m "feat: add status bar with active count, tokens, and cost"
```

---

### Task 4: Message Preview in Cards

**Files:**
- Modify: `watcher.js` — extract last assistant text
- Modify: `main.js:serializeSession` — add `lastMessage`
- Modify: `ui/renderer.js:cardHTML` — display preview
- Modify: `ui/styles.css` — preview style

- [ ] **Step 1: Add lastMessage to session data in watcher.js**

In session object creation, add `lastMessage: null`.
In restored sessions, add `lastMessage: data.lastMessage || null`.
In `persistSession`, add `lastMessage: session.lastMessage`.

- [ ] **Step 2: Extract last message text in processAssistantEvent**

After the model extraction:

```javascript
const textBlock = content.find(c => c.type === 'text' && c.text);
if (textBlock) {
  session.lastMessage = textBlock.text.slice(0, 120);
}
```

- [ ] **Step 3: Add to serializeSession in main.js**

```javascript
lastMessage: session.lastMessage || null,
```

- [ ] **Step 4: Display in cardHTML**

After the state badge, before card-details:

```javascript
${s.lastMessage ? `<div class="card-preview">${esc(s.lastMessage)}</div>` : ''}
```

- [ ] **Step 5: Add preview CSS**

```css
.card-preview {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-top: 8px;
  max-height: 32px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
```

- [ ] **Step 6: Commit**

```bash
git add watcher.js main.js ui/renderer.js ui/styles.css
git commit -m "feat: show last assistant message preview in cards"
```

---

### Task 5: Keyboard Shortcuts

**Files:**
- Modify: `main.js` — register global shortcuts
- Modify: `ui/renderer.js` — keyboard navigation in renderer

- [ ] **Step 1: Add keyboard handler in renderer.js**

In `init()`, add:

```javascript
document.addEventListener('keydown', (e) => {
  // Cmd+1-9: focus nth session
  if (e.metaKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault();
    const sorted = getSortedSessions();
    const idx = parseInt(e.key) - 1;
    if (sorted[idx]) handleFocus(sorted[idx].sessionId);
  }

  // Cmd+F: focus search
  if (e.metaKey && e.key === 'f') {
    e.preventDefault();
    const search = document.getElementById('searchInput');
    if (search) search.focus();
  }

  // Cmd+G/L: toggle grid/list
  if (e.metaKey && e.key === 'g') {
    e.preventDefault();
    setView(viewMode === 'grid' ? 'list' : 'grid');
  }

  // Cmd+P: toggle always-on-top
  if (e.metaKey && e.key === 'p') {
    e.preventDefault();
    togglePin();
  }

  // Escape: close modals/dropdowns
  if (e.key === 'Escape') {
    closeDropdown();
    closeAddModal();
    document.getElementById('settingsModal').style.display = 'none';
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add ui/renderer.js
git commit -m "feat: add keyboard shortcuts (Cmd+1-9 focus, Cmd+G toggle view, Cmd+P pin)"
```

---

### Task 6: Search / Filter Sessions

**Files:**
- Modify: `ui/index.html` — add search input in toolbar
- Modify: `ui/renderer.js` — filter logic
- Modify: `ui/styles.css` — search input style

- [ ] **Step 1: Add search input in toolbar (index.html)**

After session count span:

```html
<input type="text" class="search-input" id="searchInput" placeholder="Rechercher..." style="display:none;">
```

- [ ] **Step 2: Add search CSS**

```css
.search-input {
  padding: 3px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono);
  outline: none;
  width: 160px;
  -webkit-app-region: no-drag;
  transition: border-color var(--transition);
}

.search-input:focus {
  border-color: var(--state-running);
}

.search-input::placeholder {
  color: var(--text-muted);
}
```

- [ ] **Step 3: Add filter logic in renderer.js**

Add `let searchQuery = '';` at the top.

In `init()`:
```javascript
const $search = document.getElementById('searchInput');
$search.addEventListener('input', (e) => {
  searchQuery = e.target.value.toLowerCase();
  render();
});
// Show search on Cmd+F (already handled in keyboard shortcuts)
```

Modify `getSortedSessions` to filter:

```javascript
function getSortedSessions() {
  let arr = Array.from(sessions.values());

  // Filter by search query
  if (searchQuery) {
    arr = arr.filter(s =>
      s.projectName.toLowerCase().includes(searchQuery) ||
      (s.slug || '').toLowerCase().includes(searchQuery) ||
      (s.gitBranch || '').toLowerCase().includes(searchQuery)
    );
  }

  // ... rest of sort logic
}
```

Update the Cmd+F shortcut to toggle the search input visibility:
```javascript
if (e.metaKey && e.key === 'f') {
  e.preventDefault();
  const search = document.getElementById('searchInput');
  search.style.display = search.style.display === 'none' ? 'block' : 'none';
  if (search.style.display !== 'none') search.focus();
  else { search.value = ''; searchQuery = ''; render(); }
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/index.html ui/renderer.js ui/styles.css
git commit -m "feat: add session search/filter (Cmd+F)"
```

---

### Task 7: Right-Click Context Menu

**Files:**
- Modify: `ui/renderer.js` — context menu logic
- Modify: `ui/styles.css` — context menu styles
- Modify: `ui/index.html` — context menu container

- [ ] **Step 1: Add context menu HTML in index.html**

Before the script tag:

```html
<div class="context-menu" id="contextMenu" style="display:none;"></div>
```

- [ ] **Step 2: Add context menu CSS**

```css
.context-menu {
  position: fixed;
  z-index: 300;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition);
}

.context-menu-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.context-menu-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 8px;
}
```

- [ ] **Step 3: Add context menu logic in renderer.js**

```javascript
function showContextMenu(e, sessionId) {
  e.preventDefault();
  const s = sessions.get(sessionId);
  if (!s) return;
  const sid = escAttr(sessionId);
  const menu = document.getElementById('contextMenu');
  const stateName = s.state.name;

  let items = `
    <div class="context-menu-item" onclick="handleFocus('${sid}'); hideContextMenu();">${ICONS.terminal} Focus terminal</div>
  `;
  if (s.remoteUrl) {
    items += `<div class="context-menu-item" onclick="handleOpenRemote('${escAttr(s.remoteUrl)}'); hideContextMenu();">${ICONS.globe} Ouvrir remote</div>`;
  }
  items += `
    <div class="context-menu-item" onclick="toggleNotifDropdown(event, '${sid}'); hideContextMenu();">${ICONS.bell} Notifications</div>
    <div class="context-menu-sep"></div>
  `;
  if (stateName === 'completed') {
    items += `
      <div class="context-menu-item" onclick="handleResume('${sid}'); hideContextMenu();">${ICONS.play} Reprendre</div>
      <div class="context-menu-item" onclick="handleRemove('${sid}'); hideContextMenu();">${ICONS.x} Supprimer</div>
    `;
  }

  menu.innerHTML = items;
  menu.style.display = 'block';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10)}px`;
}

function hideContextMenu() {
  document.getElementById('contextMenu').style.display = 'none';
}

document.addEventListener('click', hideContextMenu);
```

Add `oncontextmenu="showContextMenu(event, '${sid}')"` to both card and list-item divs.

- [ ] **Step 4: Commit**

```bash
git add ui/index.html ui/renderer.js ui/styles.css
git commit -m "feat: add right-click context menu on session cards"
```

---

### Task 8: Dock Badge (Waiting Count)

**Files:**
- Modify: `main.js` — update dock badge on session-waiting

- [ ] **Step 1: Add dock badge update in main.js**

In `setupWatcher`, add a function that updates the badge:

```javascript
function updateDockBadge() {
  if (process.platform !== 'darwin') return;
  const waiting = watcher.getSessions().filter(s => s.state.name === 'waiting').length;
  app.dock.setBadge(waiting > 0 ? String(waiting) : '');
}
```

Call `updateDockBadge()` on debounced tray update (reuse the same debounce):

```javascript
const debouncedUpdate = () => {
  if (trayTimer) clearTimeout(trayTimer);
  trayTimer = setTimeout(() => {
    updateTrayMenu();
    updateDockBadge();
  }, 300);
};
```

- [ ] **Step 2: Clear badge when window is focused**

```javascript
mainWindow.on('focus', () => {
  if (process.platform === 'darwin') app.dock.setBadge('');
});
```

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: show waiting session count as dock badge"
```

---

### Task 9: Launch New Session from App

**Files:**
- Modify: `main.js` — IPC handler for launching sessions
- Modify: `preload.js` — expose launch method
- Modify: `ui/renderer.js` — update add-session modal
- Modify: `ui/index.html` — new session modal fields
- Modify: `focus.js` — add `launchSession` function

- [ ] **Step 1: Add launchSession to focus.js**

```javascript
function launchSession(cwd) {
  const dir = sanitizePath(cwd);
  if (!dir) return Promise.reject(new Error('Invalid path'));

  if (process.platform === 'darwin') {
    return runAppleScript(`
      tell application "iTerm2"
        activate
        tell current window
          create tab with default profile
          tell current session
            write text "cd ${escapeForAppleScript(dir)} && claude"
          end tell
        end tell
      end tell
    `);
  }
  // fallback for other platforms...
  return Promise.resolve();
}

module.exports = { focusTerminal, resumeSession, launchSession };
```

- [ ] **Step 2: Add IPC handler in main.js**

```javascript
const { focusTerminal, resumeSession, launchSession } = require('./focus');

ipcMain.handle('launch-session', (_, cwd) => {
  return launchSession(cwd);
});
```

- [ ] **Step 3: Add to preload.js**

```javascript
launchSession: (cwd) => ipcRenderer.invoke('launch-session', cwd),
```

- [ ] **Step 4: Update add-session modal in index.html**

Add a "Nouvelle session" tab/button to the add-session modal with a directory picker.

- [ ] **Step 5: Add handler in renderer.js**

```javascript
function handleLaunchSession() {
  const cwd = document.getElementById('launchPath').value.trim();
  if (cwd) window.api.launchSession(cwd);
  closeAddModal();
}
```

- [ ] **Step 6: Commit**

```bash
git add focus.js main.js preload.js ui/renderer.js ui/index.html
git commit -m "feat: launch new Claude Code session from the app"
```

---

### Task 10: Auto-Cleanup Old Sessions

**Files:**
- Modify: `watcher.js` — add cleanup on start
- Modify: `config.js` — add cleanup settings

- [ ] **Step 1: Add cleanup config**

In `config.js`, add to defaults:
```javascript
cleanupDays: 7, // Remove completed sessions older than N days
```

- [ ] **Step 2: Add cleanup method in watcher.js**

In `start()`, after restoring sessions:

```javascript
this.cleanupOldSessions();
```

```javascript
cleanupOldSessions() {
  if (!this.config) return;
  const days = this.config.get().cleanupDays || 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const saved = this.config.getSavedSessions();
  for (const [id, data] of Object.entries(saved)) {
    if (data.stateName === 'completed' && data.endedAt) {
      if (new Date(data.endedAt).getTime() < cutoff) {
        this.config.deleteSession(id);
        this.sessions.delete(id);
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add watcher.js config.js
git commit -m "feat: auto-cleanup completed sessions older than 7 days"
```

---

### Task 11: App Icon

**Files:**
- Create: `assets/icon.png`
- Modify: `main.js` — set app icon

- [ ] **Step 1: Generate app icon**

Create a 512x512 icon programmatically using `nativeImage` or use a simple design tool. The icon should be a stylized monitor/clock hybrid in dark theme colors.

For now, set the dock icon using nativeImage in main.js:

```javascript
// In createWindow, after creating the window:
if (process.platform === 'darwin') {
  // Generate a simple app icon
  const iconCanvas = generateAppIcon();
  app.dock.setIcon(iconCanvas);
}
```

- [ ] **Step 2: Commit**

```bash
git add main.js assets/
git commit -m "feat: add custom app icon"
```

---

### Task 12: Packaging with electron-builder

**Files:**
- Modify: `package.json` — add build config
- Create: `build/entitlements.mac.plist` — macOS entitlements

- [ ] **Step 1: Install electron-builder**

```bash
npm install --save-dev electron-builder
```

- [ ] **Step 2: Add build config to package.json**

```json
{
  "build": {
    "appId": "com.claudewatch.app",
    "productName": "Claude Watch",
    "mac": {
      "category": "public.app-category.developer-tools",
      "target": ["dmg"],
      "icon": "assets/icon.png"
    },
    "dmg": {
      "title": "Claude Watch"
    },
    "files": [
      "main.js",
      "preload.js",
      "watcher.js",
      "socket.js",
      "focus.js",
      "config.js",
      "ui/**/*",
      "bin/**/*",
      "assets/**/*"
    ]
  },
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev",
    "build": "electron-builder --mac",
    "build:win": "electron-builder --win",
    "build:linux": "electron-builder --linux"
  }
}
```

- [ ] **Step 3: Build and test**

```bash
npm run build
```

Open the generated .dmg in `dist/`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add electron-builder packaging (dmg)"
```

---

### Task 13: Update README

**Files:**
- Modify: `readme.md` — update with v1 features

- [ ] **Step 1: Update readme.md**

Update the README to reflect all v1 changes:
- Single window with grid/list toggle (no widget)
- Git branch, cost, model display
- Keyboard shortcuts reference
- Status bar
- Remote control indicator
- Right-click context menu
- Drag & drop reorder
- Search
- Auto-cleanup
- Tray icon

- [ ] **Step 2: Commit**

```bash
git add readme.md
git commit -m "docs: update README for v1"
```

---

## Execution Order

Tasks can be parallelized in groups:

**Group 1 (foundation):** Task 0 (git init)
**Group 2 (data):** Tasks 1, 2, 4, 10 (git branch, cost, preview, cleanup — all watcher changes)
**Group 3 (UI):** Tasks 3, 5, 6, 7 (status bar, shortcuts, search, context menu)
**Group 4 (system):** Tasks 8, 9 (dock badge, launcher)
**Group 5 (ship):** Tasks 11, 12, 13 (icon, packaging, readme)
