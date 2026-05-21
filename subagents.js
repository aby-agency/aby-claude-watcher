const fs = require('fs');

const TAIL_BYTES = 64 * 1024;

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

module.exports = { readMeta, readLastEvent, TAIL_BYTES };
