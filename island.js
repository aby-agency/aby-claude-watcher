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
