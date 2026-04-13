const { app, BrowserWindow, ipcMain, Notification, session, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { SessionWatcher, STATES } = require('./watcher');
const { SocketServer } = require('./socket');
const { focusTerminal, resumeSession } = require('./focus');
const config = require('./config');

let mainWindow;
let watcher;
let socketServer;
let tray;

function createWindow() {
  const conf = config.load();
  const bounds = config.getWindowBounds();

  const opts = {
    width: 900,
    height: 650,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    alwaysOnTop: conf.alwaysOnTop || false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  // Restore saved window position and size
  if (bounds) {
    opts.x = bounds.x;
    opts.y = bounds.y;
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

  // Save window bounds on move/resize
  const saveBounds = () => {
    if (!mainWindow.isDestroyed()) {
      config.setWindowBounds(mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('focus', () => {
    if (process.platform === 'darwin') app.dock.setBadge('');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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
    if (prefs.modal) {
      sendToRenderer('show-notification', {
        sessionId: session.sessionId,
        projectName: session.projectName,
        slug: session.slug,
      });
    }
    if (prefs.sound) {
      sendToRenderer('play-sound');
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

function setupIPC() {
  ipcMain.handle('get-sessions', () => {
    return watcher.getSessions().map(serializeSession);
  });

  ipcMain.handle('get-config', () => {
    return config.get();
  });

  ipcMain.handle('focus-terminal', (_, sessionId) => {
    const session = watcher.getSessions().find(s => s.sessionId === sessionId);
    if (session) return focusTerminal(session);
  });

  ipcMain.handle('set-view-mode', (_, mode) => {
    config.setViewMode(mode);
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

  ipcMain.handle('add-session', (_, sessionIdOrPath) => {
    return watcher.addSession(sessionIdOrPath);
  });

  ipcMain.handle('set-session-order', (_, order) => {
    config.setSessionOrder(order);
  });

  ipcMain.handle('open-remote', (_, url) => {
    if (url && url.startsWith('https://claude.ai/')) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('remove-session', (_, sessionId) => {
    watcher.removeSession(sessionId);
  });

  ipcMain.handle('resume-session', (_, sessionId) => {
    const s = watcher.getSessions().find(s => s.sessionId === sessionId);
    const cwd = s ? s.cwd : null;
    return resumeSession(sessionId, cwd);
  });

  ipcMain.handle('set-volume', (_, value) => {
    config.setVolume(value);
  });
}

function serializeSession(session) {
  return {
    sessionId: session.sessionId,
    projectName: session.projectName,
    slug: session.slug,
    state: session.state,
    lastTool: session.lastTool,
    model: session.model,
    lastMessage: session.lastMessage || null,
    gitBranch: session.gitBranch || null,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    tokens: session.tokens,
    remoteUrl: session.remoteUrl || null,
    cwd: session.cwd,
  };
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// Allow audio autoplay in renderer
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  // Only grant audio-related permissions (needed for notification sound routing)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'midi', 'speaker-selection'];
    callback(allowed.includes(permission));
  });

  createWindow();
  setupIPC();
  setupWatcher();
  setupSocket();
  setupTray();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep running in tray when window is closed
  if (process.platform !== 'darwin') app.quit();
});

function setupTray() {
  // Create a 16x16 template icon (monochrome for macOS menu bar)
  const iconSize = 16;
  const canvas = Buffer.alloc(iconSize * iconSize * 4); // RGBA
  // Draw a simple monitor icon
  for (let y = 2; y <= 11; y++) {
    for (let x = 2; x <= 13; x++) {
      const isBorder = y === 2 || y === 11 || x === 2 || x === 13;
      if (isBorder) {
        const idx = (y * iconSize + x) * 4;
        canvas[idx] = 0; canvas[idx+1] = 0; canvas[idx+2] = 0; canvas[idx+3] = 255;
      }
    }
  }
  // Stand
  for (let x = 6; x <= 9; x++) {
    const idx = (12 * iconSize + x) * 4;
    canvas[idx] = 0; canvas[idx+1] = 0; canvas[idx+2] = 0; canvas[idx+3] = 255;
  }
  for (let x = 4; x <= 11; x++) {
    const idx = (13 * iconSize + x) * 4;
    canvas[idx] = 0; canvas[idx+1] = 0; canvas[idx+2] = 0; canvas[idx+3] = 255;
  }

  const icon = nativeImage.createFromBuffer(canvas, { width: iconSize, height: iconSize });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Claude Watch');

  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      if (!mainWindow) createWindow();
      else mainWindow.show();
    }
  });

  updateTrayMenu();

  // Update tray menu and dock badge when sessions change (debounced)
  let trayTimer;
  const debouncedUpdate = () => {
    if (trayTimer) clearTimeout(trayTimer);
    trayTimer = setTimeout(() => {
      updateTrayMenu();
      updateDockBadge();
    }, 300);
  };
  watcher.on('session-added', debouncedUpdate);
  watcher.on('session-updated', debouncedUpdate);
  watcher.on('session-removed', debouncedUpdate);
}

function updateDockBadge() {
  if (process.platform !== 'darwin') return;
  const waiting = watcher.getSessions().filter(s => s.state.name === 'waiting').length;
  app.dock.setBadge(waiting > 0 ? String(waiting) : '');
}

function updateTrayMenu() {
  if (!tray) return;

  const sessions = watcher.getSessions();
  const stateEmoji = {
    thinking: '🟣',
    running: '🟢',
    waiting: '🔵',
    idle: '⚪',
    error: '🔴',
    completed: '⏹',
  };

  const sessionItems = sessions
    .filter(s => s.state.name !== 'completed')
    .map(s => ({
      label: `${stateEmoji[s.state.name] || '⚪'} ${s.projectName} — ${s.state.label}`,
      click: () => {
        focusTerminal(s);
      },
    }));

  const completedCount = sessions.filter(s => s.state.name === 'completed').length;

  const template = [
    ...sessionItems,
    ...(sessionItems.length === 0 ? [{ label: 'Aucune session active', enabled: false }] : []),
    ...(completedCount > 0 ? [{ label: `${completedCount} terminée${completedCount > 1 ? 's' : ''}`, enabled: false }] : []),
    { type: 'separator' },
    {
      label: mainWindow && mainWindow.isVisible() ? 'Masquer la fenêtre' : 'Afficher la fenêtre',
      click: () => {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          if (!mainWindow) createWindow();
          else mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));

  // Update tooltip with summary
  const activeCount = sessions.filter(s => s.state.name !== 'completed').length;
  const waitingCount = sessions.filter(s => s.state.name === 'waiting').length;
  let tooltip = `Claude Watch — ${activeCount} active`;
  if (waitingCount > 0) tooltip += ` (${waitingCount} en attente)`;
  tray.setToolTip(tooltip);
}

app.on('will-quit', () => {
  config.saveSync();
  if (watcher) watcher.stop();
  if (socketServer) socketServer.stop();
});
