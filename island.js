// ─── island.js ───
// Dynamic island window anchored to the MacBook notch. Fixed-size transparent
// always-on-top window, click-through by default; the renderer drives hover
// via the 'island-hover' IPC (never resize on hover — transparent-window
// resizes flicker).

const { BrowserWindow, screen } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const { log } = require('./logger');
const { islandLayout } = require('./island-model');

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
// Un échec n'est JAMAIS caché : pendant une bascule dock/undock, AppKit peut
// répondre à vide un court instant — cacher ce null figeait le fallback 180
// (< encoche réelle 185) pour toute la vie du process, badges rognés.
let notchCache = null; // { key, value } — succès uniquement
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
      if (value) notchCache = { key, value };
      else log.info(`[island] notch measure failed for ${key} (err=${err ? err.code || 1 : 'empty'}) — fallback, will retry`);
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
  // .on, pas .once : un reload du renderer (crash, devtools) repartirait sans
  // --notch-gap ni données — la géométrie doit être re-poussée à chaque load.
  win.webContents.on('did-finish-load', () => {
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

// (Re)create, reposition or drop the island. Called at startup, on every
// screen event, and when the setting toggles. L'île suit l'écran PRINCIPAL
// (barre de menu), encoche ou non — mode docké compris. La mesure est async :
// on re-lit le primary après coup.
// La mesure AppKit part dès que le primary est l'écran INTERNE — plus de gate
// sur l'heuristique workArea (menuBarHeight ≥ 30) : pendant la bascule
// dock/undock, Electron rend un workArea transitoire → l'heuristique disait
// « pas d'encoche », l'île restait en fallback 180 sous une encoche de 185,
// badges rognés (constaté au premier undock post-v2.0.0). AppKit sait ; un
// interne sans encoche répond juste [] → fallback, comme avant. Cela supprime
// aussi le piège « barre de menu auto-masquée → fausse encoche ».
let refreshSeq = 0; // la mesure d'un refresh dépassé ne s'applique jamais
let settleTimer = null;
function refresh(enabled) {
  doRefresh(enabled);
  // Re-check après stabilisation : les événements screen d'une bascule
  // arrivent en rafale sur des états transitoires ; si le DERNIER tombe
  // pendant la transition, rien ne corrigeait jamais (l'île attendait un
  // event fortuit — True Tone…). Un seul re-check différé suffit.
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => doRefresh(enabled), 1500);
}
function doRefresh(enabled) {
  if (!enabled) return destroy();
  const display = screen.getPrimaryDisplay();
  if (!display) return destroy();
  const seq = ++refreshSeq;
  const measure = display.internal ? measureNotch(display) : Promise.resolve(null);
  measure.then((notch) => {
    if (seq !== refreshSeq) return; // un refresh plus récent est en vol
    const still = screen.getPrimaryDisplay();
    if (!still) return destroy();
    lastLayout = islandLayout(still, notch, WIN_W);
    log.info(`[island] layout x=${lastLayout.x} gap=${lastLayout.gapPx} display=${still.bounds.width}x${still.bounds.height}${still.internal ? ' internal' : ''} notch=${notch ? `${notch.left}+${notch.width}` : 'none'}`);
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
