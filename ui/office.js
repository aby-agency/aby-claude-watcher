// ui/office.js — moteur de rendu de la vue office. Chargé APRÈS office-layout.js,
// AVANT renderer.js (partage son scope global : sessions, handleFocus, t, …).
// Boucle : tick anim 8 fps (setInterval 125 ms) quand la vue est active — chaque
// tick actif redessine (les anims tournent en continu) ; l'économie CPU vient de
// la boucle entièrement stoppée quand la vue est inactive (deactivate()).
const Office = (() => {
  const SCALE_MAX = 3;
  const TICK_MS = 125;
  const STATE_COLORS = { thinking: '#a78bfa', running: '#3b82f6', waiting: '#22c55e', pending: '#f59e0b', error: '#ef4444' };

  let atlas = null, manifest = null;     // Image + JSON
  let available = null;                   // null = pas encore sondé
  let probePromise = null;                // évite un double fetch si probe() est appelé 2x avant résolution
  let state = null;                       // OfficeLayout.createOfficeState()
  let room = null;                        // dernier layoutRoom()
  let timer = null;
  let tickCount = 0;
  let hover = null;                       // { sessionId, x, y } sous le curseur
  let canvas, ctx, tooltip;

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

  function snapshot() {
    const sorted = getSortedSessions();
    // Pas de workflows au top-level : office-layout les agrège lui-même depuis
    // s.workflows (collectWorkflows) — les passer ici les compterait deux fois.
    return {
      interactive: sorted.filter(s => !s.isBackground),
      background: sorted.filter(s => s.isBackground),
    };
  }

  function drawFrame(name, px, py, scale) {
    const f = manifest.frames[name];
    if (!f) return;
    // ancre bas-gauche : les sprites plus hauts qu'une tile "dépassent" vers le haut
    ctx.drawImage(atlas, f.x, f.y, f.w, f.h, px, py - (f.h - 16) * scale, f.w * scale, f.h * scale);
  }

  function animFrameName(animName, frameIdx) {
    const a = manifest.anims[animName];
    if (!a) return null;
    return a.loop ? a.frames[frameIdx % a.frames.length]
                  : a.frames[Math.min(frameIdx, a.frames.length - 1)];
  }

  function draw() {
    const snap = snapshot();
    room = OfficeLayout.layoutRoom(state, snap);
    const scale = Math.max(1, Math.min(SCALE_MAX, Math.floor(canvas.clientWidth / (room.cols * 16))));
    const w = room.cols * 16 * scale, h = room.rows * 16 * scale;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    const sessionsById = new Map();
    for (const s of [...snap.interactive, ...snap.background]) sessionsById.set(s.sessionId, s);

    // 1. statiques (sols/murs d'abord, meubles ensuite — l'ordre de statics le garantit)
    for (const st of room.statics) {
      if (st.frame === 'coffeeMachine') {
        drawFrame(animFrameName('coffee', tickCount >> 1), st.tx * 16 * scale, st.ty * 16 * scale, scale);
        continue;
      }
      drawFrame(st.frame, st.tx * 16 * scale, st.ty * 16 * scale, scale);
      if (st.screen) { // lueur d'écran = état de la session
        const s = sessionsById.get(st.screen);
        const color = s && STATE_COLORS[s.state.name];
        if (color && s.state.name !== 'waiting') {
          ctx.fillStyle = color;
          ctx.globalAlpha = (s.state.name === 'running' && (tickCount & 4)) ? 0.4 : 0.9;
          ctx.fillRect((st.tx * 16 + 3) * scale, (st.ty * 16 - 6) * scale, 6 * scale, 4 * scale);
          ctx.globalAlpha = 1;
        }
      }
    }

    // 2. acteurs triés par ty (z-order)
    const actors = [...state.actors.values()].sort((a, b) => a.ty - b.ty);
    const hitRects = [];
    for (const a of actors) {
      // think → anim à 2 fps (>>2), autres → 8 fps
      const fi = a.activity === 'think' ? (a.animFrame >> 2) : a.animFrame;
      const fname = animFrameName(OfficeLayout.animFor(a), fi);
      const px = a.tx * 16 * scale, py = a.ty * 16 * scale;
      if (fname) drawFrame(fname, px, py, scale);
      // Bulles d'état au-dessus de la tête
      const s = sessionsById.get(a.sessionId);
      if (a.kind === 'session' && s) {
        if (s.state.name === 'thinking') pixelText('…', px + 4 * scale, py - 20 * scale, STATE_COLORS.thinking, scale);
        if (s.state.name === 'pending') pixelText('!', px + 6 * scale, py - 20 * scale, STATE_COLORS.pending, scale);
        if (!s.isBackground) hitRects.push({ sessionId: a.sessionId, x: px, y: py - 16 * scale, w: 16 * scale, h: 32 * scale });
      }
    }
    // Bureaux cliquables aussi (même vide, le poste reste la cible)
    for (const [id, d] of room.zones.desks) {
      hitRects.push({ sessionId: id, x: d.tx * 16 * scale, y: d.ty * 16 * scale, w: 3 * 16 * scale, h: 2 * 16 * scale });
    }
    // Overflow back-office
    if (room.zones.overflow > 0) {
      pixelText(`+${room.zones.overflow}`, (room.cols - 3) * 16 * scale, (room.rows - 1) * 16 * scale, '#9ca3af', scale);
    }
    canvas._hitRects = hitRects;
  }

  function pixelText(txt, x, y, color, scale) {
    ctx.font = `${7 * scale}px monospace`;
    ctx.fillStyle = color;
    ctx.fillText(txt, x, y);
  }

  function tick() {
    tickCount++;
    for (const a of state.actors.values()) {
      a.animFrame++;
      OfficeLayout.tickActor(a, room ? room.zones : null);
      if (a.done) state.actors.delete(a.id);
    }
    // Dernier acteur parti (porte franchie) et plus aucune session : la vue
    // n'a plus rien à animer → render() retombe sur l'empty state et gate
    // showOffice à false, ce qui stoppe la boucle (deactivate()).
    if (sessions.size === 0 && state.actors.size === 0) { render(); return; }
    // Les anims tournent en continu (idle bob, café) : chaque tick change des
    // frames, donc chaque tick redessine. L'économie CPU vient de la boucle
    // entièrement stoppée quand la vue est inactive (deactivate()).
    draw();
  }

  function hitTest(ev) {
    const rects = canvas._hitRects || [];
    const r = canvas.getBoundingClientRect();
    // Le canvas peut être downscalé par CSS (.office-view canvas { max-width:100% }
    // dans une fenêtre étroite) : les coordonnées souris sont en espace CSS, les
    // _hitRects en espace pixel natif du canvas — convertir avant de comparer.
    const sx = r.width ? canvas.width / r.width : 1;
    const sy = r.height ? canvas.height / r.height : 1;
    const x = (ev.clientX - r.left) * sx, y = (ev.clientY - r.top) * sy;
    for (let i = rects.length - 1; i >= 0; i--) {
      const h = rects[i];
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
    }
    return null;
  }

  function onMove(ev) {
    const hit = hitTest(ev);
    canvas.style.cursor = hit ? 'pointer' : 'default';
    if (!hit) { tooltip.style.display = 'none'; hover = null; return; }
    if (hover && hover.sessionId === hit.sessionId) return;
    hover = hit;
    const s = sessions.get(hit.sessionId);
    if (!s) return;
    tooltip.innerHTML = `
      <div class="office-tip-name">${esc(s.customName || s.projectName)}</div>
      <div class="office-tip-row">${esc(getStateLabel(s))} · ${esc(s.gitBranch || '—')}</div>
      <div class="office-tip-row">${esc(formatModel(s.model))} · ${formatDuration(s.startedAt)}</div>`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(ev.clientX + 12, window.innerWidth - 220)}px`;
    tooltip.style.top = `${ev.clientY + 12}px`;
  }

  function onClick(ev) {
    const hit = hitTest(ev);
    if (hit) handleFocus(hit.sessionId); // handleFocus ignore déjà les headless
  }

  async function activate() {
    if (!(await probe())) return false;
    canvas = document.getElementById('officeCanvas');
    tooltip = document.getElementById('officeTooltip');
    ctx = canvas.getContext('2d');
    if (!canvas._wired) {
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; hover = null; });
      canvas.addEventListener('click', onClick);
      canvas._wired = true;
    }
    if (!state) state = OfficeLayout.createOfficeState();
    OfficeLayout.syncActors(state, snapshot());
    draw();
    if (!timer) timer = setInterval(tick, TICK_MS);
    return true;
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
    if (tooltip) tooltip.style.display = 'none';
  }

  function notifyUpdate() {
    if (!timer || !state) return; // vue inactive → rien
    OfficeLayout.syncActors(state, snapshot());
    // le prochain tick (≤125 ms) redessine avec le nouvel état
  }

  return { probe, activate, deactivate, notifyUpdate, isAvailable: () => available === true };
})();
