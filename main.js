const { app, BrowserWindow, ipcMain, Notification, session, Tray, Menu, nativeImage, shell, screen, clipboard } = require('electron');
const { log } = require('./logger'); // first: initializes file logging + crash catching
const path = require('path');
const { SessionWatcher, STATES } = require('./watcher');
const { SocketServer } = require('./socket');
const { UsageMonitor } = require('./usage');
const { focusTerminal } = require('./focus');
const { checkForUpdates, downloadAndInstall, abortActiveDownload, GITHUB_OWNER, GITHUB_REPO, WEBSITE_URL } = require('./updater');
const config = require('./config');
const i18n = require('./i18n');
const { SubagentTracker, hasBlockingForegroundAgent } = require('./subagents');
const { trayGlance } = require('./tray-glance');
const island = require('./island');
const { gaugeColor, ringBitmap, dotBitmap, trayUsageLabel } = require('./ring-gauge');
const { isFocusActive } = require('./focus-state');

const subagentTracker = new SubagentTracker();

// Per-session subagents live at <projectDir>/<sessionId>/subagents/agent-*.jsonl.
// We don't re-derive <projectDir> from cwd because the Claude Code slug rule
// is more involved than a simple '/' → '-' (it mangles non-ASCII chars and
// merges sub-paths). Instead we lean on the watcher, which has already
// resolved the real JSONL path at watch time and stashed it on the session.
function sessionDirFor(session) {
  if (!session || !session.sessionId || !session.jsonlPath) return null;
  return path.join(path.dirname(session.jsonlPath), session.sessionId);
}

// A session blocked on a foreground subagent is busy (delegating), not waiting
// on the user — so its pending/orange state and notification are false positives.
function blockingForegroundAgent(session) {
  const dir = sessionDirFor(session);
  if (!dir) return false;
  return hasBlockingForegroundAgent(
    subagentTracker.snapshotForSession(dir, session.agentDispatches || new Map())
  );
}

// Effective display state. Only scans subagents when the raw state is pending
// (the only state the override can change), keeping the badge/tray cheap.
function effectiveStateName(session) {
  const name = session && session.state ? session.state.name : 'waiting';
  if (name === 'pending' && blockingForegroundAgent(session)) return 'running';
  return name;
}

// ─── Workflows multi-agents (tool Workflow) ───
// workflowActive : sessionId → Set(runId) vus "running" au dernier scan. Sert
// d'amorçage au tick ET de mémoire de transition : un run découvert déjà
// completed (watcher démarré après la fin) n'y entre jamais dans workflowActive
// → pas de notif rétroactive (gate activeRuns.has(runId) dans le tick).
// notifiedWorkflowRuns : garde one-shot par session+runId (belt-and-suspenders ;
// un run ne se termine qu'une fois), keyé par sessionId pour que session-removed
// puisse purger toute l'entrée d'un coup.
const WORKFLOW_TICK_MS = 2000;
const workflowActive = new Map();
const notifiedWorkflowRuns = new Map(); // sessionId → Set(runId) déjà notifiés

// Permissions get approved within seconds when the user is already at the
// keyboard — defer the pending sound and only ring if the session is still
// blocked when the timer fires. The toast stays immediate (visual is cheap).
const PENDING_SOUND_DELAY = 5000;
const pendingSoundTimers = new Map(); // sessionId → timeout

function schedulePendingSound(sessionId) {
  const prev = pendingSoundTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    pendingSoundTimers.delete(sessionId);
    // L'état pollé retarde de ~300ms sur le clic réel (flush JSONL + poll
    // 250ms) — relire le JSONL maintenant pour qu'une permission approuvée
    // juste avant le tir ne fasse pas sonner sur un état périmé.
    watcher.refreshSession(sessionId);
    const s = watcher.getSessions().find(x => x.sessionId === sessionId);
    const name = s && s.state && s.state.name;
    // waiting still needs the user (pending can collapse into end-of-turn)
    if ((name !== 'pending' && name !== 'waiting') || (s && blockingForegroundAgent(s))) {
      log.info(`[notif] sound skipped for ${sessionId.slice(0, 8)} — pending resolved in <${PENDING_SOUND_DELAY / 1000}s`);
      return;
    }
    log.info(`[notif] sound for ${sessionId.slice(0, 8)} — kind=pending (deferred)`);
    if (!isFocusActive()) {
      sendToRenderer('play-sound', { kind: 'pending', sessionId });
      emitNativeNotification(sessionId);
    } else {
      log.info(`[notif] suppressed sound/banner for ${sessionId.slice(0, 8)} — Focus active`);
    }
  }, PENDING_SOUND_DELAY);
  pendingSoundTimers.set(sessionId, timer);
}

// Native macOS banner — co-located with the themed sound so it inherits the
// same `prefs.sound` gating, the 5s pending defer, and the fresh re-read at
// fire time. No action buttons (focus.js exposes only focusTerminal); silent
// because the themed sound already handles audio (no double-ding). Re-looks
// up the session by id on click so a stale captured object never drives focus.
function emitNativeNotification(sessionId) {
  const s = watcher.getSessions().find(x => x.sessionId === sessionId);
  if (!s) return;
  const title = config.getCustomName(sessionId) || s.projectName || 'Claude Code';
  const pending = s.state && s.state.name === 'pending';
  const body = pending ? i18n.t('notif_body_pending') : i18n.t('notif_body_waiting');
  const n = new Notification({ title, body, silent: true });
  n.on('click', () => {
    const fresh = watcher.getSessions().find(x => x.sessionId === sessionId);
    if (fresh) focusTerminal(fresh);
  });
  n.show();
}

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
    log.info(`[notif] sound for ${session.sessionId.slice(0, 8)} — kind=workflow-done`);
    sendToRenderer('play-sound', { kind: 'workflow-done', sessionId: session.sessionId });
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
    try {
      const session = sessions.find(s => s.sessionId === sessionId);
      const dir = session ? sessionDirFor(session) : null;
      if (!dir) { workflowActive.delete(sessionId); continue; }

      const all = subagentTracker.workflowsForSession(dir);
      const notified = notifiedWorkflowRuns.get(sessionId) || new Set();
      for (const wf of all) {
        if (wf.status === 'completed' && activeRuns.has(wf.runId) && !notified.has(wf.runId)) {
          notified.add(wf.runId);
          notifiedWorkflowRuns.set(sessionId, notified);
          notifyWorkflowDone(session, wf);
        }
      }
      // serializeSession remet à jour workflowActive (ou la session en sort si
      // plus aucun run actif) et pousse le badge frais au renderer.
      workflowActive.delete(sessionId);
      sendToRenderer('session-updated', serializeSession(session));
    } catch (e) {
      log.error('[workflow] tick failed for ' + sessionId.slice(0, 8) + ':', e.message);
      continue;
    }
  }
}

let mainWindow;
let watcher;
let socketServer;
let usageMonitor;
let tray;
let currentViewMode = 'grid';
// Latest usage snapshot (from usageMonitor 'update'), kept for the tray glance
// — usageMonitor itself only pushes to the renderer, it doesn't retain state.
let lastUsage = null;
const MICRO_DEFAULT_BOUNDS = { width: 260, height: 200 };

// Window transparency state. The window is fully opaque while focused or
// hovered, and drops to config.windowOpacity when idle — but only when the
// feature is enabled. See applyWindowOpacity().
let windowFocused = true;
let windowHovered = false;

function applyWindowOpacity() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const conf = config.get();
  if (!conf.windowTransparencyEnabled) {
    mainWindow.setOpacity(1);
    return;
  }
  const active = windowFocused || windowHovered;
  mainWindow.setOpacity(active ? 1 : (conf.windowOpacity ?? 0.85));
}

// EXPERIMENTAL: real macOS vibrancy ("Liquid Glass"). Off by default — known
// unstable on macOS Tahoe. Applied only at window creation (no hot recreate);
// toggling the setting requires an app restart to take effect. When the flag
// is false, `base` is returned untouched — the nominal opaque path never
// changes shape because of this feature's existence.
function windowOptsForVibrancy(base) {
  if (!config.get().vibrancyExperimental) return base;
  return {
    ...base,
    vibrancy: 'hud',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
  };
}

function createWindow() {
  const conf = config.get();
  const initialMicro = (conf.viewMode === 'micro');
  currentViewMode = initialMicro ? 'micro' : (conf.viewMode || 'grid');
  const bounds = initialMicro
    ? (config.getMicroWindowBounds() || MICRO_DEFAULT_BOUNDS)
    : config.getWindowBounds();

  const opts = {
    width: initialMicro ? MICRO_DEFAULT_BOUNDS.width : 900,
    height: initialMicro ? MICRO_DEFAULT_BOUNDS.height : 650,
    minWidth: initialMicro ? 200 : 400,
    minHeight: initialMicro ? 100 : 300,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    alwaysOnTop: conf.alwaysOnTop || false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  // Restore saved window position and size, clamped to current displays
  if (bounds) {
    const displays = screen.getAllDisplays();
    const visible = displays.some(d => {
      const wa = d.workArea;
      return bounds.x < wa.x + wa.width && bounds.x + bounds.width > wa.x &&
             bounds.y < wa.y + wa.height && bounds.y + bounds.height > wa.y;
    });
    if (visible) {
      opts.x = bounds.x;
      opts.y = bounds.y;
    }
    opts.width = bounds.width;
    opts.height = bounds.height;
  }

  mainWindow = new BrowserWindow(windowOptsForVibrancy(opts));

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Open devtools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (_, code, desc) => {
    log.error('Failed to load:', code, desc);
  });

  // Save window bounds on move/resize — into the slot matching the current view
  const saveBounds = () => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const b = mainWindow.getBounds();
    if (currentViewMode === 'micro') {
      config.setMicroWindowBounds(b);
    } else {
      config.setWindowBounds(b);
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('focus', () => {
    if (process.platform === 'darwin') app.dock.setBadge('');
    windowFocused = true;
    applyWindowOpacity();
  });

  mainWindow.on('blur', () => {
    windowFocused = false;
    applyWindowOpacity();
  });

  // Apply the saved opacity once the window is ready to paint
  mainWindow.once('ready-to-show', () => {
    windowFocused = mainWindow.isFocused();
    applyWindowOpacity();
  });

  // On macOS, clicking the red close button should HIDE the window (stay in tray)
  // rather than destroy it — true "tray-only" app behavior when dismissed
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !app._isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (app.dock) app.dock.hide();
    }
  });

  mainWindow.on('show', () => {
    if (process.platform === 'darwin' && app.dock) app.dock.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  else mainWindow.show();
  mainWindow.focus();
}

function setupWatcher() {
  watcher = new SessionWatcher(config);

  watcher.on('session-added', (session) => {
    sendToRenderer('session-added', serializeSession(session));
  });

  watcher.on('session-updated', (session) => {
    sendToRenderer('session-updated', serializeSession(session));
  });

  watcher.on('session-waiting', (session) => {
    // Busy on a foreground subagent → no bell, no sound (it's not waiting on you).
    if (blockingForegroundAgent(session)) {
      log.info(`[notif] suppressed for ${session.sessionId.slice(0, 8)} — blocked on foreground agent`);
      return;
    }
    const prefs = config.getNotificationPrefs(session.sessionId);
    const kind = session.state && session.state.name === 'pending' ? 'pending' : 'waiting';
    // Forensic trail: every emitted notif, with whether a sound goes out.
    log.info(`[notif] fired for ${session.sessionId.slice(0, 8)} — kind=${kind} sound=${prefs.sound ? 'on' : 'off'}`);
    // Always fire the visual event — the renderer gates by view mode.
    // Compact view shows the toast regardless of the bell; grid still requires it.
    sendToRenderer('show-notification', {
      sessionId: session.sessionId,
      projectName: session.projectName,
      customName: config.getCustomName(session.sessionId),
      slug: session.slug,
      kind,
    });
    if (prefs.sound) {
      if (kind === 'pending') {
        schedulePendingSound(session.sessionId);
      } else {
        log.info(`[notif] sound for ${session.sessionId.slice(0, 8)} — kind=${kind}`);
        if (!isFocusActive()) {
          sendToRenderer('play-sound', { kind, sessionId: session.sessionId });
          emitNativeNotification(session.sessionId);
        } else {
          log.info(`[notif] suppressed sound/banner for ${session.sessionId.slice(0, 8)} — Focus active`);
        }
      }
    }
  });

  watcher.on('session-removed', (sessionId) => {
    // Session partie → ses runs de workflow sont morts, on purge le suivi
    workflowActive.delete(sessionId);
    notifiedWorkflowRuns.delete(sessionId);
    const t = pendingSoundTimers.get(sessionId);
    if (t) { clearTimeout(t); pendingSoundTimers.delete(sessionId); }
    sendToRenderer('session-removed', sessionId);
  });

  watcher.start();
  setInterval(workflowTick, WORKFLOW_TICK_MS);
}

function setupSocket() {
  socketServer = new SocketServer();

  socketServer.on('register', (data) => {
    // cc wrapper registered a session — the watcher will pick it up
    // via the sessions dir scan. We store terminal info for later.
    // Find session by PID
    const sessions = watcher.getSessions();
    const session = sessions.find(s => s.pid === data.pid);
    if (session) {
      watcher.registerTerminal(session.sessionId, data.terminalApp, data.terminalId);
    } else {
      // Session not yet discovered — store for later matching
      socketServer._pendingRegistrations = socketServer._pendingRegistrations || [];
      socketServer._pendingRegistrations.push(data);
    }
  });

  socketServer.on('attach', (data) => {
    watcher.registerTerminal(data.sessionId, data.terminalApp, data.terminalId);
  });

  socketServer.on('permission-pending', (data) => {
    if (data.sessionId) watcher.markPending(data.sessionId, data.hookEvent, data.toolName, data.idle);
  });

  // Resolve pending registrations when sessions are discovered
  watcher.on('session-added', (session) => {
    const pending = socketServer._pendingRegistrations || [];
    const match = pending.find(p => p.pid === session.pid);
    if (match) {
      watcher.registerTerminal(session.sessionId, match.terminalApp, match.terminalId);
      socketServer._pendingRegistrations = pending.filter(p => p !== match);
    }
  });

  socketServer.start();
}

function setupUsageMonitor() {
  usageMonitor = new UsageMonitor();
  usageMonitor.on('update', (data) => {
    lastUsage = data;
    sendToRenderer('usage-update', data);
    // Usage ticks independently of session state changes — without this the
    // tray title (when showing a usage %, no attention pending) would go
    // stale between session events.
    refreshTrayGlance();
    island.sendUpdate();
  });
  usageMonitor.on('error', (code) => sendToRenderer('usage-error', code));
  usageMonitor.start();
}

function setupIPC() {
  ipcMain.handle('get-sessions', () => {
    return watcher.getSessions().map(serializeSession);
  });

  ipcMain.handle('get-config', () => {
    return config.get();
  });

  ipcMain.handle('get-usage', () => {
    return usageMonitor ? usageMonitor.getLatest() : null;
  });

  ipcMain.handle('focus-terminal', (_, sessionId) => {
    const session = watcher.getSessions().find(s => s.sessionId === sessionId);
    if (session) return focusTerminal(session);
  });

  ipcMain.handle('set-view-mode', (_, mode) => {
    config.setViewMode(mode);
    if (!mainWindow) return;

    const prev = currentViewMode;
    if (prev === mode) return;

    // Snapshot current bounds into the slot we're leaving, BEFORE resizing
    const currentBounds = mainWindow.getBounds();
    if (prev === 'micro') {
      config.setMicroWindowBounds(currentBounds);
    } else {
      config.setWindowBounds(currentBounds);
    }

    currentViewMode = mode;

    // Adjust min size first so setBounds can go smaller if needed
    if (mode === 'micro') {
      mainWindow.setMinimumSize(200, 100);
    } else {
      mainWindow.setMinimumSize(400, 300);
    }

    // Restore the target view's remembered bounds (or a sensible default)
    const target = (mode === 'micro')
      ? (config.getMicroWindowBounds() || { ...MICRO_DEFAULT_BOUNDS, x: currentBounds.x, y: currentBounds.y })
      : (config.getWindowBounds() || { x: currentBounds.x, y: currentBounds.y, width: 900, height: 650 });
    mainWindow.setBounds(target);
  });

  ipcMain.handle('set-compact-mode', (_, value) => {
    config.setCompactMode(value);
  });

  ipcMain.handle('set-background-collapsed', (_, value) => {
    config.setBackgroundSectionCollapsed(value);
    return true;
  });

  ipcMain.handle('set-always-on-top', (_, value) => {
    config.setAlwaysOnTop(value);
    if (mainWindow) mainWindow.setAlwaysOnTop(value);
  });

  ipcMain.handle('set-window-transparency-enabled', (_, value) => {
    config.setWindowTransparencyEnabled(value);
    applyWindowOpacity();
  });

  ipcMain.handle('set-window-opacity', (_, value) => {
    config.setWindowOpacity(value);
    // Live preview: apply the raw value directly, bypassing the focus/hover
    // rule. The settings modal holds focus while dragging, so applyWindowOpacity()
    // would otherwise force 1.0 and hide the effect. Normal logic resumes on the
    // next focus/blur/hover event (e.g. closing the modal).
    if (mainWindow && !mainWindow.isDestroyed() && config.get().windowTransparencyEnabled) {
      mainWindow.setOpacity(config.get().windowOpacity);
    }
  });

  ipcMain.handle('set-vibrancy-experimental', (_, value) => {
    config.setVibrancyExperimental(value);
    // Window material can't be swapped at runtime without a risky destroy/
    // recreate cycle — the new setting takes effect on the next launch.
    return { restartRequired: true };
  });

  ipcMain.handle('window-hover', (_, hovering) => {
    windowHovered = !!hovering;
    applyWindowOpacity();
  });

  ipcMain.handle('set-notification-prefs', (_, sessionId, prefs) => {
    config.setNotificationPrefs(sessionId, prefs);
  });

  ipcMain.handle('get-notification-prefs', (_, sessionId) => {
    return config.getNotificationPrefs(sessionId);
  });

ipcMain.handle('set-session-order', (_, order) => {
    config.setSessionOrder(order);
  });

  ipcMain.handle('set-custom-name', (_, sessionId, name) => {
    config.setCustomName(sessionId, name);
    const session = watcher.getSessions().find(s => s.sessionId === sessionId);
    if (session) {
      sendToRenderer('session-updated', serializeSession(session));
      updateTrayMenu();
      refreshTrayGlance();
    }
  });

  ipcMain.handle('open-remote', (_, url) => {
    if (!url || typeof url !== 'string') return;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return;
      const host = u.hostname.toLowerCase();
      if (host === 'claude.ai' || host.endsWith('.claude.ai') ||
          host === 'anthropic.com' || host.endsWith('.anthropic.com') ||
          host === 'github.com' || host.endsWith('.github.com') ||
          host === 'aby-agency.fr' || host.endsWith('.aby-agency.fr')) {
        shell.openExternal(url);
      }
    } catch {}
  });

  ipcMain.handle('remove-session', (_, sessionId) => {
    watcher.removeSession(sessionId);
  });

  ipcMain.handle('set-volume', (_, value) => {
    config.setVolume(value);
  });

  ipcMain.handle('set-sound-theme', (_, theme) => {
    config.setSoundTheme(theme);
  });

  ipcMain.handle('set-notif-position', (_, value) => {
    config.setNotifPosition(value);
  });

  ipcMain.handle('set-auto-launch', (_, value) => {
    config.setAutoLaunch(value);
    applyAutoLaunch();
  });

  ipcMain.handle('set-language', (_, lang) => {
    config.setLanguage(lang);
    applyLanguage();
    // Broadcast to both windows so they reload text immediately
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('language-changed', i18n.getLanguage());
    }
    island.sendUpdate();
    // Update tray tooltip with new language
    updateTrayMenu();
    refreshTrayGlance();
  });

  ipcMain.handle('get-language', () => i18n.getLanguage());

  ipcMain.handle('check-updates', async (_, force) => {
    return checkForUpdates(!!force);
  });

  ipcMain.handle('download-update', async (_, release) => {
    if (!release || !release.dmgUrl) {
      return { ok: false, error: 'no-asset' };
    }
    try {
      let lastSent = 0;
      const onProgress = (p) => {
        // Throttle to ~10 fps to avoid IPC flooding
        const now = Date.now();
        if (now - lastSent < 100 && p.percent < 100) return;
        lastSent = now;
        sendToRenderer('update-progress', p);
      };
      sendToRenderer('update-progress', { received: 0, total: release.dmgSize || 0, percent: 0 });
      await downloadAndInstall(release, onProgress);
      sendToRenderer('update-installing', { version: release.latest });
      return { ok: true };
    } catch (e) {
      sendToRenderer('update-error', { message: e.message });
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('abort-update', () => {
    return { aborted: abortActiveDownload() };
  });

  ipcMain.handle('get-app-info', () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      githubUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
      websiteUrl: WEBSITE_URL,
    };
  });

  ipcMain.handle('copy-to-clipboard', (_, text) => {
    if (typeof text !== 'string') return false;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('island-hover', (_, hovering) => island.setHover(!!hovering));
}

function serializeSession(session) {
  const sessionDir = sessionDirFor(session);
  const dispatches = session.agentDispatches || new Map();
  const subagents = sessionDir
    ? subagentTracker.snapshotForSession(sessionDir, dispatches)
    : [];
  // Workflows actifs (badge agrégé). Les agents de workflow tournent dans une
  // task background : ils ne comptent PAS dans hasBlockingForegroundAgent et
  // ne mutent pas l'état du parent.
  const workflows = (sessionDir ? subagentTracker.workflowsForSession(sessionDir) : [])
    .filter(wf => wf.status === 'running')
    .map(wf => ({ runId: wf.runId, name: wf.name, started: wf.started, done: wf.done, running: wf.running }));
  if (workflows.length) {
    workflowActive.set(session.sessionId, new Set(workflows.map(w => w.runId)));
  }
  // Blocked on a foreground subagent → show running, not pending/orange.
  const state = (session.state.name === 'pending' && hasBlockingForegroundAgent(subagents))
    ? STATES.RUNNING
    : session.state;

  return {
    sessionId: session.sessionId,
    projectName: session.projectName,
    customName: config.getCustomName(session.sessionId),
    slug: session.slug,
    state,
    lastTool: session.lastTool,
    model: session.model,
    gitBranch: session.gitBranch || null,
    startedAt: session.startedAt,
    lastEventTime: session.lastEventTime ?? null,
    tokens: session.tokens,
    cwd: session.cwd,
    isBackground: !!session.isBackground,
    notifEnabled: (() => { const p = config.getNotificationPrefs(session.sessionId); return !!(p.modal || p.sound); })(),
    subagents,
    workflows,
  };
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function applyLanguage() {
  const cfg = config.get();
  const lang = cfg.language || i18n.detectSystemLanguage();
  i18n.setLanguage(lang);
}

function applyAutoLaunch() {
  const enabled = !!config.get().autoLaunch;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true, // Start minimized to tray
    });
  } catch (e) {
    log.error('Failed to set login item:', e.message);
  }
}

// Allow audio autoplay in renderer
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Single-instance lock — prevents socket conflicts and duplicate trays
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Only grant audio-related permissions (needed for notification sound routing)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'midi', 'speaker-selection'];
    callback(allowed.includes(permission));
  });

  // Load config BEFORE applying settings that depend on it
  config.load();

  // Apply language + auto-launch
  applyLanguage();
  applyAutoLaunch();

  createWindow();
  setupIPC();
  setupWatcher();
  setupSocket();
  setupUsageMonitor();
  setupTray();

  island.refresh(!!config.get().islandEnabled);
  const refreshIsland = () => island.refresh(!!config.get().islandEnabled);
  screen.on('display-added', refreshIsland);
  screen.on('display-removed', refreshIsland);
  screen.on('display-metrics-changed', refreshIsland);

  // Update check: first attempt 10s after startup, then every 2 hours.
  // The 1h rate limit inside checkForUpdates(false) will skip checks that
  // arrive too close together, so the 2h interval is the upper bound.
  const checkAndNotify = async () => {
    const result = await checkForUpdates(false);
    if (result.status === 'update-available') {
      sendToRenderer('update-available', result);
    }
  };
  setTimeout(checkAndNotify, 10_000);
  setInterval(checkAndNotify, 2 * 60 * 60 * 1000);

  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep running in tray when window is closed
  if (process.platform !== 'darwin') app.quit();
});

function generateTrayIcon(color, pct) {
  // Anneau de conso : pct fourni → dessine la jauge (image non-template, vraies couleurs).
  if (typeof pct === 'number' && Number.isFinite(pct) && pct >= 0) {
    const SIZE = 32; // 16pt @2x pour le rendu Retina de la barre de menu
    const img = nativeImage.createFromBitmap(ringBitmap(pct, gaugeColor(pct), SIZE), { width: SIZE, height: SIZE, scaleFactor: 2 });
    img.setTemplateImage(false);
    return img;
  }
  // No color → the static template icon (macOS tints it automatically for
  // light/dark menu bars). `Template` suffix tells Electron this is a
  // template image; the @2x variant is auto-loaded from the same directory.
  if (!color) {
    const iconPath = path.join(__dirname, 'assets', 'tray-iconTemplate.png');
    const img = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') img.setTemplateImage(true);
    return img;
  }
  // Color requested (attention needed) → a small filled dot, drawn as a raw
  // bitmap: nativeImage can't rasterize SVG data-URLs (they come back empty).
  const SIZE = 32; // 16pt @2x
  const img = nativeImage.createFromBitmap(dotBitmap(color, SIZE), { width: SIZE, height: SIZE, scaleFactor: 2 });
  img.setTemplateImage(false);
  return img;
}

function setupTray() {
  const icon = generateTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Aby Claude Watcher');

  tray.on('click', showMainWindow);
  tray.on('right-click', showMainWindow);

  updateTrayMenu();
  refreshTrayGlance();

  // Update tray menu and dock badge when sessions change (debounced)
  let trayTimer;
  const debouncedUpdate = () => {
    if (trayTimer) clearTimeout(trayTimer);
    trayTimer = setTimeout(() => {
      updateTrayMenu();
      updateDockBadge();
      refreshTrayGlance();
      island.sendUpdate();
    }, 300);
  };
  watcher.on('session-added', debouncedUpdate);
  watcher.on('session-updated', debouncedUpdate);
  watcher.on('session-removed', debouncedUpdate);
}

// Builds the live menu-bar glance: colored dot + attention count when
// sessions need the user, else the usage % already shown in the status bar.
// Priority: attention count > usage label > blank (see tray-glance.js).
function refreshTrayGlance() {
  if (!tray) return;
  const sessions = watcher.getSessions().map((s) => ({
    state: effectiveStateName(s),
    isBackground: s.isBackground,
  }));
  const usage = { pct5h: lastUsage?.fiveHour?.utilization ?? null, pct7d: lastUsage?.sevenDay?.utilization ?? null };
  const g = trayGlance(sessions, usage);
  const pct5h = lastUsage?.fiveHour?.utilization;
  const hasUsage = typeof pct5h === 'number' && Number.isFinite(pct5h);
  // La conso est affichée en permanence (comme le wifi/l'heure). L'attention
  // reste signalée par le badge du Dock + les notifs, pas dans le tray.
  try {
    tray.setImage(hasUsage ? generateTrayIcon(null, pct5h) : generateTrayIcon(g.color));
  } catch (e) {
    log.warn('tray icon render failed, fallback', e);
    tray.setImage(generateTrayIcon(null));
  }
  if (hasUsage) tray.setTitle(' ' + trayUsageLabel(lastUsage, Date.now()));
  else if (g.count > 0) tray.setTitle(` ${g.count}`);
  else tray.setTitle('');
}

function updateDockBadge() {
  if (process.platform !== 'darwin') return;
  const sessions = watcher.getSessions().map((s) => ({
    state: effectiveStateName(s),
    isBackground: s.isBackground,
  }));
  const count = trayGlance(sessions, {}).count;
  app.dock.setBadge(count > 0 ? String(count) : '');
}

function updateTrayMenu() {
  if (!tray) return;

  const sessions = watcher.getSessions();
  const activeCount = sessions.length;
  const waitingCount = sessions.filter(s => {
    const n = effectiveStateName(s);
    return n === 'waiting' || n === 'pending';
  }).length;
  let tooltip = i18n.t('tray_tooltip', { app: 'Aby Claude Watcher', n: activeCount });
  if (waitingCount > 0) tooltip += i18n.t('tray_tooltip_waiting', { n: waitingCount });
  tray.setToolTip(tooltip);
}

app.on('before-quit', () => { app._isQuitting = true; });

app.on('will-quit', () => {
  config.saveSync();
  if (watcher) watcher.stop();
  if (socketServer) socketServer.stop();
  if (usageMonitor) usageMonitor.stop();
});
