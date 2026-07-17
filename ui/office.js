// ui/office.js — moteur de rendu de la vue office v2 : une mini-pièce par
// session, un canvas par carte, UN SEUL timer 8 fps pour toutes les vignettes.
// Chargé APRÈS office-layout.js, AVANT renderer.js (les globals de renderer
// ne sont touchés qu'à l'exécution). Vue inactive = timer stoppé (zéro coût).
const Office = (() => {
  const TICK_MS = 125;
  const SCALE_MIN = 1, SCALE_MAX = 4;
  const TINT_ALPHA = 0.12;
  const STATE_COLORS = { thinking: '#a78bfa', running: '#3b82f6', waiting: '#22c55e', pending: '#f59e0b', error: '#ef4444' };

  let atlas = null, manifest = null;
  let available = null;
  let probePromise = null;
  let state = null;          // OfficeLayout.createState()
  let timer = null;
  let tickCount = 0;
  let tooltip = null;

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

  // ─── Carte-vignette (item de vue, appelé par viewItemHTML de renderer.js) ───
  function cardHTML(s) {
    const sid = escAttr(s.sessionId);
    const stateName = s.state.name;
    return `
      <div class="office-card${s.isBackground ? ' bg-session' : ''}" data-state="${stateName}" data-session="${sid}"
           draggable="${!searchQuery}"
           ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)"
           onclick="handleCardClick(event, '${sid}')">
        <canvas class="office-canvas" data-room="${sid}"></canvas>
        <div class="office-card-footer">
          <div class="office-card-name editable-name" onclick="event.stopPropagation(); startInlineRename(event, '${sid}')" title="${t('action_rename_hint')}">
            <span class="project-name-text">${esc(s.customName || s.projectName)}</span>
            <span class="edit-hint">${ICONS.edit}</span>
          </div>
          <button class="card-btn notif-btn ${s.notifEnabled ? 'notif-on' : ''}" onclick="event.stopPropagation(); toggleNotif(event, '${sid}')" title="${t('action_notifications')}">
            ${s.notifEnabled ? ICONS.bell : ICONS.bellOff}
          </button>
        </div>
      </div>
    `;
  }

  // ─── Rendu d'une pièce dans son canvas ───
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

  function drawRoom(canvas, s) {
    const room = OfficeLayout.roomFor(s);
    const cardW = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth;
    const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.floor(cardW / (room.cols * 16)) || SCALE_MIN));
    const w = room.cols * 16 * scale, h = room.rows * 16 * scale;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c2d = canvas.getContext('2d');
    c2d.imageSmoothingEnabled = false;
    c2d.clearRect(0, 0, w, h);

    const stateName = s.state.name;
    for (const st of room.statics) {
      const px = st.tx * 16 * scale, py = st.ty * 16 * scale;
      if (st.frame === 'coffeeMachine') {
        drawFrameOn(c2d, animFrameName('coffee', tickCount >> 1), px, py, scale);
        continue;
      }
      if (st.frame === 'door') { c2d.fillStyle = '#1a1a22'; c2d.fillRect(px, py, 16 * scale, 16 * scale); continue; }
      if (st.frame === '_papers') {
        c2d.fillStyle = '#d8d3c3';
        c2d.fillRect(px + 3 * scale, py + 6 * scale, 5 * scale, 3 * scale);
        c2d.fillRect(px + 9 * scale, py + 10 * scale, 4 * scale, 3 * scale);
        continue;
      }
      drawFrameOn(c2d, st.frame, px, py, scale);
      if (st.screen) {
        const color = STATE_COLORS[stateName];
        if (color && stateName !== 'waiting') {
          c2d.fillStyle = color;
          c2d.globalAlpha = (stateName === 'running' && (tickCount & 4)) ? 0.4 : 0.9;
          c2d.fillRect((st.tx * 16 + 3) * scale, (st.ty * 16 - 6) * scale, 6 * scale, 4 * scale);
          c2d.globalAlpha = 1;
        }
      }
    }

    for (const a of OfficeLayout.actorsFor(state, s.sessionId)) {
      const fi = a.activity === 'think' ? (a.animFrame >> 2) : a.animFrame;
      const fname = animFrameName(OfficeLayout.animFor(a), fi);
      const px = a.tx * 16 * scale, py = a.ty * 16 * scale;
      if (fname) drawFrameOn(c2d, fname, px, py, scale);
      if (a.kind === 'session') {
        if (stateName === 'thinking') pixelTextOn(c2d, '…', px + 4 * scale, py - 20 * scale, STATE_COLORS.thinking, scale);
        if (stateName === 'pending') pixelTextOn(c2d, '!', px + 6 * scale, py - 20 * scale, STATE_COLORS.pending, scale);
      }
    }
    if (room.zones.subOverflow > 0) {
      pixelTextOn(c2d, `+${room.zones.subOverflow}`, 7.5 * 16 * scale, 4 * 16 * scale, '#9ca3af', scale);
    }

    // Teinte d'éclairage : l'état en vision périphérique.
    if (s.isBackground) {
      c2d.fillStyle = '#000';
      c2d.globalAlpha = 0.35;
      c2d.fillRect(0, 0, w, h);
      c2d.globalAlpha = 1;
    } else {
      const color = STATE_COLORS[stateName];
      if (color) {
        c2d.fillStyle = color;
        c2d.globalAlpha = TINT_ALPHA;
        c2d.fillRect(0, 0, w, h);
        c2d.globalAlpha = 1;
      }
    }
  }

  function pixelTextOn(c2d, txt, x, y, color, scale) {
    c2d.font = `${7 * scale}px monospace`;
    c2d.fillStyle = color;
    c2d.fillText(txt, x, y);
  }

  function container() { return document.getElementById('officeView'); }

  function drawAll() {
    const cont = container();
    if (!cont) return;
    for (const canvas of cont.querySelectorAll('canvas[data-room]')) {
      const s = sessions.get(canvas.dataset.room);
      if (s) drawRoom(canvas, s);
    }
  }

  // ─── Sync + boucle ───
  function syncAll() {
    if (!state) state = OfficeLayout.createState();
    const live = getSortedSessions();
    for (const s of live) OfficeLayout.syncSession(state, s);
    OfficeLayout.purge(state, new Set(live.map(s => s.sessionId)));
  }

  function tick() {
    tickCount++;
    const doneSids = [];
    for (const a of state.actors.values()) {
      a.animFrame++;
      // zones : la géométrie est fixe, la porte est la même pour toutes les pièces
      OfficeLayout.tickActor(a, null);
      if (a.done) { state.actors.delete(a.id); doneSids.push(a.sessionId); }
    }
    // Acteur sorti → sa carte (session déjà purgée) se retire du DOM.
    for (const sid of doneSids) {
      const el = container().querySelector(`[data-session="${sid}"]`);
      if (el && !sessions.has(sid)) el.remove();
    }
    if (sessions.size === 0 && state.actors.size === 0) { render(); return; }
    drawAll();
  }

  // ─── Hooks appelés par renderer.js ───
  // Après un fullRender / patch de carte en mode office : sync, redraw
  // immédiat (pas de canvas blanc pendant 125 ms), timer garanti.
  function onDomRendered() {
    if (available !== true) return;
    syncAll();
    drawAll();
    wireTooltip();
    if (!timer) timer = setInterval(tick, TICK_MS);
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
    if (tooltip) tooltip.style.display = 'none';
  }

  // Session purgée : l'acteur sort par la porte, la carte reste le temps
  // de la marche (retirée par tick() quand l'acteur est done).
  function notifyRemoved(sessionId) {
    if (!state) return;
    syncAll();
    void sessionId; // la purge se fait sur l'ensemble — l'id est déjà absent de sessions
  }

  function wireTooltip() {
    const cont = container();
    if (!cont || cont._tipWired) return;
    cont._tipWired = true;
    tooltip = document.getElementById('officeTooltip');
    cont.addEventListener('mousemove', (ev) => {
      const card = ev.target.closest && ev.target.closest('.office-card');
      if (!card) { tooltip.style.display = 'none'; return; }
      const s = sessions.get(card.dataset.session);
      if (!s) return;
      tooltip.innerHTML = `
        <div class="office-tip-name">${esc(s.customName || s.projectName)}</div>
        <div class="office-tip-row">${esc(getStateLabel(s))} · ${esc(s.gitBranch || '—')}</div>
        <div class="office-tip-row">${esc(formatModel(s.model))} · ${formatDuration(s.startedAt)}</div>`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(ev.clientX + 12, window.innerWidth - 220)}px`;
      tooltip.style.top = `${Math.min(ev.clientY + 12, window.innerHeight - 80)}px`;
    });
    cont.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  }

  return { probe, cardHTML, onDomRendered, deactivate, notifyRemoved, isAvailable: () => available === true };
})();
