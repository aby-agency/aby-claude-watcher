const { exec, execFile, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { log, DEBUG } = require('./logger');
const mux = require('./terminal-mux');
const dlog = (...args) => { if (DEBUG) log.debug('[focus]', ...args); };

// cmux (https://cmux.com) — macOS terminal built on Ghostty, one surface per
// terminal. Its bundled CLI talks to the app over a Unix socket (password
// stored in the app's settings, read by the CLI itself — verified from a
// process outside cmux's environment).
const CMUX_BUNDLE_ID = 'com.cmuxterm.app';
const CMUX_CLI_DEFAULT = '/Applications/cmux.app/Contents/Resources/bin/cmux';
// Map session id → surface, written by cmux's own Claude Code hooks.
const CMUX_HOOK_STORE = path.join(os.homedir(), '.cmuxterm', 'claude-hook-sessions.json');
const TMUX_CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];
const EXEC_TIMEOUT_MS = 3000;

function sanitizePid(pid) {
  const n = parseInt(pid, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
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
    return focusMac(terminalApp, terminalId, pid, cwd, session.sessionId);
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
      // Before ghostty: cmux embeds Ghostty (TERM_PROGRAM=ghostty) but is its
      // own app — the parent chain is zsh → login → cmux.
      if (mux.isCmuxProcess(comm, command)) return { app: 'cmux' };
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

function focusMac(terminalApp, terminalId, pid, cwd, sessionId) {
  const hint = (terminalApp || '').toLowerCase();

  // Multiplexers first, from the ENVIRONMENT of the Claude process: the
  // parent chain is useless there (tmux server re-parented to launchd; cmux
  // unknown to older builds) and the `cc` hint is misleading (cmux exports
  // TERM_PROGRAM=ghostty, which would activate the standalone Ghostty app).
  const env = readProcessEnv(pid);
  const tmuxTarget = mux.tmuxTargetFromEnv(env);
  if (tmuxTarget) {
    log.info(`[focus] tmux socket=${tmuxTarget.socket} pane=${tmuxTarget.pane} (pid ${pid})`);
    return focusTmux(tmuxTarget, cwd);
  }
  if (mux.isCmuxEnv(env)) {
    log.info(`[focus] cmux via env (pid ${pid})`);
    return focusCmux(sessionId, env, pid);
  }

  const detected = detectTerminalFromPid(pid) || {};
  const app = hint || detected.app || '';
  const helperPid = detected.helperPid;
  dlog(`focusMac pid=${pid} cwd=${cwd} hint="${hint}" detected=${JSON.stringify(detected)} → app="${app}"`);

  if (app === 'cmux') return focusCmux(sessionId, env, pid);
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
  if (app === 'ghostty') return focusGhosttyWindow(cwd);
  if (app === 'hyper') return runAppleScript(`tell application "Hyper" to activate`);
  if (app === 'terminal' || app.includes('apple_terminal')) return focusTerminalApp(pid, cwd);

  return focusITerm2(pid, cwd);
}

// ---------------------------------------------------------------------------
// Multiplexers: cmux and tmux
// ---------------------------------------------------------------------------

function readProcessEnv(pid) {
  if (!pid) return {};
  try {
    return mux.parseProcessEnv(execSync(`ps eww -o command= -p ${pid}`, { encoding: 'utf-8', timeout: 500 }));
  } catch (e) {
    dlog('readProcessEnv error', e.message);
    return {};
  }
}

function execFileP(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error((stderr || err.message || '').trim());
        e.stderr = stderr;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

function cmuxCli(env) {
  const fromEnv = env && sanitizePath(env.CMUX_BUNDLED_CLI_PATH);
  for (const p of [fromEnv, CMUX_CLI_DEFAULT]) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function tmuxBin() {
  for (const p of TMUX_CANDIDATES) if (fs.existsSync(p)) return p;
  return 'tmux';
}

function activateCmux() {
  return runAppleScript(`tell application id "${CMUX_BUNDLE_ID}" to activate`);
}

function readCmuxHookStore() {
  try {
    return JSON.parse(fs.readFileSync(CMUX_HOOK_STORE, 'utf-8'));
  } catch {
    return null;
  }
}

// Focus the cmux surface hosting the session: `surface.focus` selects the
// workspace AND the surface (verified on 0.64.23), then the app is raised.
// Surface id comes from cmux's hook store (session id → surface), else from
// the env of the Claude process. A missing id still raises cmux.
function focusCmux(sessionId, env, pid) {
  const cli = cmuxCli(env);
  const fromStore = mux.cmuxSurfaceForSession(readCmuxHookStore(), sessionId);
  const surfaceId = (fromStore && fromStore.surfaceId) || mux.cmuxSurfaceFromEnv(env);
  if (!cli || !surfaceId) {
    log.info(`[focus] cmux: ${cli ? 'no surface for ' + (sessionId || pid) : 'CLI not found'} → activate only`);
    return activateCmux();
  }
  log.info(`[focus] cmux surface ${surfaceId} (${fromStore ? 'hook store' : 'env'})`);
  return focusCmuxSurface(cli, surfaceId).then(activateCmux, (err) => {
    log.warn(`[focus] cmux surface.focus failed: ${err.message}`);
    return activateCmux();
  });
}

function focusCmuxSurface(cli, surfaceId) {
  return execFileP(cli, ['rpc', 'surface.focus', JSON.stringify({ surface_id: surfaceId })]);
}

// tmux: select the pane's window in its session, then raise whatever hosts
// an attached client. iTerm2 in control mode (`-CC`) mirrors the tmux current
// window as its active tab, so `select-window` + activate is the whole job
// there; under cmux we look up the surface hosting the client process.
// No client attached (Remote Control session driven from a phone): open one —
// in cmux when it runs, else an iTerm2 tab in control mode, as `rc` documents.
async function focusTmux(target, cwd) {
  const tmux = tmuxBin();
  const base = ['-S', target.socket];
  const run = (args) => execFileP(tmux, [...base, ...args]);

  try {
    await run(['select-window', '-t', target.pane]);
    await run(['select-pane', '-t', target.pane]);
  } catch (err) {
    log.warn(`[focus] tmux select failed: ${err.message}`);
    return focusFallback(cwd);
  }

  let clients = [];
  try {
    clients = mux.parseTmuxClients(await run(['list-clients', '-t', target.pane, '-F', '#{client_pid}\t#{client_tty}']));
  } catch (err) {
    dlog('tmux list-clients failed', err.message);
  }

  if (clients.length === 0) {
    let sessionName = null;
    try {
      sessionName = (await run(['display-message', '-p', '-t', target.pane, '#{session_name}'])).trim();
    } catch {}
    log.info(`[focus] tmux: no client attached to ${target.pane} (session ${sessionName || '?'}) → opening one`);
    return openTmuxClient(target.socket, sessionName, cwd);
  }

  const client = clients[0];
  const host = detectTerminalFromPid(client.pid) || {};
  log.info(`[focus] tmux client pid=${client.pid} tty=${client.tty} host=${host.app || 'unknown'}`);
  if (host.app === 'cmux') {
    const cli = cmuxCli(readProcessEnv(client.pid));
    if (cli) {
      try {
        const surface = mux.cmuxSurfaceForPid(await execFileP(cli, ['top', '--all', '--processes', '--format', 'tsv']), client.pid);
        if (surface) await focusCmuxSurface(cli, surface);
      } catch (err) {
        dlog('cmux surface lookup for tmux client failed', err.message);
      }
    }
    return activateCmux();
  }
  if (host.app === 'iterm') return runAppleScript(`tell application "iTerm2" to activate`);
  if (host.app === 'terminal') return runAppleScript(`tell application "Terminal" to activate`);
  return activateByPid(client.pid);
}

function openTmuxClient(socket, sessionName, cwd) {
  const cmuxRunning = (() => {
    try { return execSync('pgrep -x cmux', { encoding: 'utf-8', timeout: 500 }).trim() !== ''; } catch { return false; }
  })();
  if (cmuxRunning) {
    const cli = cmuxCli(null);
    const command = mux.tmuxAttachCommand(socket, sessionName);
    if (cli && command) {
      const args = ['new-workspace', '--name', `${path.basename(cwd || '') || 'tmux'} · tmux`, '--command', command, '--focus', 'true'];
      if (cwd) args.push('--cwd', cwd);
      return execFileP(cli, args).then(activateCmux, (err) => {
        log.warn(`[focus] cmux new-workspace failed: ${err.message}`);
        return activateCmux();
      });
    }
  }
  const command = mux.tmuxAttachCommand(socket, sessionName, { controlMode: true });
  if (!command) return focusFallback(cwd);
  return runAppleScript(`
    tell application "iTerm2"
      activate
      tell current window
        create tab with default profile
        tell current session
          write text "${escapeForAppleScript(command)}"
        end tell
      end tell
    end tell
  `).catch(() => focusFallback(cwd));
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

// Ghostty's AppleScript dictionary only exposes `activate` — no window/tab/
// session objects. Splits within a window are not addressable via AX either.
// Best we can do: bring Ghostty to front, then via System Events UI scripting
// raise the window whose title contains the cwd basename (Ghostty inherits
// the title from the shell's OSC sequences, which by default carry the cwd).
//
// Limitation: if multiple splits in the same window run different projects,
// only the focused split's project shows up in the window title. We can only
// target window-level here.
function focusGhosttyWindow(cwd) {
  const activate = () => runAppleScript(`tell application "Ghostty" to activate`);
  if (!cwd) return activate();
  const basename = path.basename(cwd);
  if (!basename || /[;&|`$(){}!<>"\\\n\r]/.test(basename)) return activate();
  const safe = escapeForAppleScript(basename);
  const script = `
    tell application "Ghostty" to activate
    delay 0.05
    tell application "System Events"
      if not (exists process "ghostty") then return
      tell process "ghostty"
        repeat with w in windows
          if name of w contains "${safe}" then
            perform action "AXRaise" of w
            return
          end if
        end repeat
      end tell
    end tell
  `;
  return runAppleScript(script).catch((err) => {
    dlog('ghostty UI scripting failed:', err.message);
    return activate();
  });
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

module.exports = { focusTerminal };
