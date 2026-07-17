# Vue Office v2.4 — cubicle dense + bulles émotes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pièce 6×4 dense façon cubicle, bulles émotes LimeZu animées montrant l'action en cours (lastTool), notifs en scène (enveloppe sur cloche active).

**Architecture:** Le bake gagne les émotes (sheet `UI_thinking_emotes_animation_16x16.png` + icônes Modern UI compositées dans une bulle vide au bake) et le mobilier de densité (lampe, tableau blanc, papiers). `office-layout.js` : géométrie 6×4 + `emoteFor(session, bellActive)` (fonction pure, priorité enveloppe > état > outil). `office.js` : rendu de la bulle au-dessus du perso (2 frames alternées au tick), plus de `pixelText` d'état. Le renderer expose l'état de cloche à Office (les bells vivent déjà dans `activeBells` de renderer.js, scope partagé).

**Tech Stack:** inchangé. Sources d'assets supplémentaires (packs déjà locaux) :
- Émotes : `moderninteriors-win/4_User_Interface_Elements/UI_thinking_emotes_animation_16x16.png` (160×160, grille 16×16 — la rangée 0 contient l'anim d'apparition de la bulle vide, les rangées suivantes des émotes ; l'animation d'une émote = 2 frames à alterner ; CARTOGRAPHIER au bake via `--preview`, les coordonnées exactes se vérifient à l'œil).
- Icônes à composer : `modernuserinterface-win/16x16/Modern_UI_Style_1.png` (petits pictos plats ~8-10 px : engrenage, loupe, crayon, enveloppe, etc. — repérer au preview).
- Mobilier : lampe `Modern_Office_Singles_141-146`, tableau blanc `170-172`, documents `113-115` (choisir au preview ce qui rend le mieux).

## Global Constraints

- Mêmes contraintes que les plans précédents (zéro dépendance, couleurs d'état, timer unique, zoom [1..4], commits sans trailer, jamais de push, assets jamais commités).
- **Géométrie 6×4** (cols 0-5, rows 0-3) : mur rangée 0 — tableau blanc (1,0)-(2,0), porte (4,0), spawn (4,1) ; bureau+setup (1,1) avec lampe et papiers posés dessus (offsets `dy`/composition au choix visuel) ; perso (1,2) dos au spectateur ; couloir = rangée 2 ; comptoir+tasse café (0,3) rangée basse... **ATTENTION** : c'est une proposition — l'implémenteur de la Task 2 a latitude ±1 tuile et peut passer à 6×5 si 6×4 s'avère trop serré à l'œil (le couloir doit rester sans meuble dans les deux sens de circulation, invariant testé). La plante peut sauter ou passer en (5,3) si ça respire mieux.
- Extensions : +1 col subagents (stations sud comme aujourd'hui), +2 rangées réunion — positions recalées sur la nouvelle base, mêmes invariants.
- **Une seule bulle à la fois** au-dessus du perso principal, priorité : enveloppe (bell active) > émote d'état (pending « ! », thinking « … », error colère, waiting-inactif zzz) > outil (running). Subagents/meeting : pas de bulle (v1 du système).
- Mapping outil→émote (fonction pure `emoteFor`) : Bash/BashOutput → terminal|engrenage ; Read/Grep/Glob → loupe ; Edit/Write/NotebookEdit → crayon ; WebFetch/WebSearch → globe|enveloppe-web ; Task → agents ; `mcp__*` et inconnu/null → engrenage. Les noms exacts d'émotes dépendent de ce que le sheet offre — la Task 1 fixe la liste réelle (`EMOTES` du manifest), la Task 2 s'y conforme.
- La cloche : `Office` lit `activeBells` (Map de renderer.js, scope global partagé) — n'introduire AUCUN nouveau canal ; en vue office `applyBellVisual` reste no-op.

---

### Task 1: Bake des émotes + mobilier de densité

**Files:**
- Modify: `scripts/office-sprites.js` (section `EMOTES` + ajouts `FURNITURE`)
- Modify: `scripts/bake-assets.js` (extraction émotes + compositing icône-dans-bulle + preview enrichi)
- Modify: `test/bake-smoke.test.js` (frames/anims émotes obligatoires)

**Interfaces:**
- Produces dans l'atlas : anims `emote.think`, `emote.alert`, `emote.angry`, `emote.zzz`, `emote.mail` (2 frames chacune, loop) extraites du sheet émotes ; anims `emote.tool.terminal`, `emote.tool.search`, `emote.tool.write`, `emote.tool.web`, `emote.tool.agents`, `emote.tool.gear` (2 frames : bulle vide × icône compositée au bake, la 2e frame = bulle décalée d'1 px pour le wobble si le sheet ne fournit pas de paire) ; frames `deskLamp`, `whiteboard`, `papersDesk`.
- `EMOTES` exporté par office-sprites.js : `{ <name>: {frames: [{x,y},{x,y}]} }` pour les émotes natives, `TOOL_EMOTES: { <name>: {icon: {x,y,w,h}} }` pour les composées.

- [ ] **Step 1:** Cartographier le sheet émotes : générer un contact-sheet étiqueté du `UI_thinking_emotes_animation_16x16.png` (grille 16 px, indices) et des zones de pictos de `Modern_UI_Style_1.png`, le REGARDER, choisir : bulle « … » animée, « ! », colère, zzz, enveloppe, bulle vide (pour compositing) + 6 icônes outils. Consigner les coordonnées dans `EMOTES`/`TOOL_EMOTES` de office-sprites.js.
- [ ] **Step 2:** Étendre bake-assets.js : extraction des paires de frames, compositing icône centrée dans la bulle vide (blit avec offset), lampe/tableau/papiers en FURNITURE (bbox-trim), preview enrichi de toutes les nouvelles frames.
- [ ] **Step 3:** `npm run bake -- --preview` (ou `node scripts/bake-assets.js --preview`), REGARDER le preview : chaque émote lisible, icônes centrées dans les bulles, mobilier propre. Itérer les coordonnées jusqu'à ce que ce soit net.
- [ ] **Step 4:** Smoke test : ajouter les anims/frames obligatoires, `node test/bake-smoke.test.js` vert, puis `npm test` complet.
- [ ] **Step 5:** Commit `feat(office): bake émotes-bulles + mobilier cubicle (lampe, tableau, papiers)`.

---

### Task 2: Géométrie 6×4 dense + `emoteFor` pur

**Files:**
- Modify: `ui/office-layout.js`
- Modify: `test/office-layout.test.js`

**Interfaces:**
- Consumes: noms d'anims émotes réels fixés par Task 1 (lire `ui/office-assets/atlas.json` pour la liste).
- Produces: géométrie 6×4 (constantes recalées, invariants existants adaptés : couloir, non-traversée des meubles dans TOUS les trajets — bureau, comptoir, plante si conservée) ; `emoteFor(session, bellActive) → string|null` (nom d'anim atlas, priorité enveloppe > état > outil ; `waiting` sans cloche ET `session.state.since` > 2 min → zzz si l'info existe, sinon zzz sur waiting simple — REGARDER ce que session expose réellement et choisir, documenter le choix) ; `statics` densifiés (lampe/papiers sur le bureau via `dy`, tableau blanc au mur).
- Tests : géométrie (dimensions, positions, non-traversée mise à jour), `emoteFor` (les 3 niveaux de priorité + mapping outils + null pour subagents/inconnus), rétro-compat des invariants (spawn, café, leave, résurrection, extensions subs/réunion).

Steps : (1) tests d'abord (géométrie + emoteFor), (2) échec vérifié, (3) implémentation, (4) `npm test` complet vert, (5) commit `feat(office): pièce 6×4 cubicle + emoteFor (priorités bell/état/outil)`.

---

### Task 3: Rendu bulles + notifs en scène

**Files:**
- Modify: `ui/office.js`
- (rien d'autre — pas de changement renderer.js attendu : `activeBells` est déjà au scope global)

**Interfaces:**
- Consumes: `OfficeLayout.emoteFor`, anims `emote.*` de l'atlas, `activeBells` (Map globale de renderer.js).
- Produces: dans `drawRoom`, au-dessus du perso principal : bulle = `emoteFor(s, activeBells.has(s.sessionId))`, 2 frames alternées au tick (`tickCount >> 2` pour un wobble à 2 fps), ancrée au-dessus de la tête (offset à régler visuellement) ; SUPPRESSION des `pixelTextOn` d'état («…», «!») — le « +N » subagents reste en pixelText. La bulle ne doit pas être teintée par le voile d'état → la dessiner APRÈS la teinte (déplacer le bloc teinte avant les bulles, ou dessiner la bulle en dernier — au choix, documenté).

Steps : (1) implémentation, (2) `npm test` (aucune régression), (3) vérification CDP avec sessions forgées dans CHAQUE état + une cloche active (forcer `setBell` via CDP) : bulle outil en running (change avec lastTool), « … » thinking, « ! » pending, colère error, zzz waiting, enveloppe qui PRIME sur tout quand bell active, aucune bulle sur subagents, bulle nette non teintée — screenshots REGARDÉS, itérer offsets ; (4) nettoyage + relance repo ; (5) commit `feat(office): bulles émotes en scène — action en cours + notifs`.

---

## Hors plan
- Le plafonnement zzz « waiting long » exact suit ce que session expose (décision Task 2 documentée).
- Pas de bulle sur subagents/meeting en v1 du système (dette possible : mini-bulles).
