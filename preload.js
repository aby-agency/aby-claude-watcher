// ─── preload.js ───
// Context bridge between main process and renderer.
//
// TRUST BOUNDARY: This file exposes IPC invoke methods to the renderer.
// Input validation and security checks are performed in main.js handlers,
// NOT here. Any method that accepts arbitrary strings (openRemote, addSession,
// launchSession, setCustomName, etc.) is validated in main.js before use.
// See main.js:ipcMain.handle(...) for each method's validation.
//
// Electron settings: contextIsolation: true, nodeIntegration: false.
// The renderer has no direct Node.js access — only this `window.api` surface.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  focusTerminal: (sessionId) => ipcRenderer.invoke('focus-terminal', sessionId),
  setViewMode: (mode) => ipcRenderer.invoke('set-view-mode', mode),
  setCompactMode: (value) => ipcRenderer.invoke('set-compact-mode', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  setNotificationPrefs: (sessionId, prefs) => ipcRenderer.invoke('set-notification-prefs', sessionId, prefs),
  getNotificationPrefs: (sessionId) => ipcRenderer.invoke('get-notification-prefs', sessionId),
  addSession: (sessionIdOrPath) => ipcRenderer.invoke('add-session', sessionIdOrPath),
  resumeSession: (sessionId) => ipcRenderer.invoke('resume-session', sessionId),
  setSessionOrder: (order) => ipcRenderer.invoke('set-session-order', order),
  setCustomName: (sessionId, name) => ipcRenderer.invoke('set-custom-name', sessionId, name),
  removeSession: (sessionId) => ipcRenderer.invoke('remove-session', sessionId),
  openRemote: (url) => ipcRenderer.invoke('open-remote', url),
  setVolume: (value) => ipcRenderer.invoke('set-volume', value),
  setNotifPosition: (value) => ipcRenderer.invoke('set-notif-position', value),
  launchSession: (cwd) => ipcRenderer.invoke('launch-session', cwd),

  onSessionAdded: (callback) => ipcRenderer.on('session-added', (_, data) => callback(data)),
  onSessionUpdated: (callback) => ipcRenderer.on('session-updated', (_, data) => callback(data)),
  onSessionRemoved: (callback) => ipcRenderer.on('session-removed', (_, id) => callback(id)),
  onShowNotification: (callback) => ipcRenderer.on('show-notification', (_, data) => callback(data)),
  onPlaySound: (callback) => ipcRenderer.on('play-sound', () => callback()),
});
