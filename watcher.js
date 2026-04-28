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

const STATES = {
  THINKING: { name: 'thinking', color: '#a78bfa' },
  RUNNING: { name: 'running', color: '#22c55e' },
  WAITING: { name: 'waiting', color: '#3b82f6' },
  PENDING: { name: 'pending', color: '#f97316' },
  ERROR: { name: 'error', color: '#ef4444' },
  COMPLETED: { name: 'completed', color: '#4b5563' },
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
        const savedState = Object.values(STATES).find(s => s.name === data.stateName) || STATES.COMPLETED;
        // Keep the saved state as-is — the scan() will check PID liveness
        // and mark as completed only if the session file is gone
        const state = savedState;

        this.sessions.set(id, {
          sessionId: id,
          pid: data.pid || null,
          cwd: data.cwd || null,
          projectName: data.projectName || 'Unknown',
          slug: data.slug || '',
          state,
          lastTool: data.lastTool || null,
          model: data.model || null,
          gitBranch: data.gitBranch || null,
          startedAt: data.startedAt || new Date().toISOString(),
          endedAt: data.endedAt || null,
          tokens: data.tokens || { input: 0, output: 0 },
          remoteUrl: data.remoteUrl || null,
          terminalApp: data.terminalApp || null,
          terminalId: data.terminalId || null,
          lastEventTime: Date.now(),
          hasActivity: savedState.name !== 'error',
          wasResumed: false,
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
      // avoid mistaking them for /clear migrations.
      const liveSessions = [];
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));
          if (data && data.sessionId) liveSessions.push(data);
        } catch (e) {}
      }
      const liveSessionIds = new Set(liveSessions.map(d => d.sessionId));

      for (const data of liveSessions) {
        try {
          const { pid, sessionId, cwd, startedAt } = data;

          if (!sessionId) continue;

          // Detect /clear: Claude keeps the PID but creates a new JSONL+sessionId.
          // The session file isn't updated, so we check if a newer JSONL exists
          // in the same project dir and swap our tracking to it.
          // Guard: only treat as /clear when the candidate session shares this PID
          // (or is dead) — otherwise it's a separate Claude process in the same
          // directory and we'd wrongly clobber it.
          const effectiveId = this._resolveEffectiveSessionId(sessionId, pid, cwd, liveSessions);
          if (effectiveId !== sessionId) {
            const oldSession = this.sessions.get(sessionId);
            if (oldSession && this._shouldMigrateOnClear(oldSession, pid)) {
              this.migrateSession(sessionId, effectiveId);
            }
            // Clean up orphaned intermediate sessions from previous /clears,
            // but only when their PID is dead or matches this active PID —
            // never remove a concurrent live Claude in the same cwd.
            for (const [id, s] of this.sessions) {
              if (id !== effectiveId && s.cwd === cwd && this._shouldMigrateOnClear(s, pid)) {
                if (liveSessionIds.has(id)) continue;
                this.removeSession(id);
              }
            }
          }

          // Session file exists — even if PID is dead, don't mark completed yet
          // The session file's presence means Claude Code hasn't fully cleaned up
          activeSessionIds.add(effectiveId);

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
              endedAt: null,
              tokens: { input: 0, output: 0 },
              remoteUrl: null,
              terminalApp: null,
              terminalId: null,
              permissionMode: this.detectBypassFromPid(pid) ? 'bypassPermissions' : null,
              lastEventTime: Date.now(),
              hasActivity: false,
              wasResumed: false,
            });
            this.watchJsonl(effectiveId);
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

            if (pidAlive && (session.state === STATES.COMPLETED || session.state === STATES.ERROR)) {
              // Session was completed/errored but PID is alive — reactivate
              session.endedAt = null;
              session.hasActivity = false;
              session.wasResumed = true;
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
        if (session.state === STATES.COMPLETED) continue;

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

  // Resolve the sessionId we should track for a given (PID, cwd). Normally
  // returns the JSONL id from session.json. After /clear, Claude keeps the
  // PID but writes a newer JSONL with a fresh id — we follow that. But when
  // multiple Claude processes run in the same cwd, the newest JSONL might
  // belong to a *different* live PID; treating that as /clear would fuse
  // the two sessions into one. `liveSessions` is the snapshot of all active
  // session.json files this scan, used to detect that case.
  _resolveEffectiveSessionId(sessionId, pid, cwd, liveSessions) {
    const latestId = this.findLatestSessionIdForCwd(cwd);
    if (!latestId || latestId === sessionId) return sessionId;
    const concurrent = liveSessions.some(d => d.sessionId === latestId && d.pid !== pid);
    return concurrent ? sessionId : latestId;
  }

  // /clear migration is safe only when the old tracked session shares the
  // active session's PID (true /clear) or its PID is gone. A different
  // alive PID in the same cwd is a concurrent Claude process — leave it.
  _shouldMigrateOnClear(oldSession, activePid) {
    if (!oldSession) return false;
    if (!oldSession.pid) return true;
    if (oldSession.pid === activePid) return true;
    return !this.isPidAlive(oldSession.pid);
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

  // Resolve project dir slug from cwd (mirrors Claude Code's convention:
  // ~/.claude/projects/-<path-with-dashes>/)
  cwdToProjectDir(cwd) {
    if (!cwd) return null;
    const slug = cwd.replace(/\//g, '-');
    const dir = path.join(PROJECTS_DIR, slug);
    return fs.existsSync(dir) ? dir : null;
  }

  // Find the most recently written JSONL in a project dir.
  // Returns the sessionId (filename minus .jsonl) or null.
  findLatestSessionIdForCwd(cwd) {
    const dir = this.cwdToProjectDir(cwd);
    if (!dir) return null;
    try {
      let newest = null;
      let newestMtime = 0;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        if (st.mtimeMs > newestMtime) {
          newestMtime = st.mtimeMs;
          newest = f.replace('.jsonl', '');
        }
      }
      return newest;
    } catch {
      return null;
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
      // Only mark COMPLETED on last-prompt if the PID is actually dead
      let computedState = null;
      if (lastAssistant && lastAssistant.isApiErrorMessage) {
        computedState = STATES.ERROR;
      } else if (hasLastPrompt && (!session.pid || !this.isPidAlive(session.pid))) {
        computedState = STATES.COMPLETED;
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
        // Detect remote-control activation
        if (event.subtype === 'bridge_status' && event.url) {
          session.remoteUrl = event.url;
          this.emit('session-updated', session);
          this.persistSession(session);
        }
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

      // Freeze duration when completed
      if (newState.name === 'completed' && !session.endedAt) {
        session.endedAt = new Date().toISOString();
      }

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
    // Reset cooldown when leaving waiting/pending
    if (stateChanged && newState.name !== 'waiting' && newState.name !== 'pending') {
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
      endedAt: session.endedAt,
      tokens: session.tokens,
      remoteUrl: session.remoteUrl,
      terminalApp: session.terminalApp,
      terminalId: session.terminalId,
    });
  }

  markCompleted(sessionId) {
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!session.hasActivity) {
      // User resumed the session but it died before writing anything — silent crash.
      if (session.wasResumed) {
        if (session.state !== STATES.ERROR) this.setState(sessionId, STATES.ERROR, false);
        return;
      }
      // Otherwise it's a phantom (wrapper spawn that died, stale scan entry, …) —
      // drop it entirely instead of surfacing a meaningless card.
      this.removeSession(sessionId);
      return;
    }
    if (session.state !== STATES.COMPLETED) {
      this.setState(sessionId, STATES.COMPLETED, false);
    }
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
    session.endedAt = null;
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
  markPending(sessionId, hookEvent) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.state.name === 'pending') return;
    if (this.pendingTimers.has(sessionId)) return; // already scheduled

    // In bypassPermissions mode, hooks fire but never actually block on the
    // user — Claude auto-approves and proceeds. The real interactive tools
    // (AskUserQuestion, ExitPlanMode) are handled by the JSONL tool-sniff
    // path instead, so we can safely ignore all hooks for bypass sessions.
    if (session.permissionMode === 'bypassPermissions') return;

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

  // Manual session add from UI
  addSession(sessionIdOrPath) {
    // If it's a path to a JSONL file — validate it's within Claude's projects dir
    if (sessionIdOrPath.endsWith('.jsonl')) {
      const resolved = path.resolve(sessionIdOrPath);
      if (!resolved.startsWith(PROJECTS_DIR)) {
        return false; // reject paths outside Claude projects
      }
      const sessionId = path.basename(sessionIdOrPath, '.jsonl');
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, {
          sessionId,
          pid: null,
          cwd: null,
          projectName: 'Manual',
          slug: '',
          state: STATES.WAITING,
          lastTool: null,
          model: null,
          gitBranch: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          tokens: { input: 0, output: 0 },
          remoteUrl: null,
          terminalApp: null,
          terminalId: null,
          lastEventTime: Date.now(),
          hasActivity: false,
          wasResumed: false,
        });
        this.startFileWatch(sessionId, sessionIdOrPath);
        this.emit('session-added', this.sessions.get(sessionId));
      }
      return true;
    }

    // If it's a session ID, try to find its JSONL
    const jsonlPath = this.findJsonlPath(sessionIdOrPath);
    if (jsonlPath) {
      if (!this.sessions.has(sessionIdOrPath)) {
        this.sessions.set(sessionIdOrPath, {
          sessionId: sessionIdOrPath,
          pid: null,
          cwd: null,
          projectName: 'Manual',
          slug: '',
          state: STATES.WAITING,
          lastTool: null,
          model: null,
          gitBranch: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          tokens: { input: 0, output: 0 },
          remoteUrl: null,
          terminalApp: null,
          terminalId: null,
          lastEventTime: Date.now(),
          hasActivity: false,
          wasResumed: false,
        });
        this.startFileWatch(sessionIdOrPath, jsonlPath);
        this.emit('session-added', this.sessions.get(sessionIdOrPath));
      }
      return true;
    }

    return false;
  }

  getSessions() {
    return Array.from(this.sessions.values());
  }
}

module.exports = { SessionWatcher, STATES };
