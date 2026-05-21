const fs = require('fs');

const TAIL_BYTES = 64 * 1024;
const STALE_THRESHOLD_MS = 5000;
const ERROR_TIMEOUT_MS = 30000;

function readMeta(metaPath) {
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readLastEvent(jsonlPath) {
  let fd;
  try {
    const stat = fs.statSync(jsonlPath);
    if (stat.size === 0) return null;
    fd = fs.openSync(jsonlPath, 'r');
    let start = Math.max(0, stat.size - TAIL_BYTES);
    while (true) {
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const text = buf.toString('utf-8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (start === 0 || lines.length > 1) {
        const last = lines[lines.length - 1];
        if (!last) return null;
        try { return JSON.parse(last); } catch { return null; }
      }
      // Single (possibly truncated) line — grow window
      start = Math.max(0, start - TAIL_BYTES);
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function deriveState(lastEvent, mtimeMs, nowMs = Date.now()) {
  if (!lastEvent) return 'error';

  const msg = lastEvent.message || {};
  const stopReason = msg.stop_reason;
  const ageMs = nowMs - mtimeMs;

  if (stopReason === 'end_turn') return 'completed';
  if (stopReason == null && ageMs > ERROR_TIMEOUT_MS) return 'error';
  return 'running';
}

module.exports = {
  readMeta,
  readLastEvent,
  deriveState,
  STALE_THRESHOLD_MS,
  ERROR_TIMEOUT_MS,
  TAIL_BYTES,
};
