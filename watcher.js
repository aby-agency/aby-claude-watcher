const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

const SCAN_INTERVAL = 2000;
const POLL_INTERVAL = 250;
const WAITING_DELAY = 2000;

const DEBUG = process.argv.includes('--dev') || !!process.env.ABY_DEBUG;

const STATES = {
  THINKING: { name: 'thinking', color: '#a78bfa' },
  RUNNING: { name: 'running', color: '#22c55e' },
  WAITING: { name: 'waiting', color: '#3b82f6' },
  PENDING: { name: 'pending', color: '#f97316' },
  ERROR: { name: 'error', color: '#ef4444' },
};

class SessionWatcher extends EventEmitter {
  constructor(configModule) {
    super();
    this.config = configModule;
    this.sessions = new Map();
    this.fileWatchers = new Map();
    this.fileOffsets = new Map();
    this.waitingTimers = new Map();
    this.pendingTimers = new Map(); // deferred PENDING transitions from hook pings
    this.lastNotifTime = new Map(); // sessionId → timestamp of last notification
    this.scanTimer = null;
  }

  start() {
    // Restore persisted sessions
    if (this.config) {
      const saved = this.config.getSavedSessions();
      for (const [id, data] of Object.entries(saved)) {
        // Drop legacy "completed" sessions persisted by older versions —
        // we now purge sessions on completion instead of keeping them.
        if (data.stateName === 'completed') {
          this.config.deleteSession(id);
          continue;
        }
        const savedState = Object.values(STATES).find(s => s.name === data.stateName) || STATES.WAITING;

        this.sessions.set(id, {
          sessionId: id,
          pid: data.pid || null,
          cwd: data.cwd || null,
          projectName: data.projectName || 'Unknown',
          slug: data.slug || '',
          state: savedState,
          lastTool: data.lastTool || null,
          model: data.model || null,
          gitBranch: data.gitBranch || null,
          startedAt: data.startedAt || new Date().toISOString(),
          tokens: data.tokens || { input: 0, output: 0 },
          terminalApp: data.terminalApp || null,
          terminalId: data.terminalId || null,
          lastEventTime: Date.now(),
          hasActivity: savedState.name !== 'error',
          agentDispatches: new Map(),
        });
        this.emit('session-added', this.sessions.get(id));
      }

      // Purge orphan notification/customName/order entries for sessions
      // that no longer have any persisted state (deleted long ago, app
      // crashed mid-cleanup, …). Safe at startup since the only sessions
      // that should exist now are the ones just restored above.
      const knownIds = new Set(Object.keys(saved));
      const cfg = this.config.get();
      let dirty = false;
      if (cfg.notifications) {
        for (const id of Object.keys(cfg.notifications)) {
          if (!knownIds.has(id)) { delete cfg.notifications[id]; dirty = true; }
        }
      }
      if (cfg.customNames) {
        for (const id of Object.keys(cfg.customNames)) {
          if (!knownIds.has(id)) { delete cfg.customNames[id]; dirty = true; }
        }
      }
      if (Array.isArray(cfg.sessionOrder)) {
        const before = cfg.sessionOrder.length;
        cfg.sessionOrder = cfg.sessionOrder.filter(id => knownIds.has(id));
        if (cfg.sessionOrder.length !== before) dirty = true;
      }
      if (dirty && this.config.save) this.config.save();
    }

    this.scan();
    this.scanTimer = setInterval(() => this.scan(), SCAN_INTERVAL);
  }

  stop() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    for (const watcher of this.fileWatchers.values()) watcher.close();
    for (const timer of this.waitingTimers.values()) clearTimeout(timer);
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.fileWatchers.clear();
    this.fileOffsets.clear();
    this.waitingTimers.clear();
    this.pendingTimers.clear();
  }

  scan() {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) return;

      const activeSessionIds = new Set();
      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));

      // Pre-read all session.json files so we can recognise concurrent Claude
      // processes in the same cwd (different PIDs, different sessionIds) and
      // resolve /clear targets unambiguously across multiple Claudes.
      const liveSessions = [];
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));
          if (data && data.sessionId) liveSessions.push(data);
        } catch (e) {}
      }
      const liveSessionIds = new Set(liveSessions.map(d => d.sessionId));

      // Process most-recently-active session.json files first so they get
      // first dibs on the freshest unclaimed JSONL in their cwd. Critical when
      // multiple Claudes in the same cwd have all /clear'd at different times.
      liveSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      // Track which JSONLs we've already attributed to a data row this scan,
      // so two Claudes in the same cwd don't both claim the same fresh JSONL.
      const claimedJsonls = new Set();

      for (const data of liveSessions) {
        try {
          const { pid, sessionId, cwd, startedAt } = data;

          if (!sessionId) continue;

          // Find any existing tracked session for this (pid, cwd) BEFORE
          // picking a target — once we've attributed a JSONL to a Claude
          // process, we stick with it for as long as that JSONL stays fresh.
          // This prevents flapping when both Claudes in the same cwd write
          // alternately and the "freshest unclaimed" oscillates between them.
          let trackedId = null;
          for (const [id, s] of this.sessions) {
            if (s.pid === pid && s.cwd === cwd) { trackedId = id; break; }
          }

          // Determine the JSONL Claude is currently writing to for this PID:
          //   - If we already track this (pid, cwd), prefer the tracked sid
          //     unless we can find a fresher unclaimed JSONL to migrate to.
          //     Critically, never abandon a trackedId for the lagged session.json
          //     sid (which would create a duplicate tracked entry that the dup-
          //     remove fallback then has to clean up 4s later).
          //   - If we don't track this (pid, cwd) yet, trust session.json's sid
          //     unless it's stale, in which case look for a fresh unclaimed JSONL.
          let effectiveId = sessionId;
          if (trackedId) {
            if (!this._isSidStale(trackedId, cwd)) {
              effectiveId = trackedId;
            } else if (sessionId !== trackedId) {
              // trackedId is stale and session.json reports a different sid —
              // trust session.json (e.g., after /clear created a new JSONL).
              effectiveId = sessionId;
            } else {
              // session.json is lagged on the same stale sid: scan unclaimed JSONLs.
              const fresh = this._findFreshUnclaimedJsonl(cwd, liveSessionIds, claimedJsonls);
              effectiveId = fresh || trackedId;
            }
          } else if (this._isSidStale(sessionId, cwd)) {
            const fresh = this._findFreshUnclaimedJsonl(cwd, liveSessionIds, claimedJsonls);
            if (fresh) effectiveId = fresh;
          }
          claimedJsonls.add(effectiveId);
          activeSessionIds.add(effectiveId);

          if (trackedId && trackedId !== effectiveId && !this._isSidStale(effectiveId, cwd)) {
            if (DEBUG) console.log(`[watcher] /clear migrate ${trackedId.slice(0, 8)} → ${effectiveId.slice(0, 8)} (pid=${pid}, cwd=${cwd})`);
            this.migrateSession(trackedId, effectiveId);
          }

          const pidAlive = this.isPidAlive(pid);

          if (!this.sessions.has(effectiveId)) {
            const projectName = this.extractProjectName(cwd);
            // startedAt can be epoch ms or ISO string
            const startedAtISO = typeof startedAt === 'number'
              ? new Date(startedAt).toISOString()
              : (startedAt || new Date().toISOString());
            this.sessions.set(effectiveId, {
              sessionId: effectiveId,
              pid,
              cwd,
              projectName,
              slug: '',
              state: STATES.WAITING,
              lastTool: null,
              model: null,
                  gitBranch: null,
              startedAt: startedAtISO,
              tokens: { input: 0, output: 0 },
              terminalApp: null,
              terminalId: null,
              permissionMode: this.detectBypassFromPid(pid) ? 'bypassPermissions' : null,
              lastEventTime: Date.now(),
              hasActivity: false,
              agentDispatches: new Map(),
            });
            this.watchJsonl(effectiveId);
            // Persist immediately so a fresh session that hasn't yet transitioned
            // state is known to config.sessions. Otherwise the startup orphan
            // purge would nuke its notif/name/order prefs on next launch.
            this.persistSession(this.sessions.get(effectiveId));
            this.emit('session-added', this.sessions.get(effectiveId));
          } else {
            const session = this.sessions.get(effectiveId);
            // Always update from live session data (PID/cwd can change on resume)
            session.pid = pid;
            session.cwd = cwd;
            if (startedAt) {
              const startedAtISO = typeof startedAt === 'number'
                ? new Date(startedAt).toISOString() : startedAt;
              session.startedAt = startedAtISO;
            }

            if (pidAlive && session.state === STATES.ERROR) {
              // Session errored but PID is alive again — reactivate
              session.hasActivity = false;
              this.setState(effectiveId, STATES.WAITING, false);
            }

            if (!this.fileWatchers.has(effectiveId)) {
              this.watchJsonl(effectiveId);
            }
          }
        } catch (e) {
          // skip malformed session files
        }
      }

      // Sessions not in active files: check PID with a grace window
      // (session file can briefly disappear during atomic rewrites)
      for (const [id, session] of this.sessions) {
        if (activeSessionIds.has(id)) {
          session._missingTicks = 0;
          continue;
        }

        session._missingTicks = (session._missingTicks || 0) + 1;
        // Wait 2 ticks (4s) before acting
        if (session._missingTicks < 2) continue;

        if (session.pid && this.isPidAlive(session.pid)) {
          // PID alive but session file missing. If another session with the
          // same PID is already tracked (= /clear created a new ID), this
          // entry is a stale duplicate — remove it.
          const dup = [...this.sessions.values()].some(
            s => s.sessionId !== id && s.pid === session.pid && activeSessionIds.has(s.sessionId)
          );
          if (dup) {
            this.removeSession(id);
          }
          continue;
        }
        this.markCompleted(id);
      }
    } catch (e) {
      // ENOENT is expected when Claude Code is not yet running
      if (e.code !== 'ENOENT') {
        console.error('SessionWatcher scan error:', e.message);
      }
    }
  }

  // True if the JSONL for `sid` exists in `cwd`'s project dir but hasn't been
  // modified within STALE_MS — meaning Claude has /clear'd away from it.
  // Assumption: only Claude itself writes to JSONLs in `~/.claude/projects/`.
  // External tools touching these files (backup, indexers, manual edits) would
  // create false-positive freshness signals — accepted as the tradeoff for
  // not requiring per-event content parsing to attribute jsonls to PIDs.
  _isSidStale(sid, cwd) {
    const STALE_MS = 30 * 1000;
    const projDir = this._cwdToProjectDir(cwd);
    if (!projDir) return false;
    try {
      const st = fs.statSync(path.join(projDir, `${sid}.jsonl`));
      return (Date.now() - st.mtimeMs) > STALE_MS;
    } catch {
      return false; // missing JSONL: not stale, just absent
    }
  }

  // Find the freshest JSONL in `cwd` that is NOT:
  //   - named in any live session.json (a different Claude's startup sid),
  //   - already claimed by an earlier data row in this scan,
  //   - already tracked by some session in our session map (another Claude).
  // Returns the sid (filename without .jsonl) or null. Used to resolve /clear
  // targets when session.json's sid is lagged.
  _findFreshUnclaimedJsonl(cwd, liveSessionIds, claimedJsonls) {
    const STALE_MS = 30 * 1000;
    const now = Date.now();
    const projDir = this._cwdToProjectDir(cwd);
    if (!projDir) return null;
    const trackedInCwd = new Set();
    for (const [id, s] of this.sessions) {
      if (s.cwd === cwd) trackedInCwd.add(id);
    }
    let best = null;
    try {
      for (const f of fs.readdirSync(projDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const sid = f.slice(0, -'.jsonl'.length);
        if (liveSessionIds.has(sid)) continue;
        if (claimedJsonls.has(sid)) continue;
        if (trackedInCwd.has(sid)) continue;
        try {
          const st = fs.statSync(path.join(projDir, f));
          if ((now - st.mtimeMs) > STALE_MS) continue; // stale
          if (!best || st.mtimeMs > best.mtime) {
            best = { sid, mtime: st.mtimeMs };
          }
        } catch {}
      }
    } catch { return null; }
    return best ? best.sid : null;
  }

  // Resolve project dir slug from cwd (mirrors Claude Code's convention:
  // ~/.claude/projects/-<path-with-dashes>/)
  _cwdToProjectDir(cwd) {
    if (!cwd) return null;
    const slug = cwd.replace(/[^a-zA-Z0-9_-]/g, '-');
    const dir = path.join(PROJECTS_DIR, slug);
    return fs.existsSync(dir) ? dir : null;
  }

  // Check if a PID was launched with --dangerously-skip-permissions
  detectBypassFromPid(pid) {
    if (!pid) return false;
    try {
      const { execSync } = require('child_process');
      const args = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf-8', timeout: 1000 }).trim();
      return args.includes('--dangerously-skip-permissions');
    } catch {
      return false;
    }
  }

  isPidAlive(pid) {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  extractProjectName(cwd) {
    if (!cwd) return 'Unknown';
    return path.basename(cwd);
  }

  // Record every Agent tool_use we see, with its run_in_background flag and the
  // event timestamp. subagents.js joins these by toolUseId (via the agent
  // .meta.json) to filter background-vs-foreground dispatches.
  captureAgentDispatches(session, event) {
    if (!session || !session.agentDispatches) return;
    const content = event && event.message && event.message.content;
    if (!Array.isArray(content)) return;
    const tsMs = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    for (const c of content) {
      if (c && c.type === 'tool_use' && c.name === 'Agent' && c.id) {
        session.agentDispatches.set(c.id, {
          runInBackground: !!(c.input && c.input.run_in_background),
          dispatchTs: Number.isFinite(tsMs) ? tsMs : Date.now(),
        });
      }
    }
  }

  findJsonlPath(sessionId) {
    try {
      const dirs = fs.readdirSync(PROJECTS_DIR);
      for (const dir of dirs) {
        const jsonlPath = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
        if (fs.existsSync(jsonlPath)) return jsonlPath;
      }
    } catch (e) {
      // projects dir might not exist
    }
    return null;
  }

  watchJsonl(sessionId) {
    const jsonlPath = this.findJsonlPath(sessionId);
    if (!jsonlPath) {
      // Retry finding JSONL after a delay (file might not exist yet)
      setTimeout(() => {
        const retryPath = this.findJsonlPath(sessionId);
        if (retryPath) this.startFileWatch(sessionId, retryPath);
      }, 3000);
      return;
    }
    this.startFileWatch(sessionId, jsonlPath);
  }

  startFileWatch(sessionId, jsonlPath) {
    // Remember the resolved path on the session so consumers (e.g. subagent
    // tracker in main.js) can derive the project dir without re-slugifying
    // cwd — that slug rule is owned by Claude Code and isn't a simple
    // '/' → '-' (non-ASCII chars get mangled).
    const session = this.sessions.get(sessionId);
    if (session) session.jsonlPath = jsonlPath;

    // Fast initial load: read tail for state + quick scan for tokens
    this.fastInitialLoad(sessionId, jsonlPath);

    // Set offset to end of file — only watch new lines from now
    try {
      const stat = fs.statSync(jsonlPath);
      this.fileOffsets.set(jsonlPath, stat.size);
    } catch (e) {}

    // Poll file size every 500ms — more reliable than fs.watch on macOS
    const poller = setInterval(() => {
      try {
        const stat = fs.statSync(jsonlPath);
        const currentOffset = this.fileOffsets.get(jsonlPath) || 0;
        if (stat.size > currentOffset) {
          this.readNewLines(sessionId, jsonlPath);
        }
      } catch (e) {
        // file might have been deleted
      }
    }, POLL_INTERVAL);
    this.fileWatchers.set(sessionId, { close: () => clearInterval(poller) });
  }

  fastInitialLoad(sessionId, jsonlPath) {
    try {
      const stat = fs.statSync(jsonlPath);
      const session = this.sessions.get(sessionId);
      if (!session) return;

      // Track previous tokens so we can take max() to avoid regression
      const prevTokens = { ...session.tokens };
      session.tokens = { input: 0, output: 0 };

      // Read tail with expanding window: a single assistant message can be
      // larger than 64KB (long thinking blocks, big tool outputs). If the
      // initial tail contains no user/assistant event, double the window
      // until we find one or hit the cap (16MB) / file start.
      const MIN_TAIL = 64 * 1024;
      const MAX_TAIL = 16 * 1024 * 1024;

      let lastAssistant = null;
      let lastUser = null;
      let hasLastPrompt = false;
      let readStart = 0;
      let scanned = false;

      let tailSize = MIN_TAIL;
      while (!scanned) {
        readStart = Math.max(0, stat.size - tailSize);
        // Reset per-iteration accumulation (token accumulation moves with the window)
        session.tokens = { input: 0, output: 0 };
        lastAssistant = null;
        lastUser = null;
        hasLastPrompt = false;

        const fd = fs.openSync(jsonlPath, 'r');
        const buffer = Buffer.alloc(stat.size - readStart);
        fs.readSync(fd, buffer, 0, buffer.length, readStart);
        fs.closeSync(fd);

        const text = buffer.toString('utf-8');
        const lines = text.split('\n').filter(Boolean);
        const startIdx = readStart > 0 ? 1 : 0;

        for (let i = startIdx; i < lines.length; i++) {
          try {
            const event = JSON.parse(lines[i]);
            if (event.slug) session.slug = event.slug;
            if (event.gitBranch) session.gitBranch = event.gitBranch;

            if (event.type === 'assistant') {
              lastAssistant = event;
              if (event.message && event.message.model) {
                session.model = event.message.model;
              }
              if (event.message && event.message.usage) {
                session.tokens.input += event.message.usage.input_tokens || 0;
                session.tokens.output += event.message.usage.output_tokens || 0;
              }
              this.captureAgentDispatches(session, event);
            } else if (event.type === 'user') {
              lastUser = event;
            } else if (event.type === 'permission-mode' && event.permissionMode) {
              session.permissionMode = event.permissionMode;
            } else if (event.type === 'last-prompt') {
              hasLastPrompt = true;
            }
          } catch (e) {}
        }

        // Stop if we have an assistant event (state can be determined),
        // already read the whole file, or hit the cap.
        if (lastAssistant || readStart === 0 || tailSize >= MAX_TAIL) {
          scanned = true;
        } else {
          tailSize *= 4; // 64K → 256K → 1M → 4M → 16M
        }
      }

      // Determine state from last events
      // Key insight: the LAST event type tells us the current state
      let computedState = null;
      if (lastAssistant && lastAssistant.isApiErrorMessage) {
        computedState = STATES.ERROR;
      } else if (lastUser && lastAssistant &&
                 new Date(lastUser.timestamp) > new Date(lastAssistant.timestamp)) {
        // User event came AFTER last assistant — Claude is thinking/processing
        const userContent = lastUser.message && lastUser.message.content;
        const isToolResult = Array.isArray(userContent) && userContent.some(c => c.type === 'tool_result');
        computedState = isToolResult ? STATES.RUNNING : STATES.THINKING;
      } else if (lastAssistant && lastAssistant.message) {
        const msg = lastAssistant.message;
        const content = msg.content || [];
        const lastToolUse = [...content].reverse().find(c => c.type === 'tool_use');
        if (lastToolUse) session.lastTool = lastToolUse.name;

        const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
        if (msg.stop_reason === 'tool_use' && lastToolUse && INTERACTIVE_TOOLS.has(lastToolUse.name)) {
          computedState = STATES.PENDING;
        } else if (msg.stop_reason === 'tool_use') {
          computedState = STATES.RUNNING;
        } else if (msg.stop_reason === 'end_turn') {
          computedState = STATES.WAITING;
        }
      }

      // Quick token estimate from full file: count "output_tokens" occurrences
      // For large files, read in chunks and extract just the token numbers
      if (readStart > 0) {
        this.scanTokensFast(sessionId, jsonlPath, readStart);
      }

      // Take max of previous and new counts to avoid token regression
      session.tokens.input = Math.max(session.tokens.input, prevTokens.input || 0);
      session.tokens.output = Math.max(session.tokens.output, prevTokens.output || 0);

      // Apply state via setState so the determination is persisted to config
      // (otherwise the stale restored state survives across restarts and the
      // session looks "stuck running"). isInitial=true skips the notification.
      if (computedState) {
        this.setState(sessionId, computedState, true);
      } else {
        // No determinable state — still emit so token/model/slug updates land
        this.emit('session-updated', session);
        this.persistSession(session);
      }
    } catch (e) {
      // file access error
    }
  }

  scanTokensFast(sessionId, jsonlPath, upToOffset) {
    // Read the earlier part of the file in chunks, only extracting token usage
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const CHUNK = 256 * 1024;
    const fd = fs.openSync(jsonlPath, 'r');
    let pos = 0;
    let partial = '';

    while (pos < upToOffset) {
      const readSize = Math.min(CHUNK, upToOffset - pos);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      const text = partial + buf.toString('utf-8');
      const lines = text.split('\n');
      partial = lines.pop(); // keep incomplete line

      for (const line of lines) {
        // Fast check: skip lines that don't have usage data
        if (!line.includes('"output_tokens"')) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message && event.message.usage) {
            session.tokens.input += event.message.usage.input_tokens || 0;
            session.tokens.output += event.message.usage.output_tokens || 0;
          }
        } catch (e) {}
      }
      pos += readSize;
    }
    fs.closeSync(fd);
  }

  readNewLines(sessionId, jsonlPath) {
    try {
      const stat = fs.statSync(jsonlPath);
      const currentOffset = this.fileOffsets.get(jsonlPath) || 0;

      if (stat.size <= currentOffset) return;

      const fd = fs.openSync(jsonlPath, 'r');
      const buffer = Buffer.alloc(stat.size - currentOffset);
      fs.readSync(fd, buffer, 0, buffer.length, currentOffset);
      fs.closeSync(fd);

      this.fileOffsets.set(jsonlPath, stat.size);

      const lines = buffer.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          this.processEvent(sessionId, event, false);
        } catch (e) {
          // skip malformed lines
        }
      }
    } catch (e) {
      // file access error
    }
  }

  processEvent(sessionId, event, isInitial) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastEventTime = Date.now();
    // Any real event means Claude is progressing on its own — cancel any
    // deferred PENDING transition so we don't flicker into "needs you".
    if (!isInitial && event.type && event.type !== 'attachment' && event.type !== 'permission-mode') {
      this.clearPendingTimer(sessionId);
    }

    // Extract slug
    if (event.slug) {
      session.slug = event.slug;
    }

    if (event.gitBranch) {
      session.gitBranch = event.gitBranch;
    }

    switch (event.type) {
      case 'permission-mode':
        if (event.permissionMode) session.permissionMode = event.permissionMode;
        break;
      case 'assistant':
        if (!event.isApiErrorMessage) session.hasActivity = true;
        this.processAssistantEvent(sessionId, session, event, isInitial);
        break;
      case 'user':
        session.hasActivity = true;
        this.clearWaitingTimer(sessionId);
        const content = event.message && event.message.content;
        const isToolResult = Array.isArray(content) && content.some(c => c.type === 'tool_result');
        if (isToolResult) {
          this.setState(sessionId, STATES.RUNNING, isInitial);
        } else {
          this.setState(sessionId, STATES.THINKING, isInitial);
        }
        break;
      case 'progress':
        // Any progress event means something is actively happening
        this.clearWaitingTimer(sessionId);
        this.setState(sessionId, STATES.RUNNING, isInitial);
        break;
      case 'queue-operation':
        // Tool queue activity — session is actively executing
        this.clearWaitingTimer(sessionId);
        this.setState(sessionId, STATES.RUNNING, isInitial);
        break;
      case 'attachment':
        // Attachments are message metadata (file refs, hook payloads) Claude
        // appends to the JSONL right after a user/assistant event. They are
        // NOT independent activity — the surrounding user/assistant event
        // already drove the state. Clearing the waiting timer here would
        // cancel the WAITING transition that follows an end_turn, leaving
        // sessions stuck in THINKING. Treat as a no-op for state.
        break;
      case 'last-prompt':
        // Metadata event that records the latest user prompt — NOT a session-end
        // signal. Claude writes one after every user message during normal work.
        // Completion is detected via PID death + session file removal instead.
        break;
      case 'system':
        // No-op: remote-control bridge detection was removed in 1.5.9.
        break;
    }
  }

  processAssistantEvent(sessionId, session, event, isInitial) {
    const message = event.message;
    if (!message) return;

    // Extract model name
    if (message.model) {
      session.model = message.model;
    }

    // Track tokens
    if (message.usage) {
      session.tokens.input += message.usage.input_tokens || 0;
      session.tokens.output += message.usage.output_tokens || 0;
    }

    // API error (stream timeout, connection refused, quota exhausted, …)
    if (event.isApiErrorMessage) {
      this.clearWaitingTimer(sessionId);
      this.setState(sessionId, STATES.ERROR, isInitial);
      return;
    }

    this.captureAgentDispatches(session, event);

    // Determine state from content
    const content = message.content || [];
    const hasThinking = content.some(c => c.type === 'thinking');
    const hasToolUse = content.some(c => c.type === 'tool_use');
    const lastToolUse = [...content].reverse().find(c => c.type === 'tool_use');

    if (lastToolUse && lastToolUse.name !== session.lastTool) {
      session.lastTool = lastToolUse.name;
      // Tool changed — emit update even if state stays the same
      this.emit('session-updated', session);
      this.persistSession(session);
    }

    if (message.stop_reason === 'tool_use') {
      this.clearWaitingTimer(sessionId);
      // Interactive tools that block on user input — treat as "needs you".
      // AskUserQuestion opens a multiple-choice picker; ExitPlanMode asks the
      // user to approve a plan before continuing.
      const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
      if (lastToolUse && INTERACTIVE_TOOLS.has(lastToolUse.name)) {
        this.setState(sessionId, STATES.PENDING, isInitial);
        return;
      }
      this.setState(sessionId, STATES.RUNNING, isInitial);
    } else if (message.stop_reason === 'end_turn') {
      this.startWaitingTimer(sessionId, isInitial);
    } else if (hasThinking && !hasToolUse) {
      this.clearWaitingTimer(sessionId);
      this.setState(sessionId, STATES.THINKING, isInitial);
    }
  }

  startWaitingTimer(sessionId, isInitial) {
    this.clearWaitingTimer(sessionId);
    if (isInitial) {
      // For initial load, check if enough time has passed
      const session = this.sessions.get(sessionId);
      if (session && Date.now() - new Date(session.startedAt).getTime() > WAITING_DELAY) {
        this.setState(sessionId, STATES.WAITING, isInitial);
      }
      return;
    }
    const timer = setTimeout(() => {
      this.setState(sessionId, STATES.WAITING, false);
    }, WAITING_DELAY);
    this.waitingTimers.set(sessionId, timer);
  }

  clearWaitingTimer(sessionId) {
    const timer = this.waitingTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.waitingTimers.delete(sessionId);
    }
  }

  setState(sessionId, newState, isInitial) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const oldState = session.state;
    const stateChanged = oldState.name !== newState.name;

    if (stateChanged) {
      session.state = newState;
      this.emit('session-updated', session);
      this.persistSession(session);
    }

    // Trigger notification on waiting/pending — with 30s cooldown to avoid spam
    // Handles: stale timer → waiting, end_turn → waiting, permission hook → pending
    if (!isInitial && (newState.name === 'waiting' || newState.name === 'pending')) {
      const lastNotif = this.lastNotifTime.get(sessionId) || 0;
      if (Date.now() - lastNotif > 30000) {
        this.lastNotifTime.set(sessionId, Date.now());
        this.emit('session-waiting', session);
      }
    }
    // Reset cooldown only when the user actually types — THINKING means a
    // user prompt event landed. RUNNING just means Claude is mid-tool-loop
    // (tool_result auto-replay), so re-notifying on every waiting cycle of
    // the same loop is spam.
    if (stateChanged && newState.name === 'thinking') {
      this.lastNotifTime.delete(sessionId);
    }
  }

  persistSession(session) {
    if (!this.config) return;
    this.config.saveSession(session.sessionId, {
      pid: session.pid,
      cwd: session.cwd,
      projectName: session.projectName,
      slug: session.slug,
      stateName: session.state.name,
      lastTool: session.lastTool,
      model: session.model,
      gitBranch: session.gitBranch,
      startedAt: session.startedAt,
      tokens: session.tokens,
      terminalApp: session.terminalApp,
      terminalId: session.terminalId,
    });
  }

  // Session file gone + PID dead: drop it. We only surface live sessions.
  // (Errored sessions whose PID just died stay visible — they kept the ERROR
  // state from a prior assistant event, so they don't reach this path until
  // the user dismisses them via the X button → removeSession().)
  markCompleted(sessionId) {
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.state === STATES.ERROR) return;
    this.removeSession(sessionId);
  }

  // Swap a session's ID in place (e.g., after /clear). Preserves custom name,
  // notification prefs, and position. Switches the JSONL file watcher.
  migrateSession(oldId, newId) {
    const session = this.sessions.get(oldId);
    if (!session) return;

    // Close old file watcher
    const watcher = this.fileWatchers.get(oldId);
    if (watcher) { watcher.close(); this.fileWatchers.delete(oldId); }
    this.clearWaitingTimer(oldId);
    this.clearPendingTimer(oldId);
    const oldJsonl = this.findJsonlPath(oldId);
    if (oldJsonl) this.fileOffsets.delete(oldJsonl);

    // Move the Map entry
    this.sessions.delete(oldId);
    session.sessionId = newId;
    session.tokens = { input: 0, output: 0 };
    session.lastTool = null;
    session.hasActivity = false;
    this.sessions.set(newId, session);

    // Migrate config (name, notif prefs, order, saved session data)
    if (this.config) {
      const name = this.config.getCustomName(oldId);
      if (name) {
        this.config.setCustomName(newId, name);
      }
      const notifPrefs = this.config.getNotificationPrefs(oldId);
      if (notifPrefs.modal || notifPrefs.sound) {
        this.config.setNotificationPrefs(newId, notifPrefs);
      }
      // Preserve position in session order
      const cfg = this.config.get();
      if (Array.isArray(cfg.sessionOrder)) {
        const idx = cfg.sessionOrder.indexOf(oldId);
        if (idx !== -1) cfg.sessionOrder[idx] = newId;
      }
      this.config.deleteSession(oldId);
    }

    // Start watching the new JSONL (replays events → updates state)
    this.watchJsonl(newId);
    this.emit('session-removed', oldId);
    this.emit('session-added', session);
  }

  removeSession(sessionId) {
    const watcher = this.fileWatchers.get(sessionId);
    if (watcher) { watcher.close(); this.fileWatchers.delete(sessionId); }
    this.clearWaitingTimer(sessionId);
    this.clearPendingTimer(sessionId);
    this.lastNotifTime.delete(sessionId);
    // Clean up file offsets for this session's JSONL
    const jsonlPath = this.findJsonlPath(sessionId);
    if (jsonlPath) this.fileOffsets.delete(jsonlPath);
    this.sessions.delete(sessionId);
    if (this.config) {
      this.config.deleteSession(sessionId);
      this.config.setCustomName(sessionId, '');
    }
    this.emit('session-removed', sessionId);
  }

  // Called by SocketServer when cc/cwa registers a session
  registerTerminal(sessionId, terminalApp, terminalId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.terminalApp = terminalApp;
      session.terminalId = terminalId;
      this.emit('session-updated', session);
    }
  }

  // Called by SocketServer when the permission hook fires (PreToolUse / Notification).
  // The session is waiting for the user to answer something and no JSONL event
  // will land until the user does — so we surface it explicitly.
  // Defer the pending transition by ~1s. If Claude writes any JSONL event
  // in that window (auto-approved tool, immediate continuation, …), we cancel.
  // Real permission prompts idle for seconds, so they comfortably survive.
  markPending(sessionId, hookEvent, toolName) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.state.name === 'pending') return;
    if (this.pendingTimers.has(sessionId)) return; // already scheduled

    // bypassPermissions skips most hooks (Claude auto-approves and proceeds)
    // — EXCEPT for hooks that signal a genuine user-blocking interaction:
    //   - PreToolUse for AskUserQuestion / ExitPlanMode (always blocks the user)
    //   - Notification in bypass mode (no permission_prompt would fire here, so
    //     it's idle_prompt or an MCP elicitation_dialog — both block the user)
    const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
    const isInteractiveTool = hookEvent === 'PreToolUse' && INTERACTIVE_TOOLS.has(toolName);
    const isNotification = hookEvent === 'Notification';
    if (session.permissionMode === 'bypassPermissions' && !isInteractiveTool && !isNotification) {
      return;
    }

    const lastEvent = session.lastEventTime || 0;
    if (Date.now() - lastEvent < 1000) return; // Claude is actively writing — ignore

    const timer = setTimeout(() => {
      this.pendingTimers.delete(sessionId);
      const s = this.sessions.get(sessionId);
      if (!s) return;
      if (s.state.name === 'pending') return;
      // Final check: did an event arrive since we scheduled?
      if (Date.now() - (s.lastEventTime || 0) < 1000) return;
      this.clearWaitingTimer(sessionId);
      this.setState(sessionId, STATES.PENDING, false);
    }, 1000);
    this.pendingTimers.set(sessionId, timer);
  }

  clearPendingTimer(sessionId) {
    const timer = this.pendingTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(sessionId);
    }
  }

getSessions() {
    return Array.from(this.sessions.values());
  }
}

module.exports = { SessionWatcher, STATES };
