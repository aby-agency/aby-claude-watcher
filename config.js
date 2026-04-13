const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_PATH = path.join(
  app ? app.getPath('userData') : path.join(require('os').homedir(), '.claude-watch'),
  'config.json'
);

let config = {
  notifications: {},    // { [sessionId]: { modal: bool, sound: bool } }
  sessions: {},         // { [sessionId]: { serialized session data } }
  viewMode: 'grid',     // 'grid' | 'list'
  alwaysOnTop: false,
  volume: 0.7,          // 0.0 - 1.0
  windowBounds: null,   // { x, y, width, height }
  sessionOrder: [],     // [sessionId, sessionId, ...] — user-defined order
};

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      config = { ...config, ...data };
    }
  } catch (e) {
    // use defaults
  }
  return config;
}

let saveTimer = null;
function save() {
  // Debounce: wait 500ms before writing to disk
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
      console.error('Failed to save config:', e.message);
    }
  }, 500);
}

// Force immediate save (for app shutdown)
function saveSync() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e.message);
  }
}

function get() {
  return config;
}

function setViewMode(mode) {
  config.viewMode = mode;
  save();
}

function setAlwaysOnTop(value) {
  config.alwaysOnTop = value;
  save();
}

function setVolume(value) {
  config.volume = Math.max(0, Math.min(1, value));
  save();
}

function getNotificationPrefs(sessionId) {
  return config.notifications[sessionId] || { modal: false, sound: false };
}

function setNotificationPrefs(sessionId, prefs) {
  config.notifications[sessionId] = {
    ...getNotificationPrefs(sessionId),
    ...prefs,
  };
  save();
}

function setSessionOrder(order) {
  config.sessionOrder = order;
  save();
}

function getSessionOrder() {
  return config.sessionOrder || [];
}

function setWindowBounds(bounds) {
  config.windowBounds = bounds;
  save();
}

function getWindowBounds() {
  return config.windowBounds;
}

function saveSession(sessionId, data) {
  config.sessions[sessionId] = data;
  save();
}

function getSavedSessions() {
  return config.sessions || {};
}

function deleteSession(sessionId) {
  delete config.sessions[sessionId];
  delete config.notifications[sessionId];
  save();
}

module.exports = {
  load,
  save,
  get,
  setViewMode,
  setAlwaysOnTop,
  setVolume,
  getNotificationPrefs,
  setNotificationPrefs,
  setSessionOrder,
  getSessionOrder,
  setWindowBounds,
  getWindowBounds,
  saveSync,
  saveSession,
  getSavedSessions,
  deleteSession,
};
