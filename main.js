const { app, BrowserWindow, ipcMain, Notification, session, Tray, Menu, nativeImage, shell, screen, clipboard } = require('electron');
const path = require('path');
const { SessionWatcher, STATES } = require('./watcher');
const { SocketServer } = require('./socket');
const { UsageMonitor } = require('./usage');
const { focusTerminal } = require('./focus');
const { checkForUpdates, downloadAndInstall, abortActiveDownload, GITHUB_OWNER, GITHUB_REPO, WEBSITE_URL } = require('./updater');
const config = require('./config');
const i18n = require('./i18n');
const { SubagentTracker } = require('./subagents');

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

let mainWindow;
let popoverWindow;
let watcher;
let socketServer;
let usageMonitor;
let tray;
let currentViewMode = 'grid';
const MICRO_DEFAULT_BOUNDS = { width: 260, height: 200 };

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

  mainWindow = new BrowserWindow(opts);

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Open devtools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (_, code, desc) => {
    console.error('Failed to load:', code, desc);
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
    // On non-macOS, close the popover too (otherwise window-all-closed never fires)
    if (process.platform !== 'darwin' && popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.destroy();
      popoverWindow = null;
    }
  });
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
    const prefs = config.getNotificationPrefs(session.sessionId);
    const kind = session.state && session.state.name === 'pending' ? 'pending' : 'waiting';
    // Always fire the visual event — the renderer gates by view mode.
    // Compact view shows the toast regardless of the bell; grid still requires it.
    sendToRenderer('show-notification', {
      sessionId: session.sessionId,
      projectName: session.projectName,
      slug: session.slug,
      kind,
    });
    if (prefs.sound) {
      sendToRenderer('play-sound', { kind, sessionId: session.sessionId });
    }
  });

  watcher.on('session-removed', (sessionId) => {
    sendToRenderer('session-removed', sessionId);
  });

  watcher.start();
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
    if (data.sessionId) watcher.markPending(data.sessionId, data.hookEvent, data.toolName);
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
  usageMonitor.on('update', (data) => sendToRenderer('usage-update', data));
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

  ipcMain.handle('set-always-on-top', (_, value) => {
    config.setAlwaysOnTop(value);
    if (mainWindow) mainWindow.setAlwaysOnTop(value);
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
      if (popoverWindow && !popoverWindow.isDestroyed()) {
        popoverWindow.webContents.send('popover-update');
      }
      updateTrayMenu();
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
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.webContents.send('popover-update');
    }
    // Update tray tooltip with new language
    updateTrayMenu();
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

  ipcMain.handle('popover-hide', () => {
    if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.hide();
  });

  ipcMain.handle('popover-open-main', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
    mainWindow.focus();
  });

  ipcMain.handle('popover-quit', () => {
    app.quit();
  });

  ipcMain.handle('popover-resize', (_, height) => {
    if (!popoverWindow || popoverWindow.isDestroyed()) return;
    const clamped = Math.max(120, Math.min(600, Math.round(height)));
    const [w] = popoverWindow.getSize();
    popoverWindow.setSize(w, clamped, false);
  });
}

function serializeSession(session) {
  const sessionDir = sessionDirFor(session);
  const dispatches = session.agentDispatches || new Map();
  const subagents = sessionDir
    ? subagentTracker.snapshotForSession(sessionDir, dispatches)
    : [];

  return {
    sessionId: session.sessionId,
    projectName: session.projectName,
    customName: config.getCustomName(session.sessionId),
    slug: session.slug,
    state: session.state,
    lastTool: session.lastTool,
    model: session.model,
    gitBranch: session.gitBranch || null,
    startedAt: session.startedAt,
    tokens: session.tokens,
    cwd: session.cwd,
    notifEnabled: (() => { const p = config.getNotificationPrefs(session.sessionId); return !!(p.modal || p.sound); })(),
    subagents,
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
    console.error('Failed to set login item:', e.message);
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
  createPopoverWindow();

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

function createPopoverWindow() {
  popoverWindow = new BrowserWindow({
    width: 320,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-popover.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popoverWindow.loadFile(path.join(__dirname, 'ui', 'popover.html'));
  popoverWindow._loaded = false;
  popoverWindow.webContents.once('did-finish-load', () => {
    popoverWindow._loaded = true;
  });

  popoverWindow.on('blur', () => {
    if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.hide();
  });
}

let popoverToggleLock = false;
function togglePopover() {
  if (popoverToggleLock) return;
  popoverToggleLock = true;
  setTimeout(() => { popoverToggleLock = false; }, 200);

  if (!popoverWindow || popoverWindow.isDestroyed()) createPopoverWindow();

  if (popoverWindow.isVisible()) {
    popoverWindow.hide();
    return;
  }

  // Position below the tray icon
  const trayBounds = tray.getBounds();
  const winBounds = popoverWindow.getBounds();
  const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (winBounds.width / 2));
  const y = Math.round(trayBounds.y + trayBounds.height + 4);
  popoverWindow.setPosition(x, y, false);
  popoverWindow.show();
  popoverWindow.focus();
  // Force refresh on open, wait for load if needed
  const sendUpdate = () => {
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.webContents.send('popover-update');
    }
  };
  if (popoverWindow._loaded) {
    sendUpdate();
  } else {
    popoverWindow.webContents.once('did-finish-load', sendUpdate);
  }
}

function generateTrayIcon() {
  // `Template` suffix tells Electron this is a template image (macOS).
  // The @2x variant is auto-loaded from the same directory.
  const iconPath = path.join(__dirname, 'assets', 'tray-iconTemplate.png');
  return nativeImage.createFromPath(iconPath);
}

function setupTray() {
  const icon = generateTrayIcon();
  // Template image mode: macOS only. On Linux/Windows, use colored icon.
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  tray.setToolTip('Aby Claude Watcher');

  tray.on('click', togglePopover);
  tray.on('right-click', togglePopover);

  updateTrayMenu();

  // Update tray menu and dock badge when sessions change (debounced)
  let trayTimer;
  const debouncedUpdate = () => {
    if (trayTimer) clearTimeout(trayTimer);
    trayTimer = setTimeout(() => {
      updateTrayMenu();
      updateDockBadge();
      // Always send updates (popover might be hidden but still subscribed)
      if (popoverWindow && !popoverWindow.isDestroyed()) {
        popoverWindow.webContents.send('popover-update');
      }
    }, 300);
  };
  watcher.on('session-added', debouncedUpdate);
  watcher.on('session-updated', debouncedUpdate);
  watcher.on('session-removed', debouncedUpdate);
}

function updateDockBadge() {
  if (process.platform !== 'darwin') return;
  const waiting = watcher.getSessions().filter(s => s.state.name === 'waiting' || s.state.name === 'pending').length;
  app.dock.setBadge(waiting > 0 ? String(waiting) : '');
}

function updateTrayMenu() {
  if (!tray) return;

  const sessions = watcher.getSessions();
  const activeCount = sessions.length;
  const waitingCount = sessions.filter(s => s.state.name === 'waiting' || s.state.name === 'pending').length;
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
  if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.destroy();
});
