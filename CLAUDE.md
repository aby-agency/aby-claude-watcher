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
| running | green `#22c55e` | Last event = `assistant` with `stop_reason: "tool_use"` |
| waiting | blue `#3b82f6` | `end_turn` + 2s no activity |
| error | red `#ef4444` | Error detected in events |
| completed | dark grey `#4b5563` | `last-prompt` event OR session file gone + PID dead |

## Key decisions

- JSONL `tool_use` events only written AFTER user approves permission — cannot detect permission prompts
- Only `end_turn` reliably signals "waiting for user" — no stale timer (caused false positives)
- Waiting delay: 5s (avoids false positives between rapid tool calls)
- Notifications: 30s cooldown per session to avoid spam
- Polling at 250ms (`fs.watch` unreliable on macOS)
- Config saves debounced 500ms, `saveSync` on shutdown
- Session completed only when: `last-prompt` event OR (session file gone + PID dead)
- PID alive + session file gone = state unchanged (don't force a transition)
- All data (model, slug, branch) uses latest value (resume-safe)
- Input sanitization on all shell/AppleScript interpolation
