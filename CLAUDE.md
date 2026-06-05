# Aby Claude Watcher

Electron desktop app monitoring Claude Code sessions in real-time.

## Dev

```bash
npm install
npm start        # production
npm run dev      # with devtools
```

## Architecture

- `main.js` — Electron main process, window, IPC, tray
- `watcher.js` — Session discovery (`~/.claude/sessions/`), JSONL parsing, state machine
- `socket.js` — Unix socket IPC for `cc`/`cwa` wrappers
- `focus.js` — Terminal focus (AppleScript iTerm2/Terminal/Warp), resume, launch
- `config.js` — Persistence (debounced writes, saveSync on shutdown)
- `preload.js` — Context bridge (contextIsolation: true)
- `ui/` — Renderer (vanilla HTML/CSS/JS, no framework)

## States

| State | Color | Trigger |
|-------|-------|---------|
| thinking | purple `#a78bfa` | Last event = `user` text (Claude processing) |
| running | blue `#3b82f6` | Last event = `assistant` with `stop_reason: "tool_use"` |
| waiting | green `#22c55e` | `end_turn` + 2s no activity (idle, turn finished) |
| pending | amber `#f59e0b` | Permission prompt deferred from hook ping (action required) |
| error | red `#ef4444` | `isApiErrorMessage` event OR silent crash after explicit resume |
| completed | (purged) | Session file gone + PID dead → removed from UI |

## Key decisions

- JSONL `tool_use` events only written AFTER user approves permission — cannot detect permission prompts
- Only `end_turn` reliably signals "waiting for user" — no stale timer (caused false positives)
- Waiting delay: 5s (avoids false positives between rapid tool calls)
- Notifications: 30s cooldown per session to avoid spam
- Pending sound deferred 5s — rings only if still pending/waiting at fire time (permissions approved in seconds shouldn't ding); toast stays immediate; every emit/skip logged `[notif]`
- Notification hook 60s idle reminder ("waiting for your input") ≠ permission: hook forwards `idle` bool; already-waiting session → ignored (no re-ding, no amber flip); busy-looking session → corrected to waiting (`hook:idle-reminder`), not pending
- Polling at 250ms (`fs.watch` unreliable on macOS)
- Config saves debounced 500ms, `saveSync` on shutdown
- `last-prompt` is metadata (records the latest user prompt) — NOT a session-end signal
- Session completed only when: session file gone + PID dead + at least one user/assistant event happened
- Session with no activity and no explicit resume → purged entirely (phantom)
- Session with no activity but explicit resume → marked error (silent crash)
- PID alive + session file gone = state unchanged (don't force a transition)
- All data (model, slug, branch) uses latest value (resume-safe)
- Input sanitization on all shell/AppleScript interpolation
- Headless sessions (`session.json entrypoint !== "cli"`) → `isBackground`: dedicated collapsible UI section below interactive ones, no click-focus, notifications muted unless the per-session bell is on (deliberate exception to the v1.7.2 compact-toast rule)
- Workflows multi-agents (`subagents/workflows/wf_*/journal.jsonl`) → aggregated violet badge per run, NOT individual agent rows; live via 2s tick (parent JSONL silent during run); name from `workflows/scripts/<name>-<runId>.js` filename; completion = `workflows/<runId>.json` state file (terminal states cached, `running` states re-read); one-shot `workflow-done` toast, no needs-you bell, no retroactive notif; stale > 30 min without state file → badge silently dropped; workflow agents never count in `hasBlockingForegroundAgent`
