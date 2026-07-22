# Changelog

All notable changes to Aby Claude Watcher are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-07-22

### Added
- **Dynamic island.** Une île ancrée à l'encoche du MacBook (et simulée en
  haut de l'écran principal quand il n'y en a pas — mode docké) remplace le
  popover du tray. Repliée : pastilles d'état agrégées avec compteur (chiffre
  dans la pastille, anneau rotatif pour les sessions actives, pulse pour
  celles qui réclament une action), sessions interactives à gauche de
  l'encoche, headless à droite. Au survol, le volet se déplie : liste des
  sessions cliquables (focus du terminal), sous-lignes des subagents actifs
  et des workflows (⚡ nom + progression), jauges de consommation 5 h et
  7 jours. L'encoche est mesurée précisément via AppKit (largeur et
  décentrage réels) ; clics au travers de la fenêtre partout hors de l'île.
- **Bannières de notification dans l'île.** Les événements « besoin de toi »
  (fin de tour, permission) descendent de l'île en pile : une ligne par
  session, chacune visible 10 s avec son propre compte à rebours, clic =
  focus du terminal. Mêmes règles que les anciennes notifications (cloche
  par session, report du son pending, mode Focus respecté).
- Réglage « Dynamic island » (activée par défaut).

### Changed
- Le clic sur l'icône du tray ouvre la fenêtre principale (le popover
  n'existe plus).
- La jauge du tray est inchangée ; le détail 5 h + 7 jours vit dans l'île.

### Removed
- **Notifications système macOS** — remplacées par les bannières de l'île,
  sans fallback : sans île affichée, l'attention passe par les sons, le badge
  du Dock et la jauge du tray.
- **Popover du tray** — remplacé par l'île.
- **Vue office pixel** (et son pipeline d'assets) — remplacée par l'île.

## [1.13.0] — 2026-07-15

### Added
- **Id de session visible sur les cartes.** Une ligne « Session » sous la
  branche (vues grille et compacte) affiche l'UUID complet de la session ; un
  clic le copie dans le presse-papier — prêt pour `claude --resume <id>` — avec
  un feedback « ✓ Copié ». Le clic ne déclenche pas le focus du terminal.

### Changed
- **Cartes apaisées.** Retrait du halo « liquid glass » (bloom radial flouté)
  et de la bordure teintée pleine carte sur les états qui réclament une action.
  L'état passe désormais par le badge (halo léger, point pulsé) et le filet
  1 px en haut de carte ; le cadre reste neutre. Les halos du popover sont
  inchangés.

## [1.12.0] — 2026-07-06

### Added
- **Jauge de consommation Claude dans la barre de menu.** Un anneau de
  progression coloré (vert < 50 % / ambre 50–80 % / rouge > 80 % du quota 5 h)
  accompagné de `5H X% · reste`, affiché **en permanence** dans le tray — comme
  le wifi ou l'heure. La source est l'usage déjà surveillé (endpoint OAuth) ; le
  temps restant est recalculé en continu depuis l'heure de reset, donc il défile
  juste même sans session Claude ouverte.

### Fixed
- **Icônes du tray invisibles.** Le point de couleur signalant une session en
  attente ne s'affichait pas : `nativeImage` ne sait pas rasteriser les SVG
  (image vide). Les icônes du tray (anneau + point) sont désormais dessinées en
  bitmap → point d'alerte de nouveau visible, anneau net en Retina.

### Changed
- Le tray affiche la consommation en permanence ; l'attention (« needs-you »)
  reste signalée par le badge du Dock et les notifications, plus par le tray.

## [1.11.0] — 2026-07-06

### Added
- **Soft Glass — refonte visuelle.** Cartes opaques à reflets (sheen spéculaire,
  bordure lumineuse, profondeur) remplaçant le thème plat GitHub-dark. Appliqué
  aux trois vues (grille / compacte / micro) et au popover, piloté par un jeu de
  tokens CSS partagés.
- **Glow-budget.** Le glow coloré est un *signal*, pas un décor : il est réservé
  aux états qui réclament une action (`pending` / `waiting` / `error`) ;
  `thinking` / `running` restent calmes. À N sessions, seules celles qui
  attendent l'utilisateur rayonnent — plus de « sapin de Noël ».
- **Menu bar glance.** Pastille colorée + compteur des sessions en attente dans
  la barre macOS (couleur de l'état le plus urgent), ou pourcentage d'usage
  quand rien n'attend.
- **Notifications natives macOS.** Bannière « needs-you » système ; un clic
  ramène le focus sur le terminal d'origine.
- **Respect de Focus / Ne pas déranger.** Le son et la bannière needs-you sont
  coupés quand un Focus macOS est actif ; le toast visuel dans l'app reste. La
  détection est tolérante (format inconnu → pas de suppression, jamais de crash).
- **Verre translucide (expérimental).** Toggle dans les réglages (désactivé par
  défaut) pour le vrai Liquid Glass natif, relié à la fenêtre — l'app reste sur
  le Soft Glass opaque par défaut.

### Changed
- Fond plus profond et cohérence visuelle sur toute l'app (toolbar, status bar,
  popover, section background).
- Compteur du dock aligné sur le glance du menu bar (`pending` + `waiting` +
  `error`, hors sessions background).

## [1.10.2] — 2026-06-06

### Fixed
- **Stale-state ding on the deferred pending sound** — the 5 s deferral checked
  the watcher's polled state at fire time, which lags the real approval click
  by up to ~300 ms (JSONL flush + 250 ms poll): a permission approved right at
  the wire could still ring (`tool_use` visible 315 ms *after* the bell in the
  forensic log). The fire-time check now force re-reads the session's JSONL
  (`watcher.refreshSession()`) before deciding, shrinking the residual race to
  Claude Code's flush latency only.

## [1.10.1] — 2026-06-06

### Fixed
- **Double ding on idle reminder** — Claude Code fires a `Notification` hook
  ~60 s after each turn ends ("Claude is waiting for your input"). The watcher
  treated it as a permission request: the already-waiting session flipped back
  to amber *pending* and rang a second time. The permission hook now forwards
  an `idle` flag; an already-waiting session ignores the reminder (no re-ring,
  no state flip), and a session whose `end_turn` was missed is corrected to
  *waiting* (`hook:idle-reminder`) instead of *pending*.

### Changed
- **Pending sound deferred 5 s** — permission prompts resolved within seconds
  (user already at the keyboard, or auto-approved) no longer ring: the sound
  fires only if the session is still pending/waiting 5 s later. The toast
  stays immediate.

### Added
- **Notification forensics** — every emitted notification is logged in
  `main.log` (`[notif] fired … sound=on|off`), along with played sounds
  (`[notif] sound …`) and skipped deferred sounds (`[notif] sound skipped …`),
  so "why did it ding?" is answerable from the log.

## [1.10.0] — 2026-06-04

### Added
- **Background sessions section** — headless sessions (`entrypoint !== "cli"`
  in `session.json`: SDK runs, scheduled agents, remote workers) are now
  detected as background and grouped in a dedicated collapsible *Background*
  section below the interactive ones. They don't respond to click-to-focus
  (there is no terminal to focus) and their waiting/pending notifications are
  muted unless the per-session bell is explicitly enabled. The collapsed state
  persists across restarts, and hidden background sessions keep their saved
  order.
- **Multi-agent workflow badges** — a session running a multi-agent workflow
  (e.g. a deep-research harness spawning 100+ subagents) now shows one
  aggregated violet badge per run — `⚡ deep-research — 12 agents actifs
  (27/39)` — instead of an unreadable flood of agent rows. Counters update
  live every 2 s from the run journal, even while the parent session is idle
  waiting for the workflow to finish. When the run completes, a one-shot toast
  fires (`⚡ deep-research terminé — 103 agents, 6 min`, sound per session
  prefs, deliberately no "needs you" bell — it is information, not an action
  request) and the badge disappears. Killed runs go stale after 30 min of
  journal silence and drop without a completion toast. Workflow agents never
  affect the parent session's displayed state or its blocking-agent logic.

## [1.9.0] — 2026-05-29

### Added
- **File logging** — the app now writes a persistent log to
  `~/Library/Logs/aby-claude-watcher/main.log` (5 MB rotation) via
  `electron-log`. Production builds launched from the Finder no longer lose
  their output: errors and every session state transition are recorded with
  their trigger (e.g. `running→pending (hook:PreToolUse)`), making transient
  state bugs diagnosable from the log instead of requiring live reproduction.
  Verbose `debug`-level lines (focus detection, `/clear` migration) are
  written only in dev (`--dev` / `ABY_DEBUG`); production logs at `info`.
- **Crash handler** — uncaught exceptions and unhandled promise rejections in
  the main process are now captured to the log with a full stack trace instead
  of killing the tray app silently.
- **Agent fleet view** — the nested sub-rows now show *all* running agents under
  a session, foreground and background alike (previously only detached background
  agents appeared). A session blocked on a foreground agent is displayed as
  *running* (not pending/orange) with its bell and sound suppressed — it is busy
  delegating, not waiting on you. Background agents are unaffected: the parent can
  still legitimately be pending while they run in parallel.

### Fixed
- **AskUserQuestion pending flicker** — catching up on a batch of JSONL lines
  that already contained an answered `AskUserQuestion` / `ExitPlanMode` no longer
  flashes a spurious `pending` state (and false "needs you" notification). The
  interactive-tool pending is now deferred and cancelled if its `tool_result`
  lands in the same read batch, mirroring the hook-driven pending path.
- **`tool_use:null` log label** — streaming assistant messages that carry
  `stop_reason:tool_use` without a tool_use block now log `tool_use:?` instead
  of `tool_use:null`.

## [1.8.0] — 2026-05-25

### Added
- **Window transparency** — opt-in setting (off by default) under
  Settings → General. When enabled, the window turns translucent while idle
  and returns to full opacity on focus or hover. An opacity slider (30–100 %)
  sets the idle level; the 30 % floor keeps the window from becoming
  invisible/unclickable. Implemented with `BrowserWindow.setOpacity()`, so it
  applies uniformly across grid, compact and micro views. While dragging the
  slider the value previews live (the focus rule is bypassed so the effect is
  visible even though the settings modal holds focus).

### Fixed
- **Notification showed the project name, not the custom one** — after
  renaming a session card, the toast still displayed the original
  project/slug name (e.g. "Invictorius" instead of "Recherche"). The
  `show-notification` payload now carries the custom name and the toast
  renders `customName || projectName`, matching the cards and the popover.

## [1.7.2] — 2026-05-22

### Fixed
- **No toast in compact view when bell was off** — toasts were gated on
  the per-session bell pref (`prefs.modal`) at the main-process level,
  so users in compact view who had never enabled the bell got no visual
  signal at all on `waiting` / `pending` transitions. The `show-notification`
  IPC now fires unconditionally; the renderer gates by view mode instead.
  Compact view always shows the toast — the bell there only controls
  sound + native OS notifications. Grid view behaviour is unchanged
  (bell still controls the toast). Micro view still skips the toast
  entirely (window is too small for an overlay).

## [1.7.1] — 2026-05-22

### Changed
- **State color rework** — adjusted the palette across all view modes for
  better contrast between `running`, `thinking`, `waiting`, `pending` and
  `error`.

### Fixed
- **Compact branch truncation** — long git branch names overflowed their
  slot in compact cards; now truncated with ellipsis.
- **Subagent session-dir resolution** — `SubagentTracker` was deriving the
  agent session directory from a path that didn't always match what the
  watcher actually resolved, causing some subagents to be missed. The
  tracker now reuses the watcher's resolved JSONL path.

### Added
- **Nested sub-rows in compact and micro views** — the subagent sub-cards
  introduced in 1.7.0 now also render under their parent session in
  compact and micro layouts (not just grid).

## [1.7.0] — 2026-05-21

### Added
- **Live background subagents** — the watcher now scans
  `~/.claude/projects/<session>/agent-*.jsonl` + `agent-*.meta.json`,
  captures `Agent` tool_use dispatches per session, derives state
  (running / completed / error) from the agent's last event plus mtime,
  and renders nested sub-cards under each parent session showing what
  background work is in flight. Includes a `SubagentTracker` wired
  into the main process and serialized over IPC.
- **`subagents.js` shipped in the packaged build** and added to the
  test suite (`test/subagents.test.js`).

## [1.6.1] — 2026-05-20

### Fixed
- **Popover height stuck regardless of session count** — the tray popover
  measured `.popover-body.scrollHeight` to auto-resize, but that element
  has `height: 100vh` + `overflow: hidden` and its scrollable child
  (`.popover-list`) scrolls internally without pushing the parent.
  `scrollHeight` therefore always returned the current window height,
  so opening the popover with 1 session or 15 sessions produced the
  exact same ~360px window. Height is now computed from
  `header.offsetHeight + popList.scrollHeight + footer.offsetHeight + 2px`
  (body borders) so the window grows up to the existing 600px clamp
  before the inner list takes over scrolling.

## [1.6.0] — 2026-05-10

Product pivot: the app now monitors only **live** Claude Code sessions.
Completed sessions vanish the moment Claude exits, the resume / clear
flows are gone, and the codebase is ~250 lines lighter. The value prop
becomes "ambient awareness of what's running right now" — anything else
(history, resume) belongs to the `claude` CLI itself.

### Removed
- **Completed state** — `STATES.COMPLETED`, the dark-grey badge, the
  "Anciennes sessions" / "Old sessions" divider, and every code path
  that transitioned a session into completion. When a session ends
  (file gone + PID dead), it's purged instantly from the UI and the
  config store. Legacy completed sessions persisted by older versions
  are migrated out on first launch.
- **Resume flow** — the play button on completed cards, the resume
  modal with its `--dangerously-skip-permissions` toggle, the
  `resume-session` IPC handler, `focus.resumeSession()`, and the
  best-effort hook installation that ran before resuming.
- **Clear-completed action** — the "Tout effacer" / "Clear all" button,
  its confirmation modal, and the `clear-completed-sessions` IPC. With
  no completed sessions left to accumulate, the bulk-clear has no job.
- **Cleanup** — `endedAt` field, `wasResumed` flag, micro-view's
  completed filter, drag-drop completed restrictions, the
  `--state-completed` / `--glow-completed` CSS variables, all
  `state_completed` / `action_resume` / `resume_*` /
  `clear_completed_*` / `sessions_old_label` i18n strings,
  `sanitizeSessionId` from focus.js (only used by resume).

### Changed
- **Notification cooldown reset** — previously cleared on any state
  transition out of waiting/pending, so a Claude tool-loop
  (`waiting → running → waiting`) re-rang the bell every cycle. Now
  cooldown only resets when state goes to `thinking` (= a real user
  prompt landed). One ding per "Claude is waiting for you" episode.
- **Error sessions** stay visible with a manual X button. They're the
  only non-active state surfaced in the UI now — everything else is
  thinking / running / waiting / pending.

## [1.5.9] — 2026-05-06

This is a UX-driven cleanup release. The cards lost about half their
controls and the codebase about 200 net lines, while the experience
becomes more direct: one click on a card opens its terminal, one click
on the name renames it inline, no context menus, no "+" to add sessions
manually, no remote-control bouton.

### Removed
- **Remote-control feature** — `session.remoteUrl`, the globe button on
  cards, the context-menu entry, and the watcher's `bridge_status` event
  detection are gone. The internal `open-remote` IPC stays as the
  underlying transport for `openExternalUrl` (still used for the GitHub
  link in About).
- **Manual "Add session" `+` button** — the toolbar action and its modal,
  along with the `add-session` / `launch-session` IPC, the
  `watcher.addSession()` method, and `focus.launchSession()`. Sessions
  are auto-detected; the empty state now reads "Lancez `claude` dans un
  terminal — les sessions apparaissent ici automatiquement".
- **Rename modal** — replaced by inline rename (see Added).
- **Right-click context menu** — `showContextMenu` / `hideContextMenu`,
  the `<div class="context-menu">` placeholder, the `oncontextmenu`
  attribute on cards, and the global click listener that hid the menu.
  Every action that lived there is now reachable directly: focus
  terminal = click on the card, rename = click on the name, resume /
  delete = the existing buttons on completed/error cards.
- **Terminal `>_` button and "more" `⋯` button** on macro and compact
  cards. Card click handles focus.
- **`X sessions actives` header** above the list (was a 1.5.7 add).
- **Session slug** display on cards (the small grey hex string under the
  name). `handleCopyId` is left as dead code for now.
- **Pointer cursor** on hover of `.card` / `.compact-card` (it implied
  reorder), and the `cursor: grab` on draggable cards. `cursor: grabbing`
  is kept while a drag is actively happening.

### Added
- **Inline rename** — hover the project name and a pencil icon fades in;
  click to convert the span into an `<input>` in place. Enter saves,
  Esc cancels, blur saves. Skips the IPC roundtrip if the value didn't
  change.
- **Multi-window VS Code / Cursor focus** — the editor case in `focus.js`
  was rewritten around `open -a "<App>" "<cwd>"`. macOS LaunchServices
  routes the call to the window that already has that workspace open, so
  clicking a card reliably brings the right Code/Cursor window forward
  even when several windows are open. **Crucially, this needs no
  Accessibility nor Automation permission**, which the previous
  `System Events` / `AXRaise` approach did, and which broke during
  `npm run dev` because the dev Electron binary wasn't authorised.
- **`detectTerminalFromPid` reads `ps -o command=`** in addition to
  `comm=`. The truncated `comm=` is just `Electron` for both Code and
  Cursor main processes; the full command path
  (`/Applications/Visual Studio Code.app/...`) reliably distinguishes
  them.

### Changed
- **Compact view layout** is now 3 lines: `name + actions` / `état ·
  outil` / `branch`. The branch line wraps freely when the name is long
  (no more ellipsis cutting it off — there's room on its own line).
- **Status bar typography unified** — every label, percentage, reset
  countdown and clock icon now inherits the bar's `10 px / text-muted`,
  matching the `5h` / `7D` labels. One source of truth in `.status-bar`.
- **Card click = focus terminal** (single click) on macro and compact
  cards, matching the existing micro behaviour. Buttons inside the card
  call `event.stopPropagation()` so they keep their own actions.

## [1.5.8] — 2026-05-06

### Changed
- **Compact view → mini cards** — the previous compact view was a single
  line per session that landed visually almost on top of the micro view.
  It's now a true intermediate density: a small card with a header
  (project + slug + actions) and two metadata lines (state · duration ·
  tool · tokens, then branch · model). The list uses the same
  responsive auto-fill grid as the macro view but with narrower
  minimum (260 px vs 320 px), so a typical 13" screen fits 8-10 cards
  vs 3-4 in macro. Macro and micro views are unchanged.
- **Settings modal: fixed content height** — the modal used to resize
  itself depending on which tab (Général, Notifications, À propos) was
  active. Cycling through tabs forced you to chase the tab buttons with
  the mouse. The content area is now a fixed 440 px with internal
  scrolling for tabs that overflow, so the tab row stays anchored.

## [1.5.7] — 2026-05-06

### Added
- **Active-session count header** above the list (`X active sessions`) so a
  glance at the dashboard tells you immediately how busy you are.
- **Old sessions divider** — completed sessions are now visually separated
  from active ones with a divider that includes a **Clear all** button. A
  confirmation modal protects against fat-finger purges. The clear only
  removes sessions from the dashboard's view (and their custom names /
  notification preferences); the underlying Claude Code session files on
  disk are untouched, so `claude --resume` still works.
- **About panel** describing what the app does — replaces the keyboard
  shortcuts modal in the toolbar's "?" button.

### Changed
- **Update check cadence** — first check at startup is now 10 s (was 30 s),
  and the app re-checks every 2 hours while it's running (previously only
  on launch). The internal 1 h rate limit on the manual "Check" button is
  unchanged.
- **Removed Cmd-* keyboard shortcuts** (⌘1-9, ⌘G, ⌘P, ⌘F, ⌘?). They were
  rarely used, took inventory in the modal that was better spent on app
  context, and added behaviour that interfered with macOS Cmd-key
  conventions. <kbd>Esc</kbd> still closes any open modal — that's UX
  baseline, not a "shortcut".

## [1.5.6] — 2026-05-06

### Changed
- **Update banner padding and typography** — the "Installer maintenant"
  button felt cramped, especially during the long-text states
  ("Téléchargement 47 %", "Installation et redémarrage…"). Roughly
  doubled the button's vertical padding, bumped font sizes by 1 px,
  added `font-weight: 500` and `white-space: nowrap` so the label
  doesn't wrap, and gave the banner itself more breathing room
  (gap 12→16, padding 8/14→12/20). Hover now lifts the button by 1 px
  for tactile feedback.

## [1.5.5] — 2026-05-06

### Added
- **7-day window reset countdown** in the status bar — the 5-hour bar already
  showed the time-until-reset; the 7-day bar now does too. Same visual
  treatment (clock icon + relative time like `2h30` or `3 days`).

## [1.5.4] — 2026-05-06

### Fixed
- **DMG helper blocked by Gatekeeper on Sequoia** — the `Fix Gatekeeper.command`
  shipped in 1.5.3 was itself flagged by macOS Gatekeeper on first launch (same
  quarantine attribute applied to every file in a downloaded DMG). Removed.
  The DMG background now shows the unlock command directly so the user can
  read it and paste it into Terminal (signed by Apple, no Gatekeeper prompt).
  This is only needed for the first install — subsequent updates go through
  the in-app updater which doesn't trigger quarantine.
- **Hidden DMG metadata files appearing in the layout** — `.background.tiff`,
  `.VolumeIcon.icns`, `.fseventsd`, and `.Trashes` were placed by Finder right
  on top of the visible icons whenever the user had `Cmd+Shift+.` active. A
  post-build hook now repacks each DMG and moves these entries to (2000, 2000)
  in the `.DS_Store`, well outside the window's visible area.

### Changed
- **Card details: branch first, tool last** — the tool chip can grow long
  (e.g. `WebFetch`, `TodoWrite`); promoting it to the last row of the
  2-column grid (where it sits alone) gives it the full card width to
  breathe. Branch moves to the first row where its short text fits the
  narrower cell better.

### Added
- `build/push-hidden-offscreen.py` — repacks a DMG with hidden metadata
  files moved off-screen. Wired into `electron-builder` via the
  `afterAllArtifactBuild` hook in `build/after-artifact-build.js`.
  Requires Python 3 with `ds-store` and `mac_alias` installed
  (`pip3 install --user ds-store mac_alias`).

## [1.5.3] — 2026-05-06

### Added
- **One-click in-app updates** — the updater now downloads the matching DMG
  asset directly from the GitHub release and replaces the running app via a
  detached install script (mount → copy → unmount → relaunch). No more manual
  re-download on every release. Works with ad-hoc signing (no Apple Developer
  ID required). Falls back to the GitHub link if no DMG asset matches the
  running architecture.
- **Custom DMG layout** — visual install instructions (drag-to-Applications
  arrow) and a `Fix Gatekeeper.command` script bundled in the DMG that removes
  the macOS quarantine attribute and launches the app, for first-install users
  blocked by Gatekeeper.

### Changed
- `checkForUpdates()` response now includes `dmgUrl`, `dmgName`, `dmgSize`, and
  a `canAutoInstall` flag so the renderer can branch between in-app install
  and the legacy GitHub link.
- The "About" panel and the update banner now show a download progress bar
  during the update download, and an "Installing…" state right before the
  app quits to relaunch on the new version.

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
