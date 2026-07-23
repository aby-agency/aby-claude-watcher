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
- `island.js` + `island-model.js` — Dynamic island ancrée à l'encoche (fenêtre transparente + logique pure testée)
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
- Pending sound deferred 5s — rings only if still pending/waiting at fire time (permissions approved in seconds shouldn't ding); fire-time check calls `watcher.refreshSession()` first (polled state lags the real click by flush + 250ms poll — approval at the wire must not ring on stale state; residual race = CC flush latency only, irreducible); toast stays immediate; every emit/skip logged `[notif]`
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
- Jauge de conso 5h dans le tray (`ring-gauge.js`, module pur testé) : anneau de progression coloré (vert <50 / ambre 50-80 / rouge >80) + titre `5H X% · reste`. Source = `usage.js` (`UsageMonitor`, endpoint OAuth `/api/oauth/usage`, `utilization`+`resets_at`), PAS la statusline. Temps restant recalculé depuis `resets_at` (juste même sans session). Conso affichée **en permanence** dans le tray ; l'attention (needs-you) passe par le badge du Dock + les notifs, plus par le tray.
- Cartes grid : rendu sobre voulu — pas de bloom radial ni bordure teintée pleine carte (retirés v1.12.x, « liquid glass » raté) ; l'état passe par le badge (halo léger + dot) et le filet 1px en haut. `--glow` (le dial global) a été retiré avec le popover, son seul consommateur ; les `--glow-thinking/-running/-waiting` distincts restent
- Ligne « Session » (UUID complet, clic = copie pour `--resume`) sous la branche en vue grid (pleine largeur via `.detail-session`) et compact
- Dynamic island (remplace le popover du tray, supprimé) : fenêtre `island.js` transparente always-on-top niveau `screen-saver`, taille FIXE 460×340 (jamais de resize au survol — flickers), click-through par défaut (`setIgnoreMouseEvents(true, {forward:true})`, le renderer suit les mousemove forwardés et bascule via IPC `island-hover`). Repliée : pilule noire fusionnée à l'encoche, LEDs AGRÉGÉES par état avec compteur (« ●1 ●3 »), interactives aile gauche / headless aile droite (même rendu des deux côtés depuis la pilule adaptative : pastilles 14px partout — la taille ex-headless généralisée en vraie géométrie 14/−4/2, PAS en transform scale qui casserait led-pulse ; l'ex-réduction terne/scale .8 des headless est abandonnée, la distinction vit dans le panneau), ordre fixe urgent-d'abord (pending, error, waiting, thinking, running) — a remplacé « une LED par session, cap 4 + +N » (1er choix de Paul, révisé à l'usage). Dépliée au survol UNIQUEMENT (pending/error = pulse de LED, JAMAIS d'auto-expand) : liste cliquable (focus, sauf headless) + jauge 5h (seuils alignés ring-gauge : rouge >80). Encoche mesurée via AppKit (`NSScreen.auxiliaryTop*Area` par osascript JXA) dès que le primary est `display.internal` — l'ex-heuristique workArea (`menuBarHeight ≥ 30`) qui gatait la mesure a été SUPPRIMÉE : pendant la bascule dock/undock Electron rend un workArea transitoire → fallback 180 sous une encoche de 185, badges rognés (constaté au premier undock post-v2.0.0) ; sa suppression élimine aussi le piège barre-de-menu-auto-masquée. Cache par géométrie SUCCÈS uniquement (un échec caché figeait le fallback à vie), re-check différé 1.5 s après chaque refresh (la rafale d'events screen d'une bascule peut finir sur un état transitoire — avant, seul un event fortuit type True Tone corrigeait), jeton de séquence contre les mesures croisées entre refresh concurrents, chaque layout loggué `[island]` dans main.log ; fallback gap 180px — l'encoche peut être décentrée (7pt sur MBP 16"). L'île vit sur l'écran PRINCIPAL, encoche ou non : en docké, FAUSSE encoche aux dimensions de la vraie (gap 180 — pilule compacte essayée et écartée, « tout petit » sur 34") ; re-check sur événements `screen`. Largeurs : pilule ADAPTATIVE et ASYMÉTRIQUE au repos — chaque colonne d'aile fait la largeur de SON contenu (`--wing-l`/`--wing-r` mesurés par le renderer en offsetLeft/offsetWidth, les boîtes de layout, PAS getBoundingClientRect : le transform badge-in scale .4 fausserait la mesure), une aile vide se replie à zéro ; le gap reste sur l'encoche via `translateX((wr−wl)/2)` ; panneau/bannière ouvert → la pilule redevient SYMÉTRIQUE (ailes = max des deux) pour se raccorder au drop centré, SANS minimum (l'ex-320 ouvert est retiré, le drop suit `--pill-w` exactement — intérieur compacté : rows/bannière 11px, r-state 10px, durée « · N min » supprimée des rangées avec son champ `minutes` du modèle) ; transitions width/transform/grid-template-columns `.3s cubic-bezier(.34,1.3,.42,1)` (rebond façon Dynamic Island), `overflow:hidden` sur la pilule = effet reveal pendant le stretch ; badges avec pop d'apparition `badge-in` (le renderer ne réassigne l'innerHTML d'une aile QUE s'il change — `setWing` — sinon le tick 30s rejouerait l'anim ; pending/error gardent `led-pulse`, défini APRÈS badge-in dans le CSS donc prioritaire) ; historique : les ailes flex:1 retombaient au min-content par aile → gap décalé de 28px, 3e badge ENTIER sous l'encoche physique — mesuré au CDP ; pilule vide au repos = 237 (encoche+padding) (planchers par élément essayés → marches 264/280/320 mesurées au CDP, retirés) ; coins bas de la pilule à 0 quand panneau/bannière ouvert — carré INSTANTANÉ à l'ouverture (`transition:none`), re-arrondi APRÈS le pli à la fermeture (`.12s ease .2s`), sinon pincement fugace. `enableLargerThanScreen: true` OBLIGATOIRE (sinon macOS clampe la fenêtre visible sous la barre de menu — `constrainFrameRect` ; `type:'panel'` ne suffit pas). Logique pure dans `island-model.js` (double export node/window, testé). Toggle réglages `islandEnabled` défaut on. Clic tray = fenêtre principale.
- Bannière needs-you (révision assumée du « jamais de mouvement autonome » : le panneau, lui, reste hover-only) : les notifications macOS sont SUPPRIMÉES sans fallback (décision Paul 2026-07-22) — `emitIslandBanner` aux 2 ex-points d'appel de la notif Apple, mêmes gardes héritées (prefs.sound, defer 5s pending, Focus, cooldown 30s amont). `island.sendBanner` auto-gardée (pas d'île visible = silence, clamshell compris). Renderer : PILE de bannières (une ligne par session, dédup par sessionId, timer 10s indépendant par ligne — 4s puis 6s jugées trop courtes, et le remplacement « une seule à la fois » écrasait les rafales) ; la bande s'allonge/rétracte d'elle-même ; `textContent` (pas d'innerHTML), clic sur une ligne = focus + retrait de la ligne, `setMouse(false)` quand la pile se vide (sinon capture de clics fantôme sous curseur immobile). Hover découplé : `setMouse` (click-through IPC) ≠ `setExpanded` (panneau) — survoler la bannière rend cliquable SANS déplier. L'état `error` n'a jamais eu de chemin de notif : bannière = pending/waiting, à l'identique de ce qu'elle remplace.
- `nativeImage.createFromDataURL()` NE rasterise PAS les data-URL SVG dans Electron (image vide, `isEmpty()` true) — le « point coloré » historique était muet à cause de ça. Les icônes du tray (anneau + point) sont dessinées en **bitmap RGBA à la main** (`ringBitmap`/`dotBitmap` → BGRA prémultiplié, AA par supersampling) puis `nativeImage.createFromBitmap(buf, {width, height, scaleFactor: 2})` pour le Retina.
- Vue office pixel SUPPRIMÉE (2026-07-22, jugée « ratée » par Paul) — remplacée par la dynamic island ; le pipeline bake/assets LimeZu est parti avec (plus de prérequis avant build DMG).
