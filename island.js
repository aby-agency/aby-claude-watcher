// ─── island.js ───
// Dynamic island window anchored to the MacBook notch. Fixed-size transparent
// always-on-top window, click-through by default; the renderer drives hover
// via the 'island-hover' IPC (never resize on hover — transparent-window
// resizes flicker).

const { BrowserWindow, screen } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const { notchedInternalDisplay, islandLayout } = require('./island-model');

const WIN_W = 460;
const WIN_H = 340;

let win = null;
let lastLayout = null; // { x, gapPx } — dernier layout calculé (mesure ou fallback)

// Electron n'expose pas l'encoche ; AppKit si (NSScreen.auxiliaryTop*Area).
// Script JXA statique (aucune interpolation) : liste les écrans à encoche
// (safeAreaInsets.top > 0) avec la largeur des deux zones de menu latérales.
const NOTCH_SCRIPT = `
ObjC.import("AppKit");
const out = [];
const screens = $.NSScreen.screens;
for (let i = 0; i < screens.count; i++) {
  const s = screens.objectAtIndex(i);
  if (s.safeAreaInsets.top > 0) {
    out.push({
      width: s.frame.size.width,
      left: s.auxiliaryTopLeftArea.size.width,
      right: s.auxiliaryTopRightArea.size.width,
    });
  }
}
JSON.stringify(out);
`;

// Mesure {left, width} de l'encoche en pt, relative au display — null si
// indisponible (permission, pas d'écran à encoche, parse). Cachée par
// géométrie de display : l'encoche ne bouge pas sans changement de résolution.
let notchCache = null; // { key, value }
function measureNotch(display) {
  const key = `${display.bounds.width}x${display.bounds.height}`;
  if (notchCache && notchCache.key === key) return Promise.resolve(notchCache.value);
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', NOTCH_SCRIPT], { timeout: 3000 }, (err, stdout) => {
      let value = null;
      if (!err) {
        try {
          const screens = JSON.parse(String(stdout).trim());
          const m = screens.find((s) => s.width === display.bounds.width) || screens[0];
          if (m) value = { left: m.left, width: m.width - m.left - m.right };
        } catch (_) { /* mesure indisponible → fallback islandLayout */ }
      }
      notchCache = { key, value };
      resolve(value);
    });
  });
}

function applyBounds(display) {
  win.setBounds({ x: lastLayout.x, y: display.bounds.y, width: WIN_W, height: WIN_H });
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
    // Sans ce flag, macOS clampe toute fenêtre VISIBLE sous la barre de menu
    // (constrainFrameRect) — y:0 devenait y:34 à l'affichage, même à niveau
    // screen-saver. Seul flag qui l'exempte (type:'panel' ne suffit pas).
    enableLargerThanScreen: true,
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
  applyBounds(display);
  win.loadFile(path.join(__dirname, 'ui', 'island', 'island.html'));
  win._loaded = false;
  win.webContents.once('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    win._loaded = true;
    win.showInactive();
    sendGeometry();
    sendUpdate();
  });
  const w = win;
  win.on('closed', () => { if (win === w) win = null; });
}

function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

// (Re)create, reposition or drop the island for the current displays + config.
// Called at startup, on every screen event, and when the setting toggles.
// La mesure est async : on revérifie le display après coup (il peut avoir
// disparu pendant les ~50ms d'osascript).
function refresh(enabled) {
  if (!enabled || !notchedInternalDisplay(screen.getAllDisplays())) return destroy();
  const display = notchedInternalDisplay(screen.getAllDisplays());
  measureNotch(display).then((notch) => {
    const still = notchedInternalDisplay(screen.getAllDisplays());
    if (!still) return destroy();
    lastLayout = islandLayout(still, notch, WIN_W);
    if (!win || win.isDestroyed()) return create(still);
    applyBounds(still);
    sendGeometry();
  });
}

function sendGeometry() {
  if (win && !win.isDestroyed() && win._loaded && lastLayout) {
    win.webContents.send('island-geometry', { gapPx: lastLayout.gapPx });
  }
}

function sendUpdate() {
  if (win && !win.isDestroyed() && win._loaded) win.webContents.send('island-update');
}

// Bannière needs-you — auto-gardée : sans île visible, silence (aucun fallback).
function sendBanner(payload) {
  if (win && !win.isDestroyed() && win._loaded && win.isVisible()) {
    win.webContents.send('island-banner', payload);
  }
}

function setHover(hovering) {
  if (!win || win.isDestroyed()) return;
  if (hovering) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
}

module.exports = { refresh, destroy, sendUpdate, sendBanner, setHover, window: () => win };
