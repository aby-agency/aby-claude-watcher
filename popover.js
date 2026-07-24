// ─── popover.js ───
// Mini-panneau du tray (main process), rétabli après son retrait v2.0.0.
// Coexiste avec l'île : île = survol à l'encoche, popover = clic sur l'item
// de la barre de menus. Même découpage que island.js — fenêtre gérée ici, le
// rendu vit dans ui/popover.js. Les actions app-level (ouvrir le dashboard,
// quitter) restent dans les handlers IPC de main.js.

const { BrowserWindow } = require('electron');
const path = require('path');

let win = null;
let toggleLock = false;

function create() {
  win = new BrowserWindow({
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
  win.loadFile(path.join(__dirname, 'ui', 'popover.html'));
  win._loaded = false;
  win.webContents.once('did-finish-load', () => { win._loaded = true; });
  // Clic ailleurs → on referme (comportement popover natif).
  win.on('blur', () => { if (win && !win.isDestroyed()) win.hide(); });
  return win;
}

// N'envoie que si visible : inutile de rafraîchir un popover fermé.
function sendUpdate() {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.webContents.send('popover-update');
  }
}

function toggle(trayBounds) {
  if (toggleLock) return;
  toggleLock = true;
  setTimeout(() => { toggleLock = false; }, 200);

  if (!win || win.isDestroyed()) create();

  if (win.isVisible()) { win.hide(); return; }

  // Positionné centré sous l'item du tray.
  const wb = win.getBounds();
  const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (wb.width / 2));
  const y = Math.round(trayBounds.y + trayBounds.height + 4);
  win.setPosition(x, y, false);
  win.show();
  win.focus();

  // Refresh à l'ouverture (attend le load si la fenêtre vient d'être créée).
  const send = () => { if (win && !win.isDestroyed()) win.webContents.send('popover-update'); };
  if (win._loaded) send();
  else win.webContents.once('did-finish-load', send);
}

function hide() {
  if (win && !win.isDestroyed()) win.hide();
}

function resize(height) {
  if (!win || win.isDestroyed()) return;
  const clamped = Math.max(120, Math.min(600, Math.round(height)));
  const [w] = win.getSize();
  win.setSize(w, clamped, false);
}

function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { create, toggle, sendUpdate, hide, resize, destroy, window: () => win };
