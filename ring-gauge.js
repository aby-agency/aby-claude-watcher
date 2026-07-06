// Pure helpers for the macOS menu-bar consumption gauge. No Electron deps → unit-testable.
const RING = { cx: 8, cy: 8, r: 6, sw: 2.6 };
const CIRC = 2 * Math.PI * RING.r;
const TRACK = 'rgba(140,140,140,0.35)';

function gaugeColor(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (pct < 50) return '#28c451';
  if (pct <= 80) return '#ff9f0a';
  return '#ff453a';
}

// Accepts epoch seconds, epoch ms, or an ISO string; returns ms or null.
function toMs(resetsAt) {
  if (resetsAt == null) return null;
  if (typeof resetsAt === 'string') { const t = Date.parse(resetsAt); return Number.isNaN(t) ? null : t; }
  if (typeof resetsAt === 'number' && Number.isFinite(resetsAt)) return resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  return null;
}

function formatCountdown(resetsAt, nowMs) {
  const ms = toMs(resetsAt);
  if (ms == null) return 'reset';
  const diff = ms - nowMs;
  if (diff <= 0) return 'reset';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function ringSvg(pct, color) {
  const p = Math.max(0, Math.min(100, typeof pct === 'number' && Number.isFinite(pct) ? pct : 0)) / 100;
  const { cx, cy, r, sw } = RING;
  const track = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${sw}"/>`;
  const arc = (p > 0 && color)
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${CIRC.toFixed(3)}" stroke-dashoffset="${(CIRC * (1 - p)).toFixed(3)}" transform="rotate(-90 ${cx} ${cy})"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">${track}${arc}</svg>`;
}

function trayUsageLabel(usage, nowMs) {
  const fh = usage && usage.fiveHour;
  if (!fh || typeof fh.utilization !== 'number' || !Number.isFinite(fh.utilization)) return null;
  const pct = Math.round(Math.max(0, Math.min(100, fh.utilization)));
  return `5H ${pct}% · ${formatCountdown(fh.resetsAt, nowMs)}`;
}

module.exports = { gaugeColor, formatCountdown, ringSvg, trayUsageLabel };
