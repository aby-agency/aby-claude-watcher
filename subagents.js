const fs = require('fs');

function readMeta(metaPath) {
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { readMeta };
