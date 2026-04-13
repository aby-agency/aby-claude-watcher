const { exec } = require('child_process');

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
  // Block shell metacharacters
  if (/[;&|`$(){}!<>]/.test(p)) return null;
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

function focusMac(terminalApp, terminalId, pid, cwd) {
  const app = (terminalApp || '').toLowerCase();

  // iTerm2 — full session-level focus via PID or tty matching
  if (app.includes('iterm')) {
    return focusITerm2(pid, cwd);
  }

  // Terminal.app
  if (app.includes('terminal')) {
    return focusTerminalApp(pid, cwd);
  }

  // Warp — can only activate the app, no tab control
  if (app.includes('warp')) {
    return runAppleScript(`tell application "Warp" to activate`);
  }

  // Unknown terminal or no terminal info — default to iTerm2
  // Don't pass arbitrary terminalApp to AppleScript (injection risk)
  return focusITerm2(pid, cwd);
}

function focusITerm2(pid, cwd) {
  // Strategy: iterate all iTerm2 sessions, find the one whose tty
  // has a child process matching our Claude PID
  const script = `
    tell application "iTerm2"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            set ttyName to (tty of s)
            try
              set shellOutput to (do shell script "pgrep -P $(lsof -t " & ttyName & " 2>/dev/null | head -1) 2>/dev/null | xargs -I{} pgrep -P {} 2>/dev/null; lsof -t " & ttyName & " 2>/dev/null")
              if shellOutput contains "${pid}" then
                select t
                select s
                return
              end if
            end try
          end repeat
        end repeat
      end repeat
    end tell
  `;

  return runAppleScript(script).catch(() => {
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
  const script = `
    tell application "Terminal"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          set tabProcs to processes of t
          repeat with p in tabProcs
            if p contains "${pid}" then
              set selected tab of w to t
              set index of w to 1
              return
            end if
          end repeat
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
    exec(`osascript ${args}`, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

function resumeSession(sessionId, cwd) {
  const safeId = sanitizeSessionId(sessionId);
  if (!safeId) return Promise.reject(new Error('Invalid session ID'));
  const cmd = `claude --resume ${safeId}`;
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
