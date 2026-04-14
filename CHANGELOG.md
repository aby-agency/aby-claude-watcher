# Changelog

All notable changes to Aby Claude Watcher are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
