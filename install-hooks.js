// install-hooks.js
// Installs the Aby permission-detection hook into a Claude Code settings file.
// Used by main.js to install a GLOBAL hook in `~/.claude/settings.json` (the
// user-level file that actually loads hooks — `~/.claude/settings.local.json`
// is IGNORED at user scope). Also keeps the per-project helper for the `cc`
// wrapper path. Safe to call repeatedly.
//
// Safety rules:
// - If the existing file is not valid JSON, BAIL without writing — never
//   clobber a user's settings.
// - Recognize our own entries by hook filename so relocating the app heals the
//   reference in place instead of adding a duplicate.
// - Never touch hooks/keys that aren't ours.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK_FILENAME = 'aby-permission-hook.sh';
const HOOK_EVENTS = ['PreToolUse', 'Notification'];

function isOurHook(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
  return hooks.some(h => typeof h === 'object' && h && typeof h.command === 'string' && h.command.endsWith('/' + HOOK_FILENAME));
}

function ensureBlock(entries, event, hookPath) {
  if (!Array.isArray(entries)) return { entries: [], changed: true };
  let changed = false;
  let found = false;
  for (const block of entries) {
    if (!isOurHook(block)) continue;
    found = true;
    // Self-heal: if the command path is stale, update it in place.
    for (const h of block.hooks || []) {
      if (h && h.command !== hookPath) {
        h.command = hookPath;
        changed = true;
      }
    }
    break;
  }
  if (!found) {
    entries.push({
      matcher: event === 'PreToolUse' ? '*' : '',
      hooks: [{ type: 'command', command: hookPath }],
    });
    changed = true;
  }
  return { entries, changed };
}

// Reads a settings JSON file (or {} if absent); returns null if it exists but
// can't be parsed (caller must NOT overwrite in that case).
function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch (e) {
    return null; // unparseable — signal bail
  }
}

// Merge our PreToolUse + Notification hooks into an arbitrary settings file.
function installHooksIntoFile(settingsPath, hookPath) {
  if (!settingsPath || typeof settingsPath !== 'string') return { installed: false, reason: 'invalid-path' };
  const data = readSettings(settingsPath);
  if (data === null) return { installed: false, reason: 'parse-failed' };

  const hooks = (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) ? data.hooks : {};
  let changed = false;
  for (const event of HOOK_EVENTS) {
    const arr = Array.isArray(hooks[event]) ? hooks[event] : [];
    const out = ensureBlock(arr, event, hookPath);
    hooks[event] = out.entries;
    if (out.changed) changed = true;
  }

  if (!changed) return { installed: true, reason: 'already-present' };

  try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    data.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n');
    return { installed: true, reason: 'written' };
  } catch (e) {
    return { installed: false, reason: 'write-failed', error: e.message };
  }
}

// Remove ONLY our hook blocks from a settings file; leave everything else.
function removeHookFromFile(settingsPath) {
  if (!settingsPath || typeof settingsPath !== 'string') return { removed: false, reason: 'invalid-path' };
  if (!fs.existsSync(settingsPath)) return { removed: false, reason: 'absent' };
  const data = readSettings(settingsPath);
  if (data === null) return { removed: false, reason: 'parse-failed' };
  const hooks = (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) ? data.hooks : null;
  if (!hooks) return { removed: false, reason: 'no-hooks' };

  let changed = false;
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = hooks[event].filter(b => !isOurHook(b));
    if (kept.length !== hooks[event].length) changed = true;
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!changed) return { removed: false, reason: 'not-present' };

  try {
    data.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n');
    return { removed: true, reason: 'written' };
  } catch (e) {
    return { removed: false, reason: 'write-failed', error: e.message };
  }
}

// Per-project install into `<cwd>/.claude/settings.local.json` (kept for the
// `cc` wrapper path; the app itself now prefers the global install below).
function installHooks(cwd, hookPath) {
  if (!cwd || typeof cwd !== 'string') return { installed: false, reason: 'invalid-cwd' };
  if (!hookPath || !fs.existsSync(hookPath)) return { installed: false, reason: 'hook-missing' };
  return installHooksIntoFile(path.join(cwd, '.claude', 'settings.local.json'), hookPath);
}

function globalSettingsPath() {
  // User-level settings.json — the ONLY user-scope file that loads hooks
  // (settings.local.json is ignored at user scope). Covers ALL sessions,
  // any project, whether or not the `cc` wrapper is used.
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function installGlobalHook(hookPath) {
  if (!hookPath || !fs.existsSync(hookPath)) return { installed: false, reason: 'hook-missing' };
  return installHooksIntoFile(globalSettingsPath(), hookPath);
}

function removeGlobalHook() {
  return removeHookFromFile(globalSettingsPath());
}

// Absolute path to the hook script. In a packaged app the script lives in
// `app.asar.unpacked/bin/` (a REAL file Claude Code's shell can exec) — inside
// `app.asar` it would not be a real file. Requires `asarUnpack` on bin/ in the
// build config. In dev, __dirname has no `app.asar` so the replace is a no-op.
function getDefaultHookPath() {
  return path.join(__dirname, 'bin', HOOK_FILENAME).replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );
}

module.exports = {
  installHooks,
  installHooksIntoFile,
  removeHookFromFile,
  installGlobalHook,
  removeGlobalHook,
  globalSettingsPath,
  getDefaultHookPath,
};
