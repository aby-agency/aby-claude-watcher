const { exec, execSync } = require('child_process');
const path = require('path');

const DEBUG = process.argv.includes('--dev') || !!process.env.ABY_DEBUG;
const dlog = (...args) => { if (DEBUG) console.log('[focus]', ...args); };

function sanitizePid(pid) {
  const n = parseInt(pid, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function sanitizeSessionId(id) {
  if (!id || typeof id !== 'string') return null;
  // Session IDs are UUIDs — only allow alphanumeric + hyphens
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return id;
}

function sanitizePath(p) {
  if (!p || typeof p !== 'string') return null;
  // Block shell metacharacters and quote/backslash that could break quoted args
  if (/[;&|`$(){}!<>"\\\n\r]/.test(p)) return null;
  return p;
}

function focusTerminal(session) {
  const terminalApp = session.terminalApp;
  const terminalId = session.terminalId;
  const pid = sanitizePid(session.pid);
  const cwd = sanitizePath(session.cwd);

  if (process.platform === 'darwin') {
    return focusMac(terminalApp, terminalId, pid, cwd);
  } else if (process.platform === 'win32') {
    return focusWindows(pid, cwd);
  } else {
    return focusFallback(cwd);
  }
}

// Walk up the process tree from Claude's PID to find the host terminal app.
// Returns { app, helperPid } where helperPid is the direct parent process
// (for VSCode/Cursor, the specific Helper process for that window).
//
// We look at both `comm=` (truncated 16-char executable name — "Electron" for
// VSCode/Cursor main proc) AND `command=` (full path — contains
// "Visual Studio Code.app" or "Cursor.app") because the truncated name
// alone misses the main process for Electron-based editors.
function detectTerminalFromPid(pid) {
  if (!pid) return null;
  try {
    let cur = pid;
    let lastHelperPid = null;
    for (let i = 0; i < 6; i++) {
      const ppid = parseInt(execSync(`ps -o ppid= -p ${cur}`, { encoding: 'utf-8', timeout: 500 }).trim(), 10);
      if (!Number.isFinite(ppid) || ppid <= 1) break;
      const comm = execSync(`ps -o comm= -p ${ppid}`, { encoding: 'utf-8', timeout: 500 }).trim();
      const command = execSync(`ps -o command= -p ${ppid}`, { encoding: 'utf-8', timeout: 500 }).trim();
      const lc = comm.toLowerCase();
      const cmdLc = command.toLowerCase();
      dlog(`step ${i}: pid=${ppid} comm="${comm}" command="${command.slice(0, 100)}"`);

      if (lc.includes('iterm')) return { app: 'iterm' };
      if (lc.includes('warp')) return { app: 'warp' };
      if (lc.includes('wezterm')) return { app: 'wezterm' };
      if (lc.includes('alacritty')) return { app: 'alacritty' };
      if (lc.includes('kitty')) return { app: 'kitty' };
      if (lc.includes('ghostty')) return { app: 'ghostty' };
      if (lc.includes('hyper')) return { app: 'hyper' };

      // VSCode/Cursor Helper processes (one per window). We track the first
      // helper we see — that's the renderer for the specific window that
      // owns this terminal pane. Then we keep walking up to find the
      // canonical app process so we know whether we're in Code or Cursor.
      if (lc.includes('cursor helper') || cmdLc.includes('cursor helper')) {
        if (!lastHelperPid) lastHelperPid = ppid;
        cur = ppid;
        continue;
      }
      if (lc.includes('code helper') || cmdLc.includes('code helper')) {
        if (!lastHelperPid) lastHelperPid = ppid;
        cur = ppid;
        continue;
      }

      // Main app — match by full path because comm= is "Electron" for
      // both Code and Cursor main proc on macOS.
      if (cmdLc.includes('cursor.app/contents/')) return { app: 'cursor', helperPid: lastHelperPid };
      if (cmdLc.includes('visual studio code.app/contents/')) return { app: 'vscode', helperPid: lastHelperPid };
      // Old-style fallbacks (some installs/symlinks)
      if (lc.endsWith('/cursor') || comm === 'Cursor') return { app: 'cursor', helperPid: lastHelperPid };
      if (lc.endsWith('/code') || comm === 'Code') return { app: 'vscode', helperPid: lastHelperPid };
      if (lc === 'terminal' || lc.endsWith('/terminal')) return { app: 'terminal' };
      cur = ppid;
    }
  } catch (e) {
    dlog('detect error', e.message);
  }
  return null;
}

// Activate a specific process window (by Unix PID) using System Events
function activateByPid(pid) {
  if (!pid) return Promise.resolve();
  return runAppleScript(`
    tell application "System Events"
      set procs to (every process whose unix id is ${pid})
      if (count of procs) > 0 then
        set frontmost of (item 1 of procs) to true
      end if
    end tell
  `).catch(() => {});
}

function focusMac(terminalApp, terminalId, pid, cwd) {
  const hint = (terminalApp || '').toLowerCase();
  const detected = detectTerminalFromPid(pid) || {};
  const app = hint || detected.app || '';
  const helperPid = detected.helperPid;
  dlog(`focusMac pid=${pid} cwd=${cwd} hint="${hint}" detected=${JSON.stringify(detected)} → app="${app}"`);

  if (app.includes('iterm')) return focusITerm2(pid, cwd);
  if (app.includes('warp')) return runAppleScript(`tell application "Warp" to activate`);

  // VSCode / Cursor: each window is a separate Helper process, but
  // `set frontmost of helperPid` reliably doesn't pick that window — macOS
  // brings the last-active window of the parent app instead. Match by
  // window title (which contains the workspace folder name) via System Events.
  if (app === 'vscode' || app === 'cursor') {
    const appName = app === 'cursor' ? 'Cursor' : 'Visual Studio Code';
    const procName = app === 'cursor' ? 'Cursor' : 'Code';
    return focusEditorWindowByCwd(appName, procName, cwd);
  }

  if (app === 'wezterm') return runAppleScript(`tell application "WezTerm" to activate`);
  if (app === 'alacritty') return runAppleScript(`tell application "Alacritty" to activate`);
  if (app === 'kitty') return runAppleScript(`tell application "kitty" to activate`);
  if (app === 'ghostty') return runAppleScript(`tell application "Ghostty" to activate`);
  if (app === 'hyper') return runAppleScript(`tell application "Hyper" to activate`);
  if (app === 'terminal' || app.includes('apple_terminal')) return focusTerminalApp(pid, cwd);

  return focusITerm2(pid, cwd);
}

// Activate the editor window that has `cwd` open as workspace.
//
// We use `open -a` with the project path: macOS LaunchServices routes this
// to the existing window of the editor that already has that workspace
// open, without creating a duplicate window. The huge advantage over a
// System Events / AXRaise approach is that `open` doesn't require any
// Accessibility or Automation permission — works out of the box even with
// ad-hoc-signed builds and during `npm run dev`.
function focusEditorWindowByCwd(appName, procName, cwd) {
  const fallbackActivate = () => runAppleScript(`tell application "${appName}" to activate`);
  if (!cwd || /[;&|`$(){}!<>"\\\n\r]/.test(cwd)) {
    dlog('no/invalid cwd, fallback activate');
    return fallbackActivate();
  }
  dlog(`open -a "${appName}" "${cwd}"`);
  return new Promise((resolve) => {
    exec(`open -a "${appName}" "${cwd}"`, (err, stdout, stderr) => {
      if (err) {
        dlog('open error:', (stderr || err.message || '').trim());
        return fallbackActivate().then(resolve, resolve);
      }
      resolve();
    });
  });
}

function fallbackOpenNewTab(cwd) {
  if (!cwd) return runAppleScript(`tell application "iTerm2" to activate`);
  return runAppleScript(`
    tell application "iTerm2"
      activate
      tell current window
        create tab with default profile
        tell current session
          write text "cd ${escapeForAppleScript(cwd)}"
        end tell
      end tell
    end tell
  `);
}

function focusITerm2(pid, cwd) {
  // Fast strategy: find the TTY of the Claude PID (or its ancestors) in Node,
  // then tell iTerm2 to focus the session with that TTY directly.
  // This avoids running `do shell script` for every iTerm2 session.
  let targetTty = null;
  try {
    // Get the TTY of the claude process
    const out = execSync(`ps -p ${pid} -o tty=`, { encoding: 'utf-8', timeout: 500 }).trim();
    if (out && out !== '??') {
      targetTty = `/dev/${out}`;
    }
  } catch {}

  if (targetTty) {
    const script = `
      tell application "iTerm2"
        activate
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              if (tty of s) is "${targetTty}" then
                select t
                select s
                return
              end if
            end repeat
          end repeat
        end repeat
      end tell
    `;
    return runAppleScript(script).catch(() => fallbackOpenNewTab(cwd));
  }

  // Fallback: activate iTerm2, open new tab if cwd known
  return runAppleScript(`tell application "iTerm2" to activate`).catch(() => {
    // Fallback: just activate iTerm2 or open new tab in project dir
    if (cwd) {
      return runAppleScript(`
        tell application "iTerm2"
          activate
          tell current window
            create tab with default profile
            tell current session
              write text "cd ${escapeForAppleScript(cwd)}"
            end tell
          end tell
        end tell
      `);
    }
    return runAppleScript(`tell application "iTerm2" to activate`);
  });
}

function focusTerminalApp(pid, cwd) {
  // Same TTY strategy as iTerm2: find TTY via Node, match in AppleScript
  let targetTty = null;
  try {
    const out = execSync(`ps -p ${pid} -o tty=`, { encoding: 'utf-8', timeout: 500 }).trim();
    if (out && out !== '??') targetTty = `/dev/${out}`;
  } catch {}

  if (targetTty) {
    const script = `
      tell application "Terminal"
        activate
        repeat with w in windows
          repeat with t in tabs of w
            if (tty of t) is "${targetTty}" then
              set selected tab of w to t
              set index of w to 1
              return
            end if
          end repeat
        end repeat
      end tell
    `;
    return runAppleScript(script).catch(() => {
      if (cwd) {
        return runAppleScript(`
          tell application "Terminal"
            activate
            do script "cd ${escapeForAppleScript(cwd)}"
          end tell
        `);
      }
      return runAppleScript(`tell application "Terminal" to activate`);
    });
  }

  return runAppleScript(`tell application "Terminal" to activate`);
}

function focusWindows(pid, cwd) {
  if (pid) {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }
"@
      $process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
      if ($process) {
        [Win32]::ShowWindow($process.MainWindowHandle, 9)
        [Win32]::SetForegroundWindow($process.MainWindowHandle)
      }
    `;
    return new Promise((resolve, reject) => {
      exec(`powershell -Command "${script.replace(/"/g, '\\"')}"`, (err) => {
        if (err) return focusFallback(cwd).then(resolve, reject);
        resolve();
      });
    });
  }
  return focusFallback(cwd);
}

function focusFallback(cwd) {
  const dir = cwd || process.env.HOME || process.env.USERPROFILE;

  if (process.platform === 'darwin') {
    // Default to iTerm2 since it's the user's main terminal
    return runAppleScript(`
      tell application "iTerm2"
        activate
        tell current window
          create tab with default profile
          tell current session
            write text "cd ${escapeForAppleScript(dir)}"
          end tell
        end tell
      end tell
    `).catch(() => {
      return runAppleScript(`
        tell application "Terminal"
          activate
          do script "cd ${escapeForAppleScript(dir)}"
        end tell
      `);
    });
  } else if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      exec(`start cmd /K "cd /d ${dir}"`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      exec(`x-terminal-emulator --working-directory="${dir}" 2>/dev/null || xterm -e "cd ${dir} && bash" &`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }
}

function escapeForAppleScript(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    // Use -e per line to avoid escaping issues
    const lines = script.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const args = lines.map(l => `-e '${l.replace(/'/g, "'\\''")}'`).join(' ');
    exec(`osascript ${args}`, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim();
        const e = new Error(msg);
        e.stderr = stderr;
        reject(e);
      } else {
        resolve(stdout);
      }
    });
  });
}

function resumeSession(sessionId, cwd, opts) {
  const safeId = sanitizeSessionId(sessionId);
  if (!safeId) return Promise.reject(new Error('Invalid session ID'));
  const skipPerms = !!(opts && opts.skipPermissions);
  const flags = skipPerms ? ' --dangerously-skip-permissions' : '';
  const cmd = `claude --resume ${safeId}${flags}`;
  const dir = sanitizePath(cwd) || process.env.HOME;

  if (process.platform === 'darwin') {
    // Open new iTerm2 tab, cd to project dir, run claude --resume
    return runAppleScript(`
      tell application "iTerm2"
        activate
        tell current window
          create tab with default profile
          tell current session
            write text "cd ${escapeForAppleScript(dir)} && ${cmd}"
          end tell
        end tell
      end tell
    `).catch(() => {
      // Fallback to Terminal.app
      return runAppleScript(`
        tell application "Terminal"
          activate
          do script "cd ${escapeForAppleScript(dir)} && ${cmd}"
        end tell
      `);
    });
  } else if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      exec(`start cmd /K "cd /d ${dir} && ${cmd}"`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      exec(`x-terminal-emulator -e "cd ${dir} && ${cmd}" 2>/dev/null &`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }
}

module.exports = { focusTerminal, resumeSession };
