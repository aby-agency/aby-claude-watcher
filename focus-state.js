// Reads the macOS Do Not Disturb / Focus state. No Electron deps → unit-testable.
// Approach mirrors the `getfocus`/`infocus` CLIs: the DND DB writes an
// Assertions.json whose active-focus entries carry non-empty storeAssertionRecords.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DND_ASSERTIONS = path.join(os.homedir(), 'Library', 'DoNotDisturb', 'DB', 'Assertions.json');

function parseFocusAssertions(jsonString) {
  if (!jsonString || typeof jsonString !== 'string') return false;
  let obj;
  try { obj = JSON.parse(jsonString); } catch { return false; }
  const data = obj && Array.isArray(obj.data) ? obj.data : [];
  return data.some(
    (entry) => entry && Array.isArray(entry.storeAssertionRecords) && entry.storeAssertionRecords.length > 0
  );
}

function isFocusActive() {
  if (process.platform !== 'darwin') return false;
  try {
    return parseFocusAssertions(fs.readFileSync(DND_ASSERTIONS, 'utf-8'));
  } catch {
    return false; // absent/illisible → considérer "pas de Focus" (comportement actuel)
  }
}

module.exports = { parseFocusAssertions, isFocusActive, DND_ASSERTIONS };
