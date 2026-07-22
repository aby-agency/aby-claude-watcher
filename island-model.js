// ─── island-model.js ───
// Pure logic for the dynamic island — no Electron deps → unit-testable.
// Dual export: module.exports (main process, tests) + window.islandModel
// (island renderer, loaded via <script> like i18n.js).

const CAP_PER_WING = 4;
// Menu bar is ~37px on notched MacBooks vs ~25px otherwise. No public API
// exposes the notch — this heuristic is the standard technique.
const NOTCH_MENUBAR_MIN = 30;

function menuBarHeight(display) {
  return display.workArea.y - display.bounds.y;
}

function notchedInternalDisplay(displays) {
  return (displays || []).find(
    (d) => d.internal && menuBarHeight(d) >= NOTCH_MENUBAR_MIN
  ) || null;
}

// Same ordering as the main window / popover: user-defined sessionOrder
// first, then newest first. Stable → LEDs never jump on state changes.
function sortSessions(sessions, sessionOrder) {
  return sessions.slice().sort((a, b) => {
    const ai = sessionOrder.indexOf(a.sessionId);
    const bi = sessionOrder.indexOf(b.sessionId);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return new Date(b.startedAt) - new Date(a.startedAt);
  });
}

const ATTENTION = ['pending', 'error', 'waiting'];

function buildIsland(sessions, config, now = Date.now()) {
  const order = (config && config.sessionOrder) || [];
  const sorted = sortSessions(sessions || [], order);
  const interactive = sorted.filter((s) => !s.isBackground);
  const background = sorted.filter((s) => s.isBackground);

  const wing = (list) => ({
    leds: list.slice(0, CAP_PER_WING).map((s) => ({ sessionId: s.sessionId, state: s.state.name })),
    more: Math.max(0, list.length - CAP_PER_WING),
  });

  const row = (s) => ({
    sessionId: s.sessionId,
    name: s.customName || s.projectName,
    state: s.state.name,
    minutes: ATTENTION.includes(s.state.name) && s.lastEventTime
      ? Math.max(0, Math.floor((now - s.lastEventTime) / 60000))
      : null,
    isBackground: !!s.isBackground,
  });

  return {
    left: wing(interactive),
    right: wing(background),
    rows: interactive.map(row),
    backgroundRows: background.map(row),
  };
}

const api = { buildIsland, notchedInternalDisplay, menuBarHeight, CAP_PER_WING };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.islandModel = api;
