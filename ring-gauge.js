// Pure helpers for the macOS menu-bar consumption gauge. No Electron deps → unit-testable.
// The gauge icon is drawn as a raw RGBA bitmap (not SVG): Electron's nativeImage
// does NOT rasterize data-URL SVGs (they come back empty), so we hand-draw the
// ring into a premultiplied-BGRA buffer for `nativeImage.createFromBitmap`.

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

function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Draws a progress ring into a premultiplied-BGRA buffer (size×size×4).
// Antialiased via SSxSS supersampling. Track always drawn; colored arc spans
// the top-clockwise fraction pct/100 when a color is given.
function ringBitmap(pct, color, size) {
  const S = Math.max(1, Math.floor(size) || 16);
  const buf = Buffer.alloc(S * S * 4);
  const cx = S / 2, cy = S / 2;
  const r = (S * 6) / 16, sw = (S * 2.6) / 16;
  const rIn = r - sw / 2, rOut = r + sw / 2;
  const p = Math.max(0, Math.min(100, typeof pct === 'number' && Number.isFinite(pct) ? pct : 0)) / 100;
  const rgb = hexToRgb(color);
  const TRACK = [140, 140, 140], TRACK_A = 0.35;
  const SS = 4, inv = 1 / SS, area = SS * SS, TWO_PI = Math.PI * 2;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let pr = 0, pg = 0, pb = 0, pa = 0; // premultiplied accumulators
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) * inv - cx;
          const dy = y + (sy + 0.5) * inv - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < rIn || dist > rOut) continue;
          let ang = Math.atan2(dx, -dy); // clockwise from top (12 o'clock)
          if (ang < 0) ang += TWO_PI;
          const onArc = rgb && p > 0 && ang / TWO_PI <= p;
          const cr = onArc ? rgb[0] : TRACK[0];
          const cg = onArc ? rgb[1] : TRACK[1];
          const cb = onArc ? rgb[2] : TRACK[2];
          const ca = onArc ? 1 : TRACK_A;
          pr += cr * ca; pg += cg * ca; pb += cb * ca; pa += ca;
        }
      }
      const idx = (y * S + x) * 4;
      buf[idx] = Math.round(pb / area);           // B
      buf[idx + 1] = Math.round(pg / area);       // G
      buf[idx + 2] = Math.round(pr / area);       // R
      buf[idx + 3] = Math.round((pa / area) * 255); // A
    }
  }
  return buf;
}

function trayUsageLabel(usage, nowMs) {
  const fh = usage && usage.fiveHour;
  if (!fh || typeof fh.utilization !== 'number' || !Number.isFinite(fh.utilization)) return null;
  const pct = Math.round(Math.max(0, Math.min(100, fh.utilization)));
  return `5H ${pct}% · ${formatCountdown(fh.resetsAt, nowMs)}`;
}

module.exports = { gaugeColor, formatCountdown, ringBitmap, trayUsageLabel };
