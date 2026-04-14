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
