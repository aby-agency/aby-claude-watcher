// ui/office.js — moteur de rendu de la vue office v4 : UNE seule salle
// « open-space » zonée (lounge/agents/deep-research/headless), UN canvas, UN
// SEUL timer 8 fps. Chargé APRÈS office-layout.js, AVANT renderer.js (les
// globals de renderer.js — sessions, activeBells, handleFocus, esc, t, … —
// ne sont touchés qu'à l'exécution, jamais au chargement du module). Vue
// inactive = timer stoppé.
//
// v3 → v4 : le container #officeView passe de 3 salles fixes (3 canvases) à
// UNE seule carte/canvas. `roomFor(snapshot, state)` (office-layout.js) ne
// retourne plus un tableau de salles par fonction mais UN objet unique
// {cols, rows, statics, zones} — les 4 zones (lounge/agents/dr/headless)
// cohabitent dans le même espace, reliées par un couloir central. Tout
// l'acquis du rendu v3 (probe/atlas, drawFrameOn/animFrameName, assise
// demi-tile -5px, fauteuil overlay conditionnel, LED de poste occupé, bulles
// émotes + priorités, étiquettes anti-collision, hit-test par acteur,
// tooltip, lastKnown + prune, timer unique) se transpose à l'identique sur
// UN SEUL passage de dessin au lieu d'un par salle — plus de `roomKey`
// (`OfficeLayout.actorsAll(state)` remplace `actorsIn(state, roomKey)`).
// Nouveau en v4 : les badges « +N » par zone (avant : footer DOM par salle)
// sont dessinés SUR LE CANVAS, dans la bande mur (row 0, toujours libre de
// tout mobilier/acteur — cf. buildShell) au-dessus de la boîte de la zone
// concernée — il n'y a plus qu'un seul footer DOM (nom + compteur global).
// Voir docs/superpowers/specs/2026-07-19-office-open-space-design.md (fait
// foi) et le plan associé (Task 3).
const Office = (() => {
  const TICK_MS = 125;
  const SCALE_MIN = 1, SCALE_MAX = 4;
  const STATE_COLORS = { thinking: '#a78bfa', running: '#3b82f6', waiting: '#22c55e', pending: '#f59e0b', error: '#ef4444' };
  // Décalage des badges « +N » (cf. drawOverflowBadge) : quadrants du HAUT
  // (lounge/dr) → quart gauche de leur boîte ; quadrants du BAS (agents/
  // headless) → quart droit — lounge+agents et dr+headless partagent
  // chacun la même boîte en x (office-layout.js), donc sans ce décalage
  // leurs badges se dessineraient au même endroit si les deux débordent.
  const BADGE_SIDE = { lounge: 'left', agents: 'right', dr: 'left', headless: 'right' };

  let atlas = null, manifest = null;
  let available = null;
  let probePromise = null;
  let state = null;          // OfficeLayout.createState()
  let timer = null;
  let tickCount = 0;
  let tooltip = null;
  let canvasEl = null;       // le SEUL canvas (v4) — capturé une fois par ensureDOM
  // Dernière donnée connue d'une session, gardée le temps de la marche de
  // sortie (session déjà supprimée de `sessions` mais l'acteur marche encore
  // vers la porte, ou sert de source pour le tooltip/LED d'un acteur
  // recherche dont la session parente vient de disparaître).
  const lastKnown = new Map();
  // Rects de hit-test (CSS→natif), recalculés à chaque drawRoom. Un seul
  // canvas en v4 : plus besoin d'un WeakMap par canvas (v3 en avait 3).
  let hitRects = [];

  function probe() {
    if (available !== null) return Promise.resolve(available);
    if (probePromise) return probePromise;
    probePromise = (async () => {
      try {
        const res = await fetch('office-assets/atlas.json');
        if (!res.ok) throw new Error(res.status);
        manifest = await res.json();
        // Fix reviewer final (quick-win, atlas périmé) : un manifest v3 (ou
        // antérieur) charge sans erreur réseau — `stationConsole` est un
        // frame v4 (postes agents/headless, cf. office-layout.js buildAgents/
        // buildHeadless) absent de tout atlas plus ancien. Sans ce garde,
        // `available=true` sur un atlas périmé fait planter le rendu plus
        // tard (frames v4 manquantes) au lieu de retomber, ici, sur le même
        // chemin que « pas d'atlas du tout » (bouton masqué, cf. isAvailable).
        if (!manifest.frames || !manifest.frames.stationConsole) {
          console.warn('[office] atlas périmé — relancer npm run bake');
          available = false;
          return available;
        }
        atlas = new Image();
        await new Promise((ok, ko) => { atlas.onload = ok; atlas.onerror = ko; atlas.src = 'office-assets/atlas.png'; });
        available = true;
      } catch (e) {
        console.warn('[office] atlas indisponible:', e.message || e);
        available = false;
      }
      return available;
    })();
    return probePromise;
  }

  // ─── Frames/anims (inchangé v2/v3) ───
  function drawFrameOn(c2d, name, px, py, scale) {
    const f = manifest.frames[name];
    if (!f) return;
    c2d.drawImage(atlas, f.x, f.y, f.w, f.h, px, py - (f.h - 16) * scale, f.w * scale, f.h * scale);
  }

  function animFrameName(animName, frameIdx) {
    const a = manifest.anims[animName];
    if (!a) return null;
    return a.loop ? a.frames[frameIdx % a.frames.length]
                  : a.frames[Math.min(frameIdx, a.frames.length - 1)];
  }

  function pixelTextOn(c2d, txt, x, y, color, scale) {
    c2d.textAlign = 'left'; c2d.textBaseline = 'alphabetic';
    c2d.font = `${7 * scale}px monospace`;
    c2d.fillStyle = color;
    c2d.fillText(txt, x, y);
  }

  // Boîte d'une étiquette (texte + padding) — mesurée à part de son dessin
  // pour permettre à la passe anti-collision de tester une position AVANT de
  // décider si elle sera effectivement dessinée. Réutilisée aussi par les
  // badges de zone (v4) : même style pixel, même formule de mesure.
  function measureLabelBox(c2d, txt, scale) {
    c2d.font = `${7 * scale}px monospace`;
    const textW = c2d.measureText(txt).width;
    const padX = 2 * scale, padY = 1 * scale;
    return { w: textW + padX * 2, h: 7 * scale + padY * 2, padY };
  }

  // Étiquette pixel centrée sous le perso, fond sombre semi-transparent pour
  // rester lisible sur n'importe quel décor (sol clair, voile sombre, …).
  // `box` (optionnel) réutilise une mesure déjà calculée par la passe
  // anti-collision — évite un 2e `measureText` pour le même texte.
  function labelTextOn(c2d, txt, cx, topY, scale, box) {
    const b = box || measureLabelBox(c2d, txt, scale);
    c2d.fillStyle = 'rgba(10, 10, 16, 0.55)';
    c2d.fillRect(cx - b.w / 2, topY - b.padY, b.w, b.h);
    c2d.fillStyle = '#cfd2da';
    c2d.font = `${7 * scale}px monospace`;
    c2d.textAlign = 'center';
    c2d.textBaseline = 'top';
    c2d.fillText(txt, cx, topY);
    c2d.textAlign = 'left'; c2d.textBaseline = 'alphabetic';
  }

  // Badge « +N » d'une zone (v4, remplace le footer-par-salle de v3) : posé
  // dans la bande mur (row 0), toujours libre de tout mobilier/acteur (cf.
  // buildShell) — donc aucun risque de collision avec le reste du rendu, pas
  // besoin de le faire participer à la passe anti-collision des étiquettes.
  //
  // Fix reviewer final (quick-win, badges superposés) : lounge/agents
  // partagent la même boîte en x (tx:0, cols:6) et dr/headless idem (tx:10,
  // cols:6, cf. office-layout.js zones) — centrer sur `box.cols/2` pour les
  // deux zones d'un même côté produit DEUX badges dessinés au même endroit
  // quand les deux débordent en même temps (lounge+agents, ou dr+headless).
  // `side` ('left'|'right') décale le centre au quart gauche/droit de la
  // boîte : les deux zones d'un côté restent chacune lisibles, sans jamais
  // sortir de leur propre boîte (cf. `BADGE_SIDE` plus bas, appariement
  // quadrant haut=left / quadrant bas=right).
  function drawOverflowBadge(c2d, box, total, scale, side) {
    const txt = `+${total}`;
    const frac = side === 'right' ? 3 / 4 : side === 'left' ? 1 / 4 : 1 / 2;
    const cx = (box.tx + box.cols * frac) * 16 * scale;
    const b = measureLabelBox(c2d, txt, scale);
    const rectTop = Math.max(0, (16 * scale - b.h) / 2);
    const topY = rectTop + b.padY;
    c2d.fillStyle = '#f59e0b';
    c2d.fillRect(cx - b.w / 2, rectTop, b.w, b.h);
    c2d.fillStyle = '#1a1a22';
    c2d.font = `${7 * scale}px monospace`;
    c2d.textAlign = 'center'; c2d.textBaseline = 'top';
    c2d.fillText(txt, cx, topY);
    c2d.textAlign = 'left'; c2d.textBaseline = 'alphabetic';
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function sessionFor(sessionId) {
    return sessions.get(sessionId) || lastKnown.get(sessionId);
  }

  // ─── Rendu de LA salle (v4 : un seul canvas, plus de roomKey) ───
  function drawRoom(canvas, room) {
    const card = canvas.parentElement;
    const cardW = card ? card.clientWidth : canvas.clientWidth;
    const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.floor(cardW / (room.cols * 16)) || SCALE_MIN));
    const w = room.cols * 16 * scale, h = room.rows * 16 * scale;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c2d = canvas.getContext('2d');
    c2d.imageSmoothingEnabled = false;
    c2d.clearRect(0, 0, w, h);

    const actors = OfficeLayout.actorsAll(state);

    // Tuile occupée → acteur (immobile). Sert au LED de poste (travail) ET à
    // l'overlay fauteuil conditionnel — PAR TUILE (plusieurs postes cohabitent
    // dans la même salle, transposé v2→v3, inchangé v3→v4).
    const seatedAt = new Map();
    for (const a of actors) if (a.path.length === 0) seatedAt.set(`${a.tx},${a.ty}`, a);

    // z:'over' visible seulement si occupé — v4 : DEUX noms de frame portent
    // ce contrat (`chairOrange` postes agents, `chairBlack` postes headless),
    // remplacent `chairOver` seul de v3 (cf. rapport Task 2, layout v4).
    function overVisible(st) {
      if (st.frame !== 'chairOrange' && st.frame !== 'chairBlack') return true;
      return seatedAt.has(`${st.tx},${st.ty}`);
    }

    function drawStatic(st) {
      const px = st.tx * 16 * scale, py = (st.ty * 16 + (st.dy || 0)) * scale;
      if (st.frame === 'door') { c2d.fillStyle = '#1a1a22'; c2d.fillRect(px, py, 16 * scale, 16 * scale); return; }
      drawFrameOn(c2d, st.frame, px, py, scale);
      // LED d'état sur la console d'un poste occupé — `stationConsole` est le
      // SEUL static à porter cette info (postes agents ET headless, cf.
      // office-layout.js buildAgents/buildHeadless : le fauteuil est TOUJOURS
      // à `(tx, ty+1)` de sa console). Éteinte si le poste est vide, ou si le
      // perso qui l'occupe est en train de migrer/marcher (jamais assis).
      if (st.frame === 'stationConsole') {
        const occ = seatedAt.get(`${st.tx},${st.ty + 1}`);
        if (occ && (occ.kind === 'session' || occ.kind === 'headless')) {
          const occSession = sessionFor(occ.sessionId);
          const stateName = occSession && occSession.state && occSession.state.name;
          const color = STATE_COLORS[stateName];
          if (color && stateName !== 'waiting') {
            c2d.fillStyle = color;
            c2d.globalAlpha = (stateName === 'running' && (tickCount & 4)) ? 0.4 : 0.9;
            // -6 : calée sur le sprite 130 (16×14) remonté de 8 px par le
            // layout (dy:-8, cf. buildAgents) — bord haut de l'écran à
            // ty·16-6, la LED se pose sur le cadre au lieu de flotter.
            c2d.fillRect((st.tx * 16 + 5) * scale, (st.ty * 16 - 6) * scale, 6 * scale, 4 * scale);
            c2d.globalAlpha = 1;
          }
        }
      }
    }

    // Passe 1 : statics normaux (sol, meubles, bureaux…), sous les acteurs —
    // plus les fauteuils `chairOrange`/`chairBlack` inoccupés (dossier
    // visible, personne à protéger visuellement).
    for (const st of room.statics) {
      if (st.z !== 'over' || !overVisible(st)) drawStatic(st);
    }

    // Acteurs : sprite + collecte étiquette/bulle/hit-rect. Les bulles sont
    // calculées ici mais DESSINÉES en dernier, pour rester nettes par-dessus
    // le décor et les étiquettes.
    const rects = [];
    const labels = [];
    const bubbles = [];
    // Obstacles « sensibles » de la passe étiquettes (fix 2026-07-21, retour
    // Paul : une étiquette décalée par l'anti-collision atterrissait sur
    // l'écran du poste) : écrans/setups des postes + acteurs installés à un
    // poste. Une étiquette qui les chevauche tente ses décalages comme face
    // à une autre étiquette, sinon n'est pas dessinée (tooltip = filet).
    // PAS les fauteuils (l'étiquette d'un assis frôle 1 px le bas du sien —
    // l'inclure décalerait systématiquement toutes les étiquettes de postes)
    // ni les persos du lounge (leurs étiquettes se gênent déjà entre elles ;
    // les bloquer mutuellement n'en laisserait dessiner presque aucune).
    const labelObstacles = [];
    for (const st of room.statics) {
      if (st.frame !== 'stationConsole' && st.frame !== 'sideDesk90' && st.frame !== 'sideSetup90') continue;
      const f = manifest.frames[st.frame];
      if (!f) continue;
      const opx = st.tx * 16 * scale, opy = (st.ty * 16 + (st.dy || 0)) * scale - (f.h - 16) * scale;
      labelObstacles.push({ x: opx, y: opy, w: f.w * scale, h: f.h * scale });
    }
    for (const a of actors) {
      const fi = a.activity === 'think' ? (a.animFrame >> 2) : a.animFrame;
      const fname = animFrameName(OfficeLayout.animFor(a), fi);
      // Composition « au demi-tile » façon LimeZu (réf du site, conservée
      // v2→v4) : un perso ASSIS (à son poste, `work`/`think`) est remonté
      // dans son bureau. Debout, en marche, ou en relax (lounge) : alignement
      // plein-tuile normal.
      const seated = a.path.length === 0 && (a.activity === 'work' || a.activity === 'think');
      const px = a.tx * 16 * scale, py = (a.ty * 16 + (seated ? -5 : 0)) * scale;
      if (fname) drawFrameOn(c2d, fname, px, py, scale);

      rects.push({ aid: a.id, sessionId: a.sessionId, kind: a.kind, x: px, y: py - 16 * scale, w: 16 * scale, h: 32 * scale });

      // Acteur installé à un poste (immobile, hors lounge/départ) → obstacle
      // pour les étiquettes (cf. labelObstacles) : son sprite ne doit jamais
      // être enseveli. Même rect que le dessin (16×32 ancré bas).
      if (a.path.length === 0 && a.activity !== 'relax' && a.activity !== 'leave') {
        labelObstacles.push({ x: px, y: py - 16 * scale, w: 16 * scale, h: 32 * scale });
      }

      const parentSession = sessionFor(a.sessionId);
      const label = OfficeLayout.labelFor(a, parentSession);
      if (label) labels.push({ text: label, tx: a.tx, ty: a.ty });

      if (a.kind === 'session' && parentSession) {
        const emote = OfficeLayout.emoteFor(parentSession, activeBells.has(a.sessionId));
        if (emote) {
          // Clamp vertical : un acteur en row 1 (sièges canapé du lounge) a
          // sa bulle à py-34·scale < 0 — entièrement hors canvas, donc émote
          // jamais visible (constaté au CDP 2026-07-21). Clampée à 0, elle
          // glisse sur la bande mur (row 0), libre de tout mobilier/acteur —
          // même convention que les badges « +N ».
          const eFrame = animFrameName(emote, tickCount >> 2);
          if (eFrame) bubbles.push({ frame: eFrame, px, by: Math.max(0, py - 34 * scale) });
        }
      }
    }
    hitRects = rects;

    // Passe 2 : statics `z:'over'` occupés (fauteuil vu de dos) — PAR-DESSUS
    // l'acteur assis, pour que le dossier s'intercale entre lui (dos au
    // spectateur) et la caméra.
    for (const st of room.statics) {
      if (st.z === 'over' && overVisible(st)) drawStatic(st);
    }

    // Étiquettes : anti-collision (bulles prioritaires — transposé v3, cf.
    // fe42a79). Clamp vertical : un acteur dans la toute dernière rangée de
    // la salle verrait son étiquette dessinée sous le bord bas du canvas —
    // donc hors zone visible, silencieusement clippée. Ordre stable (ty puis
    // tx), chaque étiquette teste sa position par défaut PUIS jusqu'à 2
    // décalages vers le bas contre les étiquettes déjà POSÉES et les bulles ;
    // si les 3 positions chevauchent toujours, elle n'est PAS dessinée — le
    // tooltip au survol reste le filet de sécurité pour l'identifier.
    const labelBoxH = 9 * scale; // 7*scale texte + 2*(1*scale) padding, cf. measureLabelBox
    // Rect d'une bulle : `drawFrameOn` la dessine 16×16 (natif, pas de scale
    // d'atlas — cf. bake-smoke) ancrée à (b.px, b.by) — `by` déjà clampé au
    // moment de la collecte, une seule formule partagée avec le dessin.
    const bubbleRects = bubbles.map(b => ({ x: b.px, y: b.by, w: 16 * scale, h: 16 * scale }));
    const sortedLabels = [...labels].sort((a, b) => (a.ty - b.ty) || (a.tx - b.tx));
    const placedLabelRects = [...bubbleRects, ...labelObstacles];
    for (const l of sortedLabels) {
      const box = measureLabelBox(c2d, l.text, scale);
      // Clamp horizontal (pendant du clamp vertical ci-dessous) : centrée sur
      // un acteur à tx 0 ou cols-1, la boîte déborde du canvas et le texte est
      // tronqué (« stleGe », constaté au CDP 2026-07-21) — ramenée entière
      // dans la salle, au prix d'un centrage décalé d'une demi-boîte max.
      const cx = Math.max(box.w / 2, Math.min((l.tx * 16 + 8) * scale, w - box.w / 2));
      let topY = Math.min((l.ty * 16 + 17) * scale, h - labelBoxH);
      for (let attempt = 0; attempt < 3; attempt++) {
        const rect = { x: cx - box.w / 2, y: topY - box.padY, w: box.w, h: box.h };
        if (!placedLabelRects.some(r => rectsOverlap(r, rect))) {
          labelTextOn(c2d, l.text, cx, topY, scale, box);
          placedLabelRects.push(rect);
          break;
        }
        topY = Math.min(topY + labelBoxH + 1, h - labelBoxH);
      }
    }

    // Bulles émotes : dessinées en tout dernier (étiquettes déjà posées),
    // ancrées au-dessus de la tête (perso 16×32 ancré bas de tuile).
    for (const b of bubbles) drawFrameOn(c2d, b.frame, b.px, b.by, scale);

    // Badges « +N » par zone (v4) : bande mur (row 0), toujours libre —
    // dessinés en tout dernier, ne participent à aucune passe de collision.
    // `BADGE_SIDE` décale lounge/dr (quadrants du HAUT) à gauche et agents/
    // headless (quadrants du BAS) à droite de leur boîte — évite la
    // superposition quand les deux zones d'un même côté débordent ensemble
    // (même boîte en x, cf. commentaire de `drawOverflowBadge`).
    for (const key of Object.keys(room.zones)) {
      const zone = room.zones[key];
      if (zone.overflow && zone.overflow.total > 0) drawOverflowBadge(c2d, zone.box, zone.overflow.total, scale, BADGE_SIDE[key]);
    }
  }

  // ─── DOM : une seule carte/canvas, construite une seule fois ───
  function container() { return document.getElementById('officeView'); }

  function ensureDOM() {
    const cont = container();
    if (!cont || cont.dataset.built) return;
    cont.dataset.built = '1';
    cont.innerHTML = `
      <div class="office-room-card" data-room="office">
        <canvas class="office-room-canvas" data-canvas="office"></canvas>
        <div class="office-room-footer">
          <span class="office-room-name" data-i18n="office_title">${t('office_title')}</span>
          <span class="office-room-meta"><span class="office-room-count" data-count></span></span>
        </div>
      </div>
    `;
    canvasEl = cont.querySelector('canvas[data-canvas]');
    wireInteractions(canvasEl);
    tooltip = document.getElementById('officeTooltip');
  }

  // Footer unique (v4, remplace le footer-par-salle v3) : nom fixe + un seul
  // compteur global ("Office · N session(s)") — pas de data-i18n sur le
  // compteur (texte procédural, {n} résolu ici) pour ne pas être écrasé par
  // le balayage global [data-i18n] d'un changement de langue (cf. renderer.js
  // applyI18n) ; il s'auto-corrige de toute façon au prochain tick (125 ms).
  function updateFooter(card, snap) {
    const countEl = card.querySelector('[data-count]');
    if (countEl) countEl.textContent = t('office_count', { n: snap.interactive.length + snap.background.length });
  }

  function drawAll() {
    const cont = container();
    if (!cont || !canvasEl) return;
    const snap = snapshotSessions();
    const room = OfficeLayout.roomFor(snap, state);
    const card = cont.querySelector('.office-room-card');
    if (card) updateFooter(card, snap);
    drawRoom(canvasEl, room);
  }

  // ─── Sync + boucle ───
  function snapshotSessions() {
    // `bellActive` est annoté sur une COPIE (ne pas muter les objets partagés
    // avec renderer.js) : le layout en a besoin pour garder au poste un
    // waiting dont la cloche needs-you est active (retour Paul 2026-07-19).
    const interactive = [], background = [];
    for (const s of sessions.values()) {
      const copy = { ...s, bellActive: activeBells.has(s.sessionId) };
      (s.isBackground ? background : interactive).push(copy);
    }
    return { interactive, background };
  }

  // I1 (revue reviewer v3) : `lastKnown` ne se vidait que via le chemin
  // `done` de tick() — qui ne concerne QUE les acteurs `kind:'session'`
  // (seuls à avoir un `done`, cf. tickActor). Un acteur `headless` disparaît,
  // lui, IMMÉDIATEMENT et SYNCHRONEMENT dans syncActors (pas de marche, pas
  // de `done`) : sa session ne passait donc jamais par le nettoyage de
  // tick(), et chaque session background qui a existé un jour laissait sa
  // donnée complète dans `lastKnown` POUR TOUJOURS (fuite mémoire non bornée
  // sur la durée de vie de l'app). Idem pour tout futur type d'acteur qui
  // disparaîtrait sans jamais passer par `done`.
  //
  // Fix générique (inchangé v3→v4) : un balayage dédié, appelé après CHAQUE
  // sync (donc after syncActors dans syncAll — couvre le cas headless/
  // synchrone — ET après le nettoyage des `done` dans tick() — couvre le cas
  // session/asynchrone). Une entrée `lastKnown` ne survit que si sa session
  // est encore vivante OU si un acteur (n'importe quel kind) référence encore
  // ce sessionId.
  function pruneLastKnown() {
    if (lastKnown.size === 0) return;
    const referenced = new Set();
    if (state) for (const a of state.actors.values()) referenced.add(a.sessionId);
    for (const id of lastKnown.keys()) {
      if (sessions.has(id) || referenced.has(id)) continue;
      lastKnown.delete(id);
    }
  }

  function syncAll() {
    if (!state) state = OfficeLayout.createState();
    const snap = snapshotSessions();
    for (const s of snap.interactive) lastKnown.set(s.sessionId, s);
    for (const s of snap.background) lastKnown.set(s.sessionId, s);
    OfficeLayout.syncActors(state, snap);
    pruneLastKnown();
  }

  function tick() {
    tickCount++;
    const doneAids = [];
    for (const a of state.actors.values()) {
      a.animFrame++;
      OfficeLayout.tickActor(a, state);
      // Contrat office-layout.js (M5) : les acteurs `done` sont supprimés
      // par l'APPELANT — c'est ici (tickActor vient de les marquer `done`
      // au moment même où ils atteignent physiquement la porte de sortie).
      if (a.done) doneAids.push(a);
    }
    for (const a of doneAids) state.actors.delete(a.id);
    pruneLastKnown();
    // Dernière session partie ET dernier acteur sorti : bascule vers l'état
    // vide réel (render() affichera emptyState au lieu de la salle) — pas de
    // fantôme figé à la porte, timer coupé par le render() qui suit (vue
    // quittée par retombée à 0 session).
    if (sessions.size === 0 && state.actors.size === 0) { render(); return; }
    drawAll();
  }

  // ─── Hit-test CSS→natif (par ACTEUR, pas par carte) ───
  function toCanvasXY(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: -1, y: -1 };
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function hitTest(x, y) {
    for (let i = hitRects.length - 1; i >= 0; i--) {
      const r = hitRects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }

  function wireInteractions(canvas) {
    canvas.addEventListener('click', (ev) => {
      const { x, y } = toCanvasXY(canvas, ev.clientX, ev.clientY);
      const hit = hitTest(x, y);
      // Clic = uniquement sur un PERSO (hit-test par acteur). Headless =
      // aucun focus (pas de terminal à ouvrir) — subagent/workflow focalisent
      // leur session PARENTE (hit.sessionId y pointe déjà, cf. office-layout.js).
      if (!hit || hit.kind === 'headless') return;
      handleFocus(hit.sessionId);
    });
    canvas.addEventListener('mousemove', (ev) => {
      const { x, y } = toCanvasXY(canvas, ev.clientX, ev.clientY);
      const hit = hitTest(x, y);
      // Curseur pointer uniquement sur un perso cliquable — headless (aucun
      // terminal, cf. le handler click ci-dessus) reste en curseur par défaut.
      canvas.style.cursor = (hit && hit.kind !== 'headless') ? 'pointer' : 'default';
      if (!hit) { if (tooltip) tooltip.style.display = 'none'; return; }
      showTooltip(hit, ev.clientX, ev.clientY);
    });
    canvas.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display = 'none'; });
  }

  function showTooltip(hit, clientX, clientY) {
    if (!tooltip) return;
    const s = sessionFor(hit.sessionId);
    if (!s) { tooltip.style.display = 'none'; return; }
    tooltip.innerHTML = `
      <div class="office-tip-name">${esc(s.customName || s.projectName)}</div>
      <div class="office-tip-row">${esc(getStateLabel(s))} · ${esc(s.gitBranch || '—')}</div>
      <div class="office-tip-row">${esc(formatModel(s.model))} · ${formatDuration(s.startedAt)}</div>`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(clientX + 12, window.innerWidth - 220)}px`;
    tooltip.style.top = `${Math.min(clientY + 12, window.innerHeight - 80)}px`;
  }

  // ─── Hooks appelés par renderer.js ───
  // render() (viewMode office) : construit le container (idempotent), sync +
  // redraw immédiat (pas de canvas blanc pendant 125 ms), garantit le timer.
  // Renommé `renderRooms` → `renderRoom` (v4, UNE salle) — appelant à jour
  // dans renderer.js.
  function renderRoom() {
    if (available !== true) return;
    ensureDOM();
    syncAll();
    drawAll();
    if (!timer) timer = setInterval(tick, TICK_MS);
  }

  // updateSession/removeSessionFromDOM (viewMode office) : sync + redraw
  // léger, le container est déjà construit par renderRoom().
  function notifyUpdate() {
    if (!state) return;
    syncAll();
    drawAll();
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
    if (tooltip) tooltip.style.display = 'none';
  }

  return { probe, renderRoom, notifyUpdate, deactivate, isAvailable: () => available === true };
})();
