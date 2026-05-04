# Changelog

All notable changes to Aby Claude Watcher are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.3] — 2026-05-04

### Fixed
- **`/clear` made the card jump or stuck the session in WAITING** — Claude Code does not
  update `session.json`'s `sessionId` after `/clear`; it stays frozen at the value the
  process was launched with. The watcher's previous heuristic — pick the newest JSONL by
  mtime in the project directory — produced false positives whenever an orphan JSONL from
  a previously-killed Claude was the freshest on disk, causing the tracked session to
  flap between sids. Detection is now driven by JSONL freshness per `(pid, cwd)`: the
  watcher sticks with the tracked JSONL for as long as it keeps being written, and only
  re-attributes to a fresh unclaimed JSONL in the same project dir once the tracked one
  has gone stale (>30 s without writes). Multi-Claude attribution is resolved by sorting
  data rows by `session.json` `updatedAt` (most-recently-active first) and excluding
  JSONLs already claimed in the same scan. Migrations preserve UI position, custom name,
  and notification preferences (already handled by `migrateSession`).

### Removed
- The mtime-based `_resolveEffectiveSessionId` and the PID-identity migration helper that
  preceded this fix — both relied on `session.json` updating on `/clear`, which it doesn't.

## [1.4.1] — 2026-04-23

### Fixed
- **Stuck "in progress" sessions** — `fastInitialLoad` could not determine state when the
  last assistant message line exceeded the 64 KB tail (long thinking blocks, large tool
  outputs). After the partial-line skip, no user/assistant event remained and the session
  stayed at whatever state was restored from config. Tail now expands iteratively
  (64 K → 16 M, ×4 per pass) until a usable assistant event is found.
- **State no longer persisted on initial load** — `fastInitialLoad` mutated `session.state`
  directly without going through `setState`, so the runtime state was correct but
  `config.json` kept the stale value. The next app restart re-restored that stale state
  and the bug snowballed. State determined at startup is now persisted.
- **`/clear` migration could clobber a concurrent session** — when two Claude processes
  ran in the same project directory, the watcher treated the newer JSONL as a `/clear`
  of the tracked session and overwrote the other process's data. Migration now requires
  the old session's PID to match the active one or be dead.
- **Trailing `attachment` events killed the WAITING transition** — Claude appends
  metadata events right after every user/assistant message; their handler called
  `clearWaitingTimer`, cancelling the 2 s transition from `end_turn` → WAITING and
  leaving sessions stuck in THINKING. Attachment is now a no-op for state.
- **Orphan config entries** — stale `notifications`, `customNames`, and `sessionOrder`
  entries for sessions deleted long ago accumulated in `config.json`. They are now
  pruned at startup against the saved sessions map.

### Added
- `test/watcher.test.js` — 9 cases covering the five bugs above, integrated into `npm test`.

## [1.1.0] — 2026-04-14

### Added
- **Micro view** — a third view mode focused on ambient awareness. A single-line-per-session
  layout with just a state dot + name (click to focus the host terminal), a 36 px toolbar
  with Back + Pin, a minimum window size of 200 × 100, and its own saved bounds separate
  from grid/compact so switching back and forth restores each view's last-remembered size.
- Hover tooltip on each micro-view line showing `name — state`.
- In micro mode, the in-app toast notification is suppressed (the pulsing waiting dot is
  enough signal for a small ambient window). Sound alerts still fire if enabled per session.

### Fixed
- Pin button visual state on startup when `alwaysOnTop` was `true`: the micro pin button
  was being rendered before the config was read.
- `saveBounds` no longer writes bounds while the window is minimised.

## [1.0.0] — 2026-04-14

First public release.

### Added
- Real-time monitoring of every Claude Code session in `~/.claude/sessions/`.
- Five color-coded states: *thinking*, *running*, *waiting*, *error*, *completed*.
- Grid and compact views with drag-to-reorder and always-on-top.
- Per-session notifications (in-app toast + sound, 30 s cooldown).
- One-click focus terminal for iTerm2, Terminal.app, Warp, VSCode, Cursor, Ghostty, kitty, WezTerm, Hyper.
- Resume session, remote-control URL indicator, tool pills, cost & token counters, Git branch display.
- Bilingual UI (French / English) with runtime switcher.
- Menu-bar tray icon (duck silhouette, template image) with popover summary.
- Dock badge for waiting sessions.
- Optional `cc` / `cwa` shell wrappers registering the host terminal over a Unix socket.
- Manual update checker against the GitHub Releases API (no phone-home otherwise).
- Auto-launch at login (opt-in).
- Apple Silicon (arm64) and Intel (x64) builds.
