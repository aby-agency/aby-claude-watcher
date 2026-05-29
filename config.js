const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { log } = require('./logger');

const CONFIG_PATH = path.join(
  app ? app.getPath('userData') : path.join(require('os').homedir(), '.aby-claude-watcher'),
  'config.json'
);

let config = {
  notifications: {},    // { [sessionId]: { modal: bool, sound: bool } }
  sessions: {},         // { [sessionId]: { serialized session data } }
  viewMode: 'grid',     // 'grid' | 'list'
  alwaysOnTop: false,
  compactMode: false,
  notifPosition: 'top-right',  // 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  autoLaunch: false,
  language: null,       // 'fr' | 'en' | null (auto-detect)
  volume: 0.7,          // 0.0 - 1.0
  soundTheme: 'default',     // 'default' | 'vibraphone' | 'wood' | 'soft'
  windowBounds: null,        // { x, y, width, height } — grid & compact share this
  microWindowBounds: null,   // separate bounds remembered for micro view
  windowTransparencyEnabled: false, // master toggle for window opacity feature
  windowOpacity: 0.85,       // 0.3 - 1.0 — opacity when idle (translucent), full on focus/hover
  sessionOrder: [],     // [sessionId, sessionId, ...] — user-defined order
  customNames: {},      // { [sessionId]: "Custom name" }
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
      log.error('Failed to save config:', e.message);
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
    log.error('Failed to save config:', e.message);
  }
}

function get() {
  return config;
}

function setViewMode(mode) {
  config.viewMode = mode;
  save();
}

function setCompactMode(value) {
  config.compactMode = value;
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

function setWindowTransparencyEnabled(value) {
  config.windowTransparencyEnabled = !!value;
  save();
}

function setWindowOpacity(value) {
  // Floor at 0.3 so the window can never become invisible / unclickable
  config.windowOpacity = Math.max(0.3, Math.min(1, value));
  save();
}

function setNotifPosition(value) {
  config.notifPosition = value;
  save();
}

function setAutoLaunch(value) {
  config.autoLaunch = !!value;
  save();
}

function setLanguage(lang) {
  config.language = (lang === 'fr' || lang === 'en') ? lang : null;
  save();
}

function setSoundTheme(theme) {
  const allowed = ['default', 'vibraphone', 'wood', 'soft'];
  config.soundTheme = allowed.includes(theme) ? theme : 'default';
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

function setCustomName(sessionId, name) {
  if (!config.customNames) config.customNames = {};
  if (name && name.trim()) {
    // Strip control chars, cap length
    const clean = name.trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 60);
    if (clean) {
      config.customNames[sessionId] = clean;
    } else {
      delete config.customNames[sessionId];
    }
  } else {
    delete config.customNames[sessionId];
  }
  save();
}

function getCustomName(sessionId) {
  return (config.customNames && config.customNames[sessionId]) || null;
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

function setMicroWindowBounds(bounds) {
  config.microWindowBounds = bounds;
  save();
}

function getMicroWindowBounds() {
  return config.microWindowBounds;
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
  if (config.customNames) delete config.customNames[sessionId];
  if (Array.isArray(config.sessionOrder)) {
    config.sessionOrder = config.sessionOrder.filter(id => id !== sessionId);
  }
  save();
}

module.exports = {
  load,
  save,
  get,
  setViewMode,
  setCompactMode,
  setAlwaysOnTop,
  setVolume,
  setWindowTransparencyEnabled,
  setWindowOpacity,
  setNotifPosition,
  setAutoLaunch,
  setLanguage,
  setSoundTheme,
  getNotificationPrefs,
  setNotificationPrefs,
  setCustomName,
  getCustomName,
  setSessionOrder,
  getSessionOrder,
  setWindowBounds,
  getWindowBounds,
  setMicroWindowBounds,
  getMicroWindowBounds,
  saveSync,
  saveSession,
  getSavedSessions,
  deleteSession,
};
