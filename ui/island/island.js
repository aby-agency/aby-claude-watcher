// Island renderer — collapsed LEDs + expanded session list. Hover drives
// expansion: mousemove is forwarded even when the window is click-through
// (setIgnoreMouseEvents forward:true); entering the pill/panel asks main to
// take mouse events, leaving gives them back.

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Escape for use in HTML attribute (onclick handlers, etc.)
function escAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtMin(minutes) {
  if (minutes === null || minutes === undefined) return '';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function fmtRemaining(resetsAt) {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const min = Math.round(ms / 60000);
  if (min >= 1440) { // fenêtre 7 jours : « 3 j 12 h »
    const d = Math.floor(min / 1440);
    const h = Math.round((min % 1440) / 60);
    return h ? `${d} j ${h} h` : `${d} j`;
  }
  return fmtMin(min);
}

function ledHtml(led, bg) {
  return `<span class="led${bg ? ' bg' : ''}" data-state="${escAttr(led.state)}"></span>`;
}

function wingHtml(wing) {
  // Badge par état : pastille couleur d'état, chiffre dedans, anneau rotatif
  // autour pour les actifs (CSS). Même rendu sur les deux ailes — headless
  // compris. Les rangées gardent leur LED par session.
  return wing.leds.map((l) =>
    `<span class="state-badge" data-state="${escAttr(l.state)}">${l.count}</span>`
  ).join('');
}

function rowHtml(row) {
  // Sous-lignes indentées : workflows (deep research, violet) d'abord puis
  // subagents — non cliquables, le focus passe par la ligne parente.
  const subs = row.workflows.map((w) => `
    <div class="subrow subrow-wf">
      <span class="subrow-spin"></span>
      <span class="subrow-label">⚡ ${esc(w.name)}</span>
      <span class="subrow-meta">${w.done}/${w.started}</span>
    </div>`).join('') + row.subagents.map((a) => `
    <div class="subrow">
      <span class="subrow-spin"></span>
      <span class="subrow-label">${esc(a.label)}</span>
    </div>`).join('');
  return `
    <div class="row" data-session="${escAttr(row.sessionId)}" data-bg="${row.isBackground ? '1' : ''}">
      <span class="led${row.isBackground ? ' bg' : ''}" data-state="${escAttr(row.state)}"></span>
      <span class="r-name">${esc(row.name)}</span>
      <span class="r-state">${esc(window.i18n.t('state_' + row.state))}</span>
    </div>${subs}`;
}

// Ne réassigner l'innerHTML d'une aile que s'il change : l'animation
// d'apparition des badges (badge-in) joue à l'insertion des nœuds — un
// réassignement à l'identique la rejouerait à chaque tick 30s.
function setWing(id, html) {
  const el = document.getElementById(id);
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

// Pilule adaptative : pousse dans --wing-l/--wing-r la largeur du contenu de
// CHAQUE aile — au repos la pilule est asymétrique (une aile vide se replie
// à zéro), le CSS compense par un translateX pour garder le gap sur
// l'encoche ; ouverte (panneau/bannière), elle redevient symétrique pour que
// le drop centré s'aligne. Mesure en offsetLeft/offsetWidth (boîtes de
// layout) et PAS getBoundingClientRect : les rects suivent les transforms —
// un badge-in en cours (scale .4) fausserait la mesure, alors que le layout
// réserve la boîte pleine. Insensible aussi à la largeur de colonne courante
// (flex-end/flex-start), donc stable en pleine animation de la pilule.
function fitPill() {
  const content = (id) => {
    const k = document.getElementById(id).children;
    if (!k.length) return 0;
    const first = k[0], last = k[k.length - 1];
    return last.offsetLeft + last.offsetWidth - first.offsetLeft;
  };
  const style = document.documentElement.style;
  const l = Math.ceil(content('wingLeft'));
  const r = Math.ceil(content('wingRight'));
  style.setProperty('--wing-l', `${l}px`);
  style.setProperty('--wing-r', `${r}px`);
  // Aile vide → padding de ce côté à zéro : la pilule s'arrête à la marge
  // de l'encoche au lieu de traîner 14px de noir mort.
  style.setProperty('--pad-l', l ? '14px' : '0px');
  style.setProperty('--pad-r', r ? '14px' : '0px');
}

let refreshSeq = 0;
async function refresh() {
  const myId = ++refreshSeq;
  const sessions = await window.islandApi.getSessions();
  if (myId !== refreshSeq) return;
  const config = await window.islandApi.getConfig();
  if (myId !== refreshSeq) return;
  const usage = await window.islandApi.getUsage();
  if (myId !== refreshSeq) return;

  window.i18n.setLanguage(config.language || window.i18n.detectSystemLanguage());

  const m = window.islandModel.buildIsland(sessions, config);
  setWing('wingLeft', wingHtml(m.left));
  setWing('wingRight', wingHtml(m.right));
  fitPill();

  const $rows = document.getElementById('rows');
  $rows.innerHTML = m.rows.length
    ? m.rows.map(rowHtml).join('')
    : (m.backgroundRows.length === 0
      ? `<div class="island-empty">${esc(window.i18n.t('island_empty'))}</div>`
      : '');
  document.getElementById('rowsBg').innerHTML = m.backgroundRows.map(rowHtml).join('');

  // Focus on click — interactive rows only (headless: no click-focus).
  document.querySelectorAll('#rows .row[data-session]').forEach((item) => {
    item.addEventListener('click', () => window.islandApi.focusSession(item.dataset.session));
  });

  // Jauges 5h + 7j (même recette), séparées par un filet.
  const renderGauge = (blockId, fillId, leftId, rightId, label, data) => {
    const $block = document.getElementById(blockId);
    if (!data || typeof data.utilization !== 'number') {
      $block.style.display = 'none';
      return false;
    }
    const pct = Math.round(data.utilization);
    const $fill = document.getElementById(fillId);
    $fill.style.width = `${Math.min(100, pct)}%`;
    $fill.className = 'gauge-fill' + (pct > 80 ? ' hot' : pct >= 50 ? ' warn' : '');
    document.getElementById(leftId).textContent = `${label} · ${pct}%`;
    const rem = data.resetsAt ? fmtRemaining(data.resetsAt) : '';
    document.getElementById(rightId).textContent = rem
      ? window.i18n.t('island_reste', { t: rem }) : '';
    $block.style.display = '';
    return true;
  };
  renderGauge('gaugeBlock', 'gaugeFill', 'gaugeLeft', 'gaugeRight', '5H', usage && usage.fiveHour);
  renderGauge('gauge7Block', 'gauge7Fill', 'gauge7Left', 'gauge7Right', '7J', usage && usage.sevenDay);
}

// ── Hover machinery ──
// hovering pilote le click-through (IPC) ; l'expansion du panneau est
// distincte : pilule/panneau seulement — survoler la bannière rend les clics
// possibles SANS déplier le panneau.
let hovering = false;
function inRect(el, x, y, pad = 0) {
  const r = el.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
function setMouse(next) {
  if (next === hovering) return;
  hovering = next;
  window.islandApi.setHover(hovering);
}
function setExpanded(next) {
  if (next === document.body.classList.contains('expanded')) return;
  document.body.classList.toggle('expanded', next);
  if (next) hideBanner(); // le panneau prend le dessus
}
const $pill = document.getElementById('pill');
document.addEventListener('mousemove', (e) => {
  const overPill = inRect($pill, e.clientX, e.clientY, 4);
  const expanded = document.body.classList.contains('expanded');
  const overPanel = expanded && inRect(document.getElementById('panel'), e.clientX, e.clientY, 4);
  const $banner = document.getElementById('banner');
  const overBanner = $banner.classList.contains('visible') && inRect($banner, e.clientX, e.clientY, 4);
  setMouse(overPill || overPanel || overBanner);
  setExpanded(overPill || overPanel);
});
document.addEventListener('mouseleave', () => { setMouse(false); setExpanded(false); });
window.addEventListener('blur', () => { setMouse(false); setExpanded(false); });

// Debounce rapid updates (same pattern as the old popover).
let refreshPending = null;
function scheduleRefresh() {
  if (refreshPending) return;
  refreshPending = setTimeout(() => { refreshPending = null; refresh(); }, 100);
}
// ── Bannière needs-you : pile de notifications ──
// Chaque session a sa ligne avec son propre timer 10s ; les lignes arrivent
// et repartent indépendamment, la bande suit en hauteur. Dédup par session :
// un nouvel événement de la même session rafraîchit sa ligne et son timer.
const BANNER_MS = 10000; // 4s puis 6s jugées trop courtes par Paul
const banners = new Map(); // sessionId → { el, timer }
function removeBanner(sessionId) {
  const entry = banners.get(sessionId);
  if (!entry) return;
  banners.delete(sessionId);
  clearTimeout(entry.timer);
  entry.el.classList.remove('in'); // rétraction animée de la ligne
  setTimeout(() => entry.el.remove(), 250);
  if (banners.size === 0) {
    document.getElementById('banner').classList.remove('visible');
    // Pile vidée sous un curseur immobile → relâcher la capture des clics
    // (sauf panneau ouvert : le survol pilule garde la main légitimement).
    if (!document.body.classList.contains('expanded')) setMouse(false);
  }
}
function hideBanner() { // vidage complet (appelé à l'ouverture du panneau)
  [...banners.keys()].forEach(removeBanner);
}
window.islandApi.onBanner((b) => {
  if (!b.state) return; // payload sans état — rien à afficher
  if (document.body.classList.contains('expanded')) return; // panneau ouvert
  let entry = banners.get(b.sessionId);
  if (!entry) {
    const el = document.createElement('div');
    el.className = 'banner-item';
    el.innerHTML = '<span class="led"></span><span class="banner-text"></span>';
    el.addEventListener('click', () => {
      window.islandApi.focusSession(b.sessionId);
      removeBanner(b.sessionId);
    });
    document.getElementById('banner').appendChild(el);
    entry = { el, timer: null };
    banners.set(b.sessionId, entry);
    requestAnimationFrame(() => el.classList.add('in'));
  }
  entry.el.querySelector('.led').dataset.state = b.state;
  // textContent : pas d'injection possible, pas d'échappement nécessaire.
  entry.el.querySelector('.banner-text').textContent =
    `${b.name} — ${window.i18n.t('state_' + b.state)}`;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => removeBanner(b.sessionId), BANNER_MS);
  document.getElementById('banner').classList.add('visible');
});
window.islandApi.onUpdate(scheduleRefresh);
// Largeur réelle de l'encoche mesurée par le main (fallback CSS : 180px).
window.islandApi.onGeometry((g) => {
  // max(gap, 10) : en pilule compacte (docké, gap 0) on garde une respiration
  // entre les deux ailes.
  document.documentElement.style.setProperty('--notch-gap', `${Math.max(g.gapPx, 10)}px`);
});
// Largeur/hauteur réelles de la pilule → le drop (bannière, panneau) s'aligne.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--pill-w', `${$pill.offsetWidth}px`);
  document.documentElement.style.setProperty('--pill-h', `${$pill.offsetHeight}px`);
}).observe($pill);
// Re-render every 30s so the gauges' "reste X" countdown ticks without events.
setInterval(scheduleRefresh, 30000);
refresh();
