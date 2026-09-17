// terminal-mux.js — pure helpers for the multiplexer-aware focus paths
// (cmux, tmux). No I/O here: focus.js reads the processes / files and hands
// the raw text to these functions, which are unit-tested in
// test/terminal-mux.test.js.
//
// Why this exists: walking the parent chain of Claude's PID (focus.js) finds
// nothing useful under a multiplexer. Under cmux the chain ends on the cmux
// binary, which we did not recognise → iTerm2 fallback. Under tmux the server
// is re-parented to launchd, so no host terminal is ever found. Both cases
// carry their answer in the ENVIRONMENT of the Claude process instead:
//   cmux  → CMUX_SURFACE_ID (or CMUX_PANEL_ID on older builds), CMUX_BUNDLE_ID
//   tmux  → TMUX=<socket>,<server pid>,<idx> + TMUX_PANE=%N
// `ps eww -o command= -p <pid>` prints the command line followed by the
// environment as KEY=value tokens, which parseProcessEnv decodes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAR_TOKEN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const SHELL_META_RE = /[;&|`$(){}!<>"\\\n\r]/;

// `ps eww -o command=` output → { KEY: value }. Tokens are space-separated;
// a token that does not look like KEY=value is a continuation of the previous
// value (values may contain spaces). Everything before the first variable is
// the command line and is dropped — even when it contains "=" (e.g.
// `--mcp-config={…}` never matches VAR_TOKEN_RE because of the leading dash).
function parseProcessEnv(psOutput) {
  const env = {};
  if (typeof psOutput !== 'string' || !psOutput) return env;
  let current = null;
  for (const token of psOutput.replace(/\r?\n$/, '').split(' ')) {
    const m = VAR_TOKEN_RE.exec(token);
    if (m) {
      current = m[1];
      env[current] = m[2];
    } else if (current !== null) {
      env[current] += ' ' + token;
    }
  }
  return env;
}

// { socket, pane } when the process lives inside a tmux pane, else null.
// The socket path is later passed to `tmux -S` via execFile (no shell), but
// we still refuse metacharacters: the same value is echoed into a `write text`
// AppleScript when we have to open an attach tab.
function tmuxTargetFromEnv(env) {
  if (!env || typeof env.TMUX !== 'string' || typeof env.TMUX_PANE !== 'string') return null;
  const socket = env.TMUX.split(',')[0];
  if (!socket || !socket.startsWith('/') || SHELL_META_RE.test(socket)) return null;
  if (!/^%\d+$/.test(env.TMUX_PANE)) return null;
  return { socket, pane: env.TMUX_PANE };
}

// Surface UUID from the cmux environment. CMUX_SURFACE_ID is the current
// name; CMUX_PANEL_ID is what cmux ≤ 0.64 exported (seen live on a session
// started before the app update, both names observed the same day).
function cmuxSurfaceFromEnv(env) {
  if (!env) return null;
  for (const key of ['CMUX_SURFACE_ID', 'CMUX_PANEL_ID']) {
    const v = env[key];
    if (typeof v === 'string' && UUID_RE.test(v)) return v;
  }
  return null;
}

function isCmuxEnv(env) {
  return !!(env && (env.CMUX_BUNDLE_ID || cmuxSurfaceFromEnv(env)));
}

// Parent-chain recognition (comm= is "cmux", command= is the .app binary).
// `cmux-cua` (the computer-use MCP helper) is a CHILD of Claude, never a
// parent, but it is excluded anyway so a future re-parenting can't fool us.
function isCmuxProcess(comm, command) {
  const c = String(comm || '').toLowerCase();
  const full = String(command || '').toLowerCase();
  if (c === 'cmux') return true;
  return full.includes('cmux.app/contents/macos/cmux') && !full.includes('cmux-cua');
}

// cmux keeps a map session id → surface in ~/.cmuxterm/claude-hook-sessions.json
// (written by its own Claude hooks). Preferred over the env: it survives a
// surface being moved and needs no `ps`.
function cmuxSurfaceForSession(store, sessionId) {
  if (!store || typeof store !== 'object' || !sessionId) return null;
  const rec = store.sessions && store.sessions[sessionId];
  if (rec && typeof rec.surfaceId === 'string' && UUID_RE.test(rec.surfaceId)) {
    const workspaceId = typeof rec.workspaceId === 'string' && UUID_RE.test(rec.workspaceId) ? rec.workspaceId : null;
    return { surfaceId: rec.surfaceId, workspaceId };
  }
  const active = store.activeSessionsBySurface;
  if (active && typeof active === 'object') {
    for (const [surfaceId, v] of Object.entries(active)) {
      if (v && v.sessionId === sessionId && UUID_RE.test(surfaceId)) return { surfaceId, workspaceId: null };
    }
  }
  return null;
}

// « cockpit voit-il cette session ? » — vrai quand elle vit dans une surface
// cmux. Sert au réglage anti-doublon de notification : cockpit ne couvre QUE
// ce qui tourne dans cmux, donc c'est exactement la frontière du hand-off.
// Le store garde des entrées figées quand un process meurt sans SessionEnd
// (cmux quitté, socket muet — cf. leur LRN-016), d'où le filtre sur pid
// vivant ; une entrée SANS pid est gardée : on ne peut pas prouver sa mort,
// et on préfère un doublon à une alerte perdue.
function sessionInCmux(store, sessionId, isAlive) {
  if (!cmuxSurfaceForSession(store, sessionId)) return false;
  const rec = store.sessions && store.sessions[sessionId];
  const pid = rec && rec.pid;
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return true;
  return typeof isAlive === 'function' ? !!isAlive(pid) : true;
}

// `tmux list-clients -F '#{client_pid}\t#{client_tty}'` → [{ pid, tty }]
function parseTmuxClients(output) {
  const out = [];
  for (const line of String(output || '').split('\n')) {
    const [pidStr, tty] = line.split('\t');
    const pid = parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0 || !tty || !tty.startsWith('/dev/')) continue;
    out.push({ pid, tty });
  }
  return out;
}

// `cmux top --all --processes --format tsv` → surface ref hosting <pid>.
// Columns: cpu, mem, count, kind, id, parent, name. A process appears once
// per grouping (under its workspace "tag", under its surface, …); its parent
// is either a surface ref, another pid, or a tag/window we don't care about.
// We climb pid parents until a `surface:N` shows up.
function cmuxSurfaceForPid(tsv, pid) {
  const parents = new Map(); // pid → Set(parent ids)
  for (const line of String(tsv || '').split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 6 || cols[3] !== 'process') continue;
    const id = parseInt(cols[4], 10);
    if (!Number.isFinite(id)) continue;
    if (!parents.has(id)) parents.set(id, new Set());
    parents.get(id).add(cols[5]);
  }
  const seen = new Set();
  let frontier = [parseInt(pid, 10)];
  for (let depth = 0; depth < 16 && frontier.length; depth++) {
    const next = [];
    for (const p of frontier) {
      if (seen.has(p)) continue;
      seen.add(p);
      for (const parent of parents.get(p) || []) {
        if (parent.startsWith('surface:')) return parent;
        const ppid = parseInt(parent, 10);
        if (Number.isFinite(ppid) && String(ppid) === parent) next.push(ppid);
      }
    }
    frontier = next;
  }
  return null;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// Shell line to attach a client to the tmux session (typed into a new
// terminal when no client is attached). `=name` = exact match, no prefix
// resolution. controlMode → iTerm2 native tabs (`-CC`).
function tmuxAttachCommand(socket, sessionName, { controlMode = false } = {}) {
  if (!socket || !socket.startsWith('/') || SHELL_META_RE.test(socket)) return null;
  if (!sessionName || !/^[\w.@-]+$/.test(sessionName)) return null;
  const cc = controlMode ? ' -CC' : '';
  return `tmux -S ${shellQuote(socket)}${cc} attach -t ${shellQuote('=' + sessionName)}`;
}

module.exports = {
  parseProcessEnv,
  tmuxTargetFromEnv,
  cmuxSurfaceFromEnv,
  isCmuxEnv,
  isCmuxProcess,
  cmuxSurfaceForSession,
  sessionInCmux,
  parseTmuxClients,
  cmuxSurfaceForPid,
  tmuxAttachCommand,
};
