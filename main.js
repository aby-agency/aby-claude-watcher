const { app, BrowserWindow, ipcMain, Notification, session, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { SessionWatcher, STATES } = require('./watcher');
const { SocketServer } = require('./socket');
const { focusTerminal, resumeSession, launchSession } = require('./focus');
const { checkForUpdates, GITHUB_OWNER, GITHUB_REPO, WEBSITE_URL } = require('./updater');
const config = require('./config');
const i18n = require('./i18n');

let mainWindow;
let popoverWindow;
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

  ipcMain.handle('add-session', (_, sessionIdOrPath) => {
    return watcher.addSession(sessionIdOrPath);
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

  ipcMain.handle('resume-session', (_, sessionId) => {
    const s = watcher.getSessions().find(s => s.sessionId === sessionId);
    const cwd = s ? s.cwd : null;
    return resumeSession(sessionId, cwd);
  });

  ipcMain.handle('launch-session', (_, cwd) => {
    return launchSession(cwd);
  });

  ipcMain.handle('set-volume', (_, value) => {
    config.setVolume(value);
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

  ipcMain.handle('get-app-info', () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      githubUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
      websiteUrl: WEBSITE_URL,
    };
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
    endedAt: session.endedAt,
    tokens: session.tokens,
    remoteUrl: session.remoteUrl || null,
    maybeStuck: session.maybeStuck || false,
    cwd: session.cwd,
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

app.whenReady().then(() => {
  // Only grant audio-related permissions (needed for notification sound routing)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'midi', 'speaker-selection'];
    callback(allowed.includes(permission));
  });

  // Apply language + auto-launch
  applyLanguage();
  applyAutoLaunch();

  createWindow();
  setupIPC();
  setupWatcher();
  setupSocket();
  setupTray();
  createPopoverWindow();

  // Check for updates 30s after startup (non-blocking)
  setTimeout(async () => {
    const result = await checkForUpdates(false);
    if (result.status === 'update-available') {
      sendToRenderer('update-available', result);
    }
  }, 30000);

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

// Draw the tray icon at a given size — monitor + clock with thicker strokes
// that render cleanly at both 16px (macOS) and 22px (Linux).
function drawTrayIconBuffer(size) {
  const buf = Buffer.alloc(size * size * 4);
  const px = (x, y, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = a;
  };

  // Scale coordinates from a 32-unit canvas to the target size
  const sc = (v) => Math.round(v * size / 32);

  const line = (x0, y0, x1, y1, a = 255) => {
    const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
    const sx = x0<x1?1:-1, sy = y0<y1?1:-1;
    let err = dx-dy;
    while(true) {
      px(x0,y0,a);
      if(x0===x1&&y0===y1) break;
      const e2=2*err;
      if(e2>-dy){err-=dy;x0+=sx;}
      if(e2<dx){err+=dx;y0+=sy;}
    }
  };
  const rect = (x, y, w, h, a = 255) => {
    for(let i=x;i<x+w;i++){px(i,y,a);px(i,y+h-1,a);}
    for(let j=y;j<y+h;j++){px(x,j,a);px(x+w-1,j,a);}
  };
  // Monitor (2px thick border)
  rect(sc(3), sc(4), sc(26), sc(18));
  rect(sc(4), sc(5), sc(24), sc(16));
  // Stand
  for(let x=sc(13);x<=sc(18);x++) px(x,sc(22));
  for(let x=sc(10);x<=sc(21);x++) px(x,sc(23));
  // Clock circle
  const cx=sc(24),cy=sc(9),r=sc(5);
  for(let a=0;a<360;a+=6){
    px(cx+Math.round(r*Math.cos(a*Math.PI/180)),cy+Math.round(r*Math.sin(a*Math.PI/180)));
  }
  // Clock hands
  line(cx,cy,cx,cy-sc(3));
  line(cx,cy,cx+sc(2),cy+sc(1));
  // Dots inside monitor (sessions)
  [10,15,20].forEach(x0 => {
    px(sc(x0),sc(13),180);
    px(sc(x0+1),sc(13),180);
  });

  return buf;
}

function generateTrayIcon() {
  // Generate both 16x16 (@1x) and 32x32 (@2x retina) representations
  const img16 = nativeImage.createFromBuffer(drawTrayIconBuffer(16), { width: 16, height: 16 });
  const img32 = drawTrayIconBuffer(32);
  img16.addRepresentation({ width: 32, height: 32, scaleFactor: 2, buffer: img32 });
  return img16;
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
  const waiting = watcher.getSessions().filter(s => s.state.name === 'waiting').length;
  app.dock.setBadge(waiting > 0 ? String(waiting) : '');
}

function updateTrayMenu() {
  if (!tray) return;

  const sessions = watcher.getSessions();
  const activeCount = sessions.filter(s => s.state.name !== 'completed').length;
  const waitingCount = sessions.filter(s => s.state.name === 'waiting').length;
  let tooltip = i18n.t('tray_tooltip', { app: 'Aby Claude Watcher', n: activeCount });
  if (waitingCount > 0) tooltip += i18n.t('tray_tooltip_waiting', { n: waitingCount });
  tray.setToolTip(tooltip);
}

app.on('will-quit', () => {
  config.saveSync();
  if (watcher) watcher.stop();
  if (socketServer) socketServer.stop();
  if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.destroy();
});
