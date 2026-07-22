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
});
