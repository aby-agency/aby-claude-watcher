const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popoverApi', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  focusSession: (sessionId) => ipcRenderer.invoke('focus-terminal', sessionId),
  openMainWindow: () => ipcRenderer.invoke('popover-open-main'),
  hide: () => ipcRenderer.invoke('popover-hide'),
  quit: () => ipcRenderer.invoke('popover-quit'),
  onUpdate: (cb) => ipcRenderer.on('popover-update', () => cb()),
  resize: (height) => ipcRenderer.invoke('popover-resize', height),
});
