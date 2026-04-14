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
const IDLE_TIMEOUT = 120000;

const STATES = {
  THINKING: { name: 'thinking', color: '#a78bfa', label: 'Réflexion' },
  RUNNING: { name: 'running', color: '#22c55e', label: 'Exécution' },
  WAITING: { name: 'waiting', color: '#3b82f6', label: 'En attente' },
  IDLE: { name: 'idle', color: '#94a3b8', label: 'Inactif' },
  ERROR: { name: 'error', color: '#ef4444', label: 'Erreur' },
  COMPLETED: { name: 'completed', color: '#4b5563', label: 'Terminé' },
};

class SessionWatcher extends EventEmitter {
  constructor(configModule) {
    super();
    this.config = configModule;
    this.sessions = new Map();
    this.fileWatchers = new Map();
    this.fileOffsets = new Map();
    this.waitingTimers = new Map();
    this.idleTimers = new Map();
    this.stuckTimers = new Map();
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
        });
        this.emit('session-added', this.sessions.get(id));
      }
    }

    this.scan();
    this.scanTimer = setInterval(() => this.scan(), SCAN_INTERVAL);
  }

  stop() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    for (const watcher of this.fileWatchers.values()) watcher.close();
    for (const timer of this.waitingTimers.values()) clearTimeout(timer);
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    for (const timer of this.stuckTimers.values()) clearTimeout(timer);
    this.fileWatchers.clear();
    this.fileOffsets.clear();
    this.waitingTimers.clear();
    this.stuckTimers.clear();
    this.idleTimers.clear();
  }

  scan() {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) return;

      const activeSessionIds = new Set();
      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = path.join(SESSIONS_DIR, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const { pid, sessionId, cwd, startedAt } = data;

          if (!sessionId) continue;

          // Session file exists — even if PID is dead, don't mark completed yet
          // The session file's presence means Claude Code hasn't fully cleaned up
          activeSessionIds.add(sessionId);

          const pidAlive = this.isPidAlive(pid);

          if (!this.sessions.has(sessionId)) {
            const projectName = this.extractProjectName(cwd);
            // startedAt can be epoch ms or ISO string
            const startedAtISO = typeof startedAt === 'number'
              ? new Date(startedAt).toISOString()
              : (startedAt || new Date().toISOString());
            this.sessions.set(sessionId, {
              sessionId,
              pid,
              cwd,
              projectName,
              slug: '',
              state: STATES.IDLE,
              lastTool: null,
              model: null,
                  gitBranch: null,
              startedAt: startedAtISO,
              endedAt: null,
              tokens: { input: 0, output: 0 },
              remoteUrl: null,
              terminalApp: null,
              terminalId: null,
              lastEventTime: Date.now(),
            });
            this.watchJsonl(sessionId);
            this.emit('session-added', this.sessions.get(sessionId));
          } else {
            const session = this.sessions.get(sessionId);
            // Always update from live session data (PID/cwd can change on resume)
            session.pid = pid;
            session.cwd = cwd;
            if (startedAt) {
              const startedAtISO = typeof startedAt === 'number'
                ? new Date(startedAt).toISOString() : startedAt;
              session.startedAt = startedAtISO;
            }

            if (pidAlive && session.state === STATES.COMPLETED) {
              // Session was marked completed but PID is alive — reactivate
              session.endedAt = null;
              this.setState(sessionId, STATES.IDLE, false);
            } else if (!pidAlive && session.state !== STATES.COMPLETED && session.state !== STATES.IDLE) {
              // PID died but session file still exists — mark idle
              this.setState(sessionId, STATES.IDLE, false);
            }

            if (!this.fileWatchers.has(sessionId)) {
              this.watchJsonl(sessionId);
            }
          }
        } catch (e) {
          // skip malformed session files
        }
      }

      // Sessions not in active files: check PID
      // Only mark completed if PID is confirmed dead
      // Otherwise mark idle (session file might have been cleaned up temporarily)
      for (const [id, session] of this.sessions) {
        if (!activeSessionIds.has(id) && session.state !== STATES.COMPLETED) {
          if (session.pid && this.isPidAlive(session.pid)) {
            // PID still alive but no session file — mark idle, not completed
            if (session.state !== STATES.IDLE && session.state !== STATES.WAITING) {
              this.setState(id, STATES.IDLE, false);
            }
          } else {
            // PID dead AND no session file — truly completed
            this.markCompleted(id);
          }
        }
      }
    } catch (e) {
      // sessions dir might not exist yet
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

      // Reset tokens to avoid double-counting on restart
      session.tokens = { input: 0, output: 0 };

      // Read last ~64KB for state detection (covers ~50 recent events)
      const TAIL_SIZE = 64 * 1024;
      const readStart = Math.max(0, stat.size - TAIL_SIZE);
      const fd = fs.openSync(jsonlPath, 'r');
      const buffer = Buffer.alloc(stat.size - readStart);
      fs.readSync(fd, buffer, 0, buffer.length, readStart);
      fs.closeSync(fd);

      const text = buffer.toString('utf-8');
      const lines = text.split('\n').filter(Boolean);

      // If we started mid-line (readStart > 0), skip the first partial line
      const startIdx = readStart > 0 ? 1 : 0;

      // Quick token scan: search for "usage" in full file using streaming
      // But only process tail lines for state
      let lastAssistant = null;
      let lastUser = null;
      let hasLastPrompt = false;

      for (let i = startIdx; i < lines.length; i++) {
        try {
          const event = JSON.parse(lines[i]);

          if (event.slug) {
            session.slug = event.slug;
          }

          if (event.gitBranch) {
            session.gitBranch = event.gitBranch;
          }

          if (event.type === 'assistant') {
            lastAssistant = event;
            // Extract model
            if (event.message && event.message.model) {
              session.model = event.message.model;
            }
            // Accumulate tokens from tail
            if (event.message && event.message.usage) {
              session.tokens.input += event.message.usage.input_tokens || 0;
              session.tokens.output += event.message.usage.output_tokens || 0;
            }
          } else if (event.type === 'user') {
            lastUser = event;
          } else if (event.type === 'last-prompt') {
            hasLastPrompt = true;
          }
        } catch (e) {}
      }

      // Determine state from last events
      // Key insight: the LAST event type tells us the current state
      if (hasLastPrompt) {
        session.state = STATES.COMPLETED;
      } else if (lastUser && lastAssistant &&
                 new Date(lastUser.timestamp) > new Date(lastAssistant.timestamp)) {
        // User event came AFTER last assistant — Claude is thinking/processing
        const userContent = lastUser.message && lastUser.message.content;
        const isToolResult = Array.isArray(userContent) && userContent.some(c => c.type === 'tool_result');
        if (isToolResult) {
          session.state = STATES.RUNNING;
        } else {
          session.state = STATES.THINKING;
        }
      } else if (lastAssistant && lastAssistant.message) {
        const msg = lastAssistant.message;
        const content = msg.content || [];
        const lastToolUse = [...content].reverse().find(c => c.type === 'tool_use');
        if (lastToolUse) session.lastTool = lastToolUse.name;

        if (msg.stop_reason === 'tool_use') {
          session.state = STATES.RUNNING;
        } else if (msg.stop_reason === 'end_turn') {
          session.state = STATES.WAITING;
        }
      }

      // Quick token estimate from full file: count "output_tokens" occurrences
      // For large files, read in chunks and extract just the token numbers
      if (readStart > 0) {
        this.scanTokensFast(sessionId, jsonlPath, readStart);
      }

      this.emit('session-updated', session);
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

    // Extract slug
    if (event.slug) {
      session.slug = event.slug;
    }

    if (event.gitBranch) {
      session.gitBranch = event.gitBranch;
    }

    // Reset idle timer + clear stuck hint
    this.resetIdleTimer(sessionId);
    this.clearStuckTimer(sessionId);
    if (session.maybeStuck) {
      session.maybeStuck = false;
      this.emit('session-updated', session);
    }

    switch (event.type) {
      case 'permission-mode':
        break;
      case 'assistant':
        this.processAssistantEvent(sessionId, session, event, isInitial);
        break;
      case 'user':
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
        // Attachment events (hooks, skills) indicate activity
        this.clearWaitingTimer(sessionId);
        break;
      case 'last-prompt':
        this.setState(sessionId, STATES.COMPLETED, isInitial);
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
      this.setState(sessionId, STATES.RUNNING, isInitial);
    } else if (message.stop_reason === 'end_turn') {
      this.startWaitingTimer(sessionId, isInitial);
    } else if (hasThinking && !hasToolUse) {
      this.clearWaitingTimer(sessionId);
      this.setState(sessionId, STATES.THINKING, isInitial);
    }

    // Check for errors in content
    for (const block of content) {
      if (block.type === 'text' && block.text &&
          (block.text.includes('Error:') || block.text.includes('error:'))) {
        // Don't override running/thinking states for minor errors in text
      }
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

  startStuckTimer(sessionId) {
    this.clearStuckTimer(sessionId);
    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      if (session.state === STATES.THINKING || session.state === STATES.RUNNING) {
        session.maybeStuck = true;
        this.emit('session-updated', session);
      }
    }, 30000);
    this.stuckTimers.set(sessionId, timer);
  }

  clearStuckTimer(sessionId) {
    const timer = this.stuckTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.stuckTimers.delete(sessionId);
    }
  }

  resetIdleTimer(sessionId) {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session && session.state !== STATES.COMPLETED) {
        this.setState(sessionId, STATES.IDLE, false);
      }
    }, IDLE_TIMEOUT);
    this.idleTimers.set(sessionId, timer);
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

    // Trigger notification on waiting — with 30s cooldown to avoid spam
    // This handles: stale timer → waiting, then end_turn → waiting again
    if (!isInitial && newState.name === 'waiting') {
      const lastNotif = this.lastNotifTime.get(sessionId) || 0;
      if (Date.now() - lastNotif > 30000) {
        this.lastNotifTime.set(sessionId, Date.now());
        this.emit('session-waiting', session);
      }
    }
    // Reset cooldown when leaving waiting state
    if (stateChanged && newState.name !== 'waiting') {
      this.lastNotifTime.delete(sessionId);
    }

    // Start "maybe stuck" timer when entering thinking/running
    if (stateChanged && (newState.name === 'thinking' || newState.name === 'running')) {
      this.startStuckTimer(sessionId);
    }
    if (stateChanged && newState.name !== 'thinking' && newState.name !== 'running') {
      this.clearStuckTimer(sessionId);
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
    if (session && session.state !== STATES.COMPLETED) {
      this.setState(sessionId, STATES.COMPLETED, false);
    }
  }

  removeSession(sessionId) {
    const watcher = this.fileWatchers.get(sessionId);
    if (watcher) { watcher.close(); this.fileWatchers.delete(sessionId); }
    this.clearWaitingTimer(sessionId);
    const idle = this.idleTimers.get(sessionId);
    if (idle) { clearTimeout(idle); this.idleTimers.delete(sessionId); }
    this.sessions.delete(sessionId);
    if (this.config) this.config.deleteSession(sessionId);
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
          state: STATES.IDLE,
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
          state: STATES.IDLE,
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
