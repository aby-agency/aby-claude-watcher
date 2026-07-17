// ui/office.js — moteur de rendu de la vue office v3 : 3 SALLES FIXES
// (Travail/Pause/Recherche), un canvas par salle, UN SEUL timer 8 fps.
// Chargé APRÈS office-layout.js, AVANT renderer.js (les globals de renderer
// — sessions, activeBells, handleFocus, esc, t, … — ne sont touchés qu'à
// l'exécution, jamais au chargement du module). Vue inactive = timer stoppé.
//
// v2 → v3 : le container #officeView n'est plus un flux de cartes-par-
// session (une pièce par session) mais possède 3 containers FIXES construits
// une fois (ensureDOM). Chaque salle peut héberger PLUSIEURS acteurs
// 'session' (postes multiples) — tout ce qui était "l'unique acteur
// principal de la pièce" en v2 (bulle émote, LED d'état, fauteuil overlay
// conditionnel) devient une opération PAR ACTEUR / PAR TUILE, généralisée via
// `seatedAt` (tuile occupée → acteur). Voir docs/superpowers/specs/
// 2026-07-17-office-salles-design.md (fait foi) et le plan associé, Task 2.
const Office = (() => {
  const TICK_MS = 125;
  const SCALE_MIN = 1, SCALE_MAX = 4;
  const STATE_COLORS = { thinking: '#a78bfa', running: '#3b82f6', waiting: '#22c55e', pending: '#f59e0b', error: '#ef4444' };
  const ROOM_LABEL_KEY = { work: 'room_work', break: 'room_break', research: 'room_research' };

  let atlas = null, manifest = null;
  let available = null;
  let probePromise = null;
  let state = null;          // OfficeLayout.createState()
  let timer = null;
  let tickCount = 0;
  let tooltip = null;
  // Dernière donnée connue d'une session, gardée le temps de la marche de
  // sortie (session déjà supprimée de `sessions` mais l'acteur marche encore
  // vers la porte, ou sert de source pour le tooltip/LED d'un acteur
  // recherche dont la session parente vient de disparaître).
  const lastKnown = new Map();
  // Rects de hit-test (CSS→natif) par canvas, recalculés à chaque drawRoom.
  const canvasRects = new WeakMap();

  function probe() {
    if (available !== null) return Promise.resolve(available);
    if (probePromise) return probePromise;
    probePromise = (async () => {
      try {
        const res = await fetch('office-assets/atlas.json');
        if (!res.ok) throw new Error(res.status);
        manifest = await res.json();
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

  // ─── Frames/anims (inchangé v2) ───
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
  // pour permettre à la passe anti-collision (I2) de tester une position
  // AVANT de décider si elle sera effectivement dessinée.
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

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function sessionFor(sessionId) {
    return sessions.get(sessionId) || lastKnown.get(sessionId);
  }

  // ─── Rendu d'une salle dans son canvas ───
  function drawRoom(canvas, room) {
    const roomKey = room.key;
    const card = canvas.parentElement;
    const cardW = card ? card.clientWidth : canvas.clientWidth;
    const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.floor(cardW / (room.cols * 16)) || SCALE_MIN));
    const w = room.cols * 16 * scale, h = room.rows * 16 * scale;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c2d = canvas.getContext('2d');
    c2d.imageSmoothingEnabled = false;
    c2d.clearRect(0, 0, w, h);

    const roomActors = OfficeLayout.actorsIn(state, roomKey);

    // Tuile occupée → acteur (immobile). Sert au LED de poste (travail) ET à
    // l'overlay fauteuil conditionnel — généralisé PAR TUILE (v2 n'avait
    // qu'un unique "acteur principal" par pièce ; plusieurs postes cohabitent
    // maintenant dans la même salle).
    const seatedAt = new Map();
    for (const a of roomActors) if (a.path.length === 0) seatedAt.set(`${a.tx},${a.ty}`, a);

    // z:'over' visible seulement si occupé — ne concerne QUE `chairOver`
    // (seul static `z:'over'` produit par office-layout.js, salle travail) ;
    // tout futur static `z:'over'` sans logique d'occupation dédiée reste
    // toujours dessiné par-dessus, comme en v2.
    function overVisible(st) {
      if (st.frame !== 'chairOver') return true;
      return seatedAt.has(`${st.tx},${st.ty}`);
    }

    function drawStatic(st) {
      const px = st.tx * 16 * scale, py = (st.ty * 16 + (st.dy || 0)) * scale;
      if (st.frame === 'coffeeMachine') {
        drawFrameOn(c2d, animFrameName('coffee', tickCount >> 1), px, py, scale);
        return;
      }
      if (st.frame === 'door') { c2d.fillStyle = '#1a1a22'; c2d.fillRect(px, py, 16 * scale, 16 * scale); return; }
      drawFrameOn(c2d, st.frame, px, py, scale);
      // LED d'état sur le moniteur secondaire du poste (salle travail
      // uniquement — seule salle où `deskSetup` apparaît) : ancrée sur le
      // bureau (colonne gauche du setup, cf. commentaire office-layout.js sur
      // la géométrie desk/char) ; reflète l'état de LA SESSION assise à CE
      // poste précis (pas l'ancien "état de la pièce" v2, une salle héberge
      // maintenant plusieurs postes). Éteinte si personne n'y est
      // physiquement assis (poste vide, ou perso en train de migrer/marcher).
      if (st.frame === 'deskSetup') {
        const seatTx = st.tx === 0 ? 1 : 5;
        const occ = seatedAt.get(`${seatTx},${st.ty + 1}`);
        if (occ && occ.kind === 'session') {
          const occSession = sessionFor(occ.sessionId);
          const stateName = occSession && occSession.state && occSession.state.name;
          const color = STATE_COLORS[stateName];
          if (color && stateName !== 'waiting') {
            c2d.fillStyle = color;
            c2d.globalAlpha = (stateName === 'running' && (tickCount & 4)) ? 0.4 : 0.9;
            c2d.fillRect((st.tx * 16 + 5) * scale, (st.ty * 16 - 8) * scale, 6 * scale, 4 * scale);
            c2d.globalAlpha = 1;
          }
        }
      }
    }

    // Passe 1 : statics normaux (sol, meubles, bureaux…), sous les acteurs —
    // plus les fauteuils `chairOver` inoccupés (dossier visible, personne à
    // protéger visuellement).
    for (const st of room.statics) {
      if (st.z !== 'over' || !overVisible(st)) drawStatic(st);
    }

    // Acteurs : sprite + collecte étiquette/bulle/hit-rect. Les bulles sont
    // calculées ici mais DESSINÉES en dernier (après le voile sombre local de
    // la salle recherche, pour rester nettes) — un acteur `session` par
    // salle peut désormais en avoir une CHACUN (v2 n'en traçait qu'une par
    // pièce, un seul acteur principal possible).
    const rects = [];
    const labels = [];
    const bubbles = [];
    for (const a of roomActors) {
      const fi = a.activity === 'think' ? (a.animFrame >> 2) : a.animFrame;
      const fname = animFrameName(OfficeLayout.animFor(a), fi);
      // Composition « au demi-tile » façon LimeZu (réf du site, conservée
      // v2→v3) : un perso ASSIS (à son poste/table, `work`/`think`) est
      // remonté dans son bureau. Debout, en marche, ou en relax (pause) :
      // alignement plein-tuile normal.
      const seated = a.path.length === 0 && (a.activity === 'work' || a.activity === 'think');
      const px = a.tx * 16 * scale, py = (a.ty * 16 + (seated ? -5 : 0)) * scale;
      if (fname) drawFrameOn(c2d, fname, px, py, scale);

      rects.push({ aid: a.id, sessionId: a.sessionId, kind: a.kind, x: px, y: py - 16 * scale, w: 16 * scale, h: 32 * scale });

      const parentSession = sessionFor(a.sessionId);
      const label = OfficeLayout.labelFor(a, parentSession);
      if (label) labels.push({ text: label, tx: a.tx, ty: a.ty });

      if (a.kind === 'session' && parentSession) {
        const emote = OfficeLayout.emoteFor(parentSession, activeBells.has(a.sessionId));
        if (emote) {
          const eFrame = animFrameName(emote, tickCount >> 2);
          if (eFrame) bubbles.push({ frame: eFrame, px, py });
        }
      }
    }
    canvasRects.set(canvas, rects);

    // Passe 2 : statics `z:'over'` occupés (fauteuil vu de dos) — PAR-DESSUS
    // l'acteur assis, pour que le dossier s'intercale entre lui (dos au
    // spectateur) et la caméra.
    for (const st of room.statics) {
      if (st.z === 'over' && overVisible(st)) drawStatic(st);
    }

    // Voile sombre LOCAL (salle recherche uniquement) : seul assombrissement
    // v3 (remplace le voile plein-canvas des cartes background v2) — couvre
    // juste la zone headless exposée par la salle (`darkZone`).
    if (room.darkZone) {
      c2d.fillStyle = '#000';
      c2d.globalAlpha = 0.35;
      c2d.fillRect(room.darkZone.tx * 16 * scale, room.darkZone.ty * 16 * scale,
                   room.darkZone.cols * 16 * scale, room.darkZone.rows * 16 * scale);
      c2d.globalAlpha = 1;
    }

    // Étiquettes : après le voile, pour rester lisibles même dans le coin
    // headless assombri.
    // Clamp vertical : un acteur dans la TOUTE DERNIÈRE rangée de la salle
    // (ex. bloc étendu de la salle pause, dont le dernier siège tombe pile
    // sur `rows-1`) verrait son étiquette dessinée sous le bord bas du
    // canvas — donc hors zone visible, silencieusement clippée (aucune
    // erreur, juste invisible). Constaté en vérif CDP (migration vers un
    // siège de bloc étendu). Fix : ne jamais dépasser le bas du canvas.
    //
    // Anti-collision (I2, revue reviewer) : la salle pause n'espace ses
    // sièges que d'1 tuile — deux étiquettes 8-car. voisines (largeur très
    // supérieure à une tuile) se chevauchent quasi systématiquement à cette
    // densité (constaté sur le screenshot de migration, pas un cas rare
    // "recherche dense" comme initialement classé). Passe dédiée : ordre
    // stable (ty puis tx), chaque étiquette teste sa position par défaut PUIS
    // jusqu'à 2 décalages vers le bas (hauteur+1px, clamp bas-de-canvas
    // toujours appliqué) contre les étiquettes déjà POSÉES ; si les 3
    // positions chevauchent toujours, elle n'est PAS dessinée — le tooltip
    // au survol reste le filet de sécurité pour l'identifier.
    const labelBoxH = 9 * scale; // 7*scale texte + 2*(1*scale) padding, cf. measureLabelBox
    const sortedLabels = [...labels].sort((a, b) => (a.ty - b.ty) || (a.tx - b.tx));
    const placedLabelRects = [];
    for (const l of sortedLabels) {
      const cx = (l.tx * 16 + 8) * scale;
      const box = measureLabelBox(c2d, l.text, scale);
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

    // Bulles émotes : dessinées en tout dernier (voile + étiquettes déjà
    // posés), ancrées au-dessus de la tête (perso 16×32 ancré bas de tuile).
    for (const b of bubbles) drawFrameOn(c2d, b.frame, b.px, b.py - 34 * scale, scale);
  }

  // ─── DOM : 3 salles fixes, construites une seule fois ───
  function container() { return document.getElementById('officeView'); }

  function ensureDOM() {
    const cont = container();
    if (!cont || cont.dataset.built) return;
    cont.dataset.built = '1';
    cont.innerHTML = OfficeLayout.ROOM_KEYS.map(key => `
      <div class="office-room-card" data-room="${key}">
        <canvas class="office-room-canvas" data-canvas="${key}"></canvas>
        <div class="office-room-footer">
          <span class="office-room-name">${t(ROOM_LABEL_KEY[key])}</span>
          <span class="office-room-meta">
            <span class="office-room-count" data-count></span>
            <span class="office-room-overflow" data-overflow style="display:none;"></span>
          </span>
        </div>
      </div>
    `).join('');
    wireInteractions(cont);
    tooltip = document.getElementById('officeTooltip');
  }

  function updateFooter(card, room) {
    const countEl = card.querySelector('[data-count]');
    if (countEl) countEl.textContent = room.counter;
    const overflowEl = card.querySelector('[data-overflow]');
    if (overflowEl) {
      const total = room.overflow && room.overflow.total;
      overflowEl.style.display = total > 0 ? '' : 'none';
      if (total > 0) overflowEl.textContent = `+${total}`;
    }
  }

  function drawAll() {
    const cont = container();
    if (!cont) return;
    const rooms = OfficeLayout.roomsFor(snapshotSessions(), state);
    for (const room of rooms) {
      const card = cont.querySelector(`.office-room-card[data-room="${room.key}"]`);
      if (!card) continue;
      updateFooter(card, room);
      const canvas = card.querySelector('canvas');
      if (canvas) drawRoom(canvas, room);
    }
  }

  // ─── Sync + boucle ───
  function snapshotSessions() {
    const interactive = [], background = [];
    for (const s of sessions.values()) (s.isBackground ? background : interactive).push(s);
    return { interactive, background };
  }

  // I1 (revue reviewer) : `lastKnown` ne se vidait que via le chemin `done`
  // de tick() — qui ne concerne QUE les acteurs `kind:'session'` (seuls à
  // avoir un `done`, cf. tickActor). Un acteur `headless` disparaît, lui,
  // IMMÉDIATEMENT et SYNCHRONEMENT dans syncActors (pas de marche, pas de
  // `done`) : sa session ne passait donc jamais par le nettoyage de tick(),
  // et chaque session background qui a existé un jour laissait sa donnée
  // complète dans `lastKnown` POUR TOUJOURS (fuite mémoire non bornée sur la
  // durée de vie de l'app). Idem pour tout futur type d'acteur qui
  // disparaîtrait sans jamais passer par `done`.
  //
  // Fix générique : un balayage dédié, appelé après CHAQUE sync (donc after
  // syncActors dans syncAll — couvre le cas headless/synchrone — ET après
  // le nettoyage des `done` dans tick() — couvre le cas session/asynchrone).
  // Une entrée `lastKnown` ne survit que si sa session est encore vivante
  // OU si un acteur (n'importe quel kind) référence encore ce sessionId
  // (ex. l'acteur session en train de marcher vers la sortie, ou un
  // subagent/meeting dont la session parente vient de disparaître mais dont
  // l'acteur research n'a pas encore été nettoyé ce tick).
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
    // vide réel (render() affichera emptyState au lieu des 3 salles) — pas de
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

  function hitTest(canvas, x, y) {
    const rects = canvasRects.get(canvas);
    if (!rects) return null;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }

  function wireInteractions(cont) {
    cont.addEventListener('click', (ev) => {
      const canvas = ev.target.closest && ev.target.closest('canvas[data-canvas]');
      if (!canvas) return;
      const { x, y } = toCanvasXY(canvas, ev.clientX, ev.clientY);
      const hit = hitTest(canvas, x, y);
      // Clic = uniquement sur un PERSO (hit-test par acteur). Headless =
      // aucun focus (pas de terminal à ouvrir) — subagent/meeting focalisent
      // leur session PARENTE (hit.sessionId y pointe déjà, cf. office-layout.js).
      if (!hit || hit.kind === 'headless') return;
      handleFocus(hit.sessionId);
    });
    cont.addEventListener('mousemove', (ev) => {
      const canvas = ev.target.closest && ev.target.closest('canvas[data-canvas]');
      if (!canvas) { if (tooltip) tooltip.style.display = 'none'; return; }
      const { x, y } = toCanvasXY(canvas, ev.clientX, ev.clientY);
      const hit = hitTest(canvas, x, y);
      if (!hit) { if (tooltip) tooltip.style.display = 'none'; return; }
      showTooltip(hit, ev.clientX, ev.clientY);
    });
    cont.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display = 'none'; });
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
  function renderRooms() {
    if (available !== true) return;
    ensureDOM();
    syncAll();
    drawAll();
    if (!timer) timer = setInterval(tick, TICK_MS);
  }

  // updateSession/removeSessionFromDOM (viewMode office) : sync + redraw
  // léger, le container est déjà construit par renderRooms().
  function notifyUpdate() {
    if (!state) return;
    syncAll();
    drawAll();
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
    if (tooltip) tooltip.style.display = 'none';
  }

  return { probe, renderRooms, notifyUpdate, deactivate, isAvailable: () => available === true };
})();
