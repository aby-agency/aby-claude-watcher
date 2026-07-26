// ─── preload-island.js ───
// Context bridge for the island window. Same trust model as preload.js.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandApi', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getUsage: () => ipcRenderer.invoke('get-usage'),
  focusSession: (sessionId) => ipcRenderer.invoke('focus-terminal', sessionId),
  setHover: (hovering) => ipcRenderer.invoke('island-hover', hovering),
  onUpdate: (cb) => ipcRenderer.on('island-update', () => cb()),
  onGeometry: (cb) => ipcRenderer.on('island-geometry', (_, g) => cb(g)),
  onBanner: (cb) => ipcRenderer.on('island-banner', (_, b) => cb(b)),
  // Mise à jour : état lu au refresh (source de vérité) + push direct pendant
  // le téléchargement (progression, ~10 fps).
  getUpdate: () => ipcRenderer.invoke('island-get-update'),
  installUpdate: () => ipcRenderer.invoke('island-install-update'),
  dismissUpdate: () => ipcRenderer.invoke('island-dismiss-update'),
  onUpdateState: (cb) => ipcRenderer.on('island-update-state', (_, u) => cb(u)),
});
