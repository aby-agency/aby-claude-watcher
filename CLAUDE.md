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
- Dynamic island (remplace le popover du tray, supprimé) : fenêtre `island.js` transparente always-on-top niveau `screen-saver`, taille FIXE 460×340 (jamais de resize au survol — flickers), click-through par défaut (`setIgnoreMouseEvents(true, {forward:true})`, le renderer suit les mousemove forwardés et bascule via IPC `island-hover`). Repliée : pilule noire fusionnée à l'encoche, LEDs interactives aile gauche / headless aile droite (plus petites/ternes), cap 4 + « +N », ordre stable (sessionOrder puis récent d'abord — jamais par état). Dépliée au survol UNIQUEMENT (pending/error = pulse de LED, JAMAIS d'auto-expand) : liste cliquable (focus, sauf headless) + jauge 5h (seuils alignés ring-gauge : rouge >80). Encoche détectée par heuristique `display.internal && workArea.y - bounds.y ≥ 30` (aucune API publique — piège : l'heuristique rend 0 si la barre de menu est auto-masquée → fausse encoche 180 sous une vraie de 185, LEDs rognées ; config non utilisée par Paul, assumé) PUIS mesurée précisément via AppKit (`NSScreen.auxiliaryTop*Area` par osascript JXA, cache par géométrie, fallback gap 180px) — l'encoche peut être décentrée (7pt sur MBP 16"). L'île vit sur l'écran PRINCIPAL, encoche ou non : en docké, FAUSSE encoche aux dimensions de la vraie (gap 180 — pilule compacte essayée et écartée, « tout petit » sur 34") ; re-check sur événements `screen`. Largeurs : le minimum (320px) est porté par la PILULE (ailes flex:1 symétriques), bannière et panneau font `var(--pill-w)` EXACTEMENT (planchers par élément essayés → marches 264/280/320 mesurées au CDP, retirés) ; coins bas de la pilule à 0 quand panneau/bannière ouvert — carré INSTANTANÉ à l'ouverture (`transition:none`), re-arrondi APRÈS le pli à la fermeture (`.12s ease .2s`), sinon pincement fugace. `enableLargerThanScreen: true` OBLIGATOIRE (sinon macOS clampe la fenêtre visible sous la barre de menu — `constrainFrameRect` ; `type:'panel'` ne suffit pas). Logique pure dans `island-model.js` (double export node/window, testé). Toggle réglages `islandEnabled` défaut on. Clic tray = fenêtre principale.
- Bannière needs-you (révision assumée du « jamais de mouvement autonome » : le panneau, lui, reste hover-only) : les notifications macOS sont SUPPRIMÉES sans fallback (décision Paul 2026-07-22) — `emitIslandBanner` aux 2 ex-points d'appel de la notif Apple, mêmes gardes héritées (prefs.sound, defer 5s pending, Focus, cooldown 30s amont). `island.sendBanner` auto-gardée (pas d'île visible = silence, clamshell compris). Renderer : bande max-height 4s sous la pilule, une seule à la fois, `textContent` (pas d'innerHTML), clic = focus + `setMouse(false)` en fin de `hideBanner` (sinon capture de clics fantôme sous curseur immobile). Hover découplé : `setMouse` (click-through IPC) ≠ `setExpanded` (panneau) — survoler la bannière rend cliquable SANS déplier. L'état `error` n'a jamais eu de chemin de notif : bannière = pending/waiting, à l'identique de ce qu'elle remplace.
- `nativeImage.createFromDataURL()` NE rasterise PAS les data-URL SVG dans Electron (image vide, `isEmpty()` true) — le « point coloré » historique était muet à cause de ça. Les icônes du tray (anneau + point) sont dessinées en **bitmap RGBA à la main** (`ringBitmap`/`dotBitmap` → BGRA prémultiplié, AA par supersampling) puis `nativeImage.createFromBitmap(buf, {width, height, scaleFactor: 2})` pour le Retina.
- Vue office (v4 « open-space zoné ») : UNE seule salle, UN canvas, zonée en quadrants reliés par un couloir central toujours libre — lounge haut-gauche (waiting sans cloche active : canapé d'angle en L + table basse/café + plante, cap 8 + badge « +N »), agents bas-gauche (thinking/running/pending/error + waiting-à-cloche-active, rangées de 3 postes fauteuil ORANGE, aucun cap), deep-research haut-droite (agents de workflows, postes latéraux empilés, cap 8 + « +N »), headless bas-droite (isBackground, mêmes rangées que agents mais fauteuil NOIR, cap 6 + « +N », pas de click-focus). Row 5 = rangée de RESPIRATION (sol nu des deux côtés, `AGENTS_TOP`/`HEADLESS_TOP` = 6) : les étiquettes pixel des debout du lounge/dr (row 4) se dessinent une rangée sous eux — collées aux consoles, elles ensevelissaient perso assis + console (constaté au CDP). Étiquettes clampées horizontalement (perso à tx 0 → boîte entière dans le canvas), bulles émotes clampées à y≥0 (sièges canapé row 1 : la bulle glisse sur la bande mur au lieu d'être clippée hors canvas). `stationConsole` = single 130 (écran panoramique 16×14, 1 tuile — le 227 précédent était un composite 32px qui désaxait l'écran du perso), posé `dy:-8` sur un `desk` (single 262, 16×16, 1 tuile — le pendant exact du 263 2-tuiles, écarté sur retour Paul : le plateau débordait à droite du perso ; les portables subagents posent au sol) pour dépasser au-dessus de la tête de l'assis (même colonne, sinon englouti) ; écrans/setups + acteurs installés à un poste = obstacles de la passe étiquettes (une étiquette qui les chevauche épuise ses décalages puis n'est pas dessinée — tooltip en filet). Subagents : portable à côté du poste du parent (jusqu'à 2, « +N » au-delà). Migration lounge↔poste = vraie marche visible par le couloir (plus de téléport porte-à-porte v3) ; waiting + cloche active reste au poste avec la bulle « ! », part au lounge à l'expiration. LED sur `stationConsole` par poste occupé (agents ET headless) ; bulles émotes + priorités, étiquettes pixel anti-collision (bulles prioritaires), badges « +N » dessinés sur canvas (bande mur, toujours libre) ; footer unique « Office · N session(s) ». UN canvas, UN timer 8 fps coupé vue inactive ; clic sur un perso = focus session (headless exclu). Fix rendu (Task 3, pas du layout) : les fragments `sofaCornerA`/`sofaCornerB` du canapé contiennent CHACUN leur propre bras horizontal — les poser côte à côte sans chevauchement affichait deux coins dupliqués ; `sofaCornerA` chevauche `sofaCornerB` d'1 tuile pour fusionner les coussins. Le décor `sideDesk90`/`sideSetup90` du poste deep-research est décalé d'1 tuile à droite de l'acteur (posé sur sa propre tuile, il était entièrement recouvert par le sprite standing 16×32). Assets jamais commités (licence LimeZu, repo public) : `npm run bake` régénère `ui/office-assets/` (gitignoré) — À FAIRE AVANT tout build DMG.
