const { app, BrowserWindow, ipcMain, Notification, session, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { SessionWatcher, STATES } = require('./watcher');
const { SocketServer } = require('./socket');
const { focusTerminal, resumeSession, launchSession } = require('./focus');
const config = require('./config');

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
          host === 'anthropic.com' || host.endsWith('.anthropic.com')) {
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
  createPopoverWindow();

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
  // 32x32 retina icon (displayed as 16x16) — monitor with clock
  const s = 32;
  const buf = Buffer.alloc(s * s * 4);
  const px = (x, y, a = 255) => {
    if (x < 0 || x >= s || y < 0 || y >= s) return;
    const i = (y * s + x) * 4;
    buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = a;
  };
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
  // Monitor
  rect(3, 4, 26, 18);
  rect(4, 5, 24, 16);
  // Stand
  for(let x=13;x<=18;x++) px(x,22);
  for(let x=10;x<=21;x++) px(x,23);
  // Clock circle (top-right)
  const cx=24,cy=9,r=5;
  for(let a=0;a<360;a+=8){
    px(cx+Math.round(r*Math.cos(a*Math.PI/180)),cy+Math.round(r*Math.sin(a*Math.PI/180)));
  }
  // Clock hands
  line(cx,cy,cx,cy-3); // hour
  line(cx,cy,cx+2,cy+1); // minute
  // Dots inside monitor (sessions)
  px(10,13,180);px(11,13,180);
  px(15,13,180);px(16,13,180);
  px(20,13,180);px(21,13,180);

  return nativeImage.createFromBuffer(buf, { width: s, height: s, scaleFactor: 2 });
}

function setupTray() {
  const icon = generateTrayIcon();
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Claude Watch');

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
  let tooltip = `Claude Watch — ${activeCount} active`;
  if (waitingCount > 0) tooltip += ` (${waitingCount} en attente)`;
  tray.setToolTip(tooltip);
}

app.on('will-quit', () => {
  config.saveSync();
  if (watcher) watcher.stop();
  if (socketServer) socketServer.stop();
  if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.destroy();
});
