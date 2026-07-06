// Pure aggregate for the macOS menu bar glance. No Electron deps → unit-testable.
const STATE_COLOR = {
  pending: '#f59e0b',
  error: '#ef4444',
  waiting: '#22c55e',
};
// Attention priority (most urgent first).
const PRIORITY = ['pending', 'error', 'waiting'];

function trayGlance(sessions, usage) {
  const attention = (sessions || []).filter(
    (s) => !s.isBackground && PRIORITY.includes(s.state)
  );
  const count = attention.length;
  let color = null;
  for (const state of PRIORITY) {
    if (attention.some((s) => s.state === state)) { color = STATE_COLOR[state]; break; }
  }
  let usageLabel = null;
  if (usage && (typeof usage.pct5h === 'number' || typeof usage.pct7d === 'number')) {
    const top = Math.max(
      typeof usage.pct5h === 'number' ? usage.pct5h : -Infinity,
      typeof usage.pct7d === 'number' ? usage.pct7d : -Infinity
    );
    if (Number.isFinite(top)) usageLabel = `${Math.round(top)}%`;
  }
  return { count, color, usageLabel };
}

module.exports = { trayGlance, STATE_COLOR };
