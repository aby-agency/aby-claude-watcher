// install-hooks.js
// Installs the Aby permission-detection hook into a project's
// `.claude/settings.local.json`. Designed to be safe to call repeatedly.
//
// Safety rules:
// - Refuse to write to `$HOME/.claude/settings.local.json` (that's the user's
//   global Claude Code config, not a project-local one).
// - If the existing file exists and is not valid JSON, BAIL without writing —
//   never clobber a user's settings (Claude Code may accept comments some day).
// - Recognize our own entries by hook filename so relocating the app heals the
//   reference instead of adding a duplicate.

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
    // Self-heal: if the command path is stale, update it in place
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

function installHooks(cwd, hookPath) {
  if (!cwd || typeof cwd !== 'string') return { installed: false, reason: 'invalid-cwd' };
  if (!hookPath || !fs.existsSync(hookPath)) return { installed: false, reason: 'hook-missing' };

  // Refuse to write into $HOME — that's the global Claude Code config dir.
  if (path.resolve(cwd) === path.resolve(os.homedir())) {
    return { installed: false, reason: 'home-dir-refused' };
  }

  const settingsDir = path.join(cwd, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.local.json');

  let data = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    } catch (e) {
      // Existing file we can't parse — do NOT overwrite user data.
      return { installed: false, reason: 'parse-failed' };
    }
  }

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
    if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
    data.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n');
    return { installed: true, reason: 'written' };
  } catch (e) {
    return { installed: false, reason: 'write-failed', error: e.message };
  }
}

function getDefaultHookPath() {
  return path.join(__dirname, 'bin', HOOK_FILENAME);
}

module.exports = { installHooks, getDefaultHookPath };
