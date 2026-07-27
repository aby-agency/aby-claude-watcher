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

// Temps restant : formateur partagé (window.usageGauge) — format compact
// unifié avec le dashboard et le popover.
const fmtRemaining = (resetsAt) => window.usageGauge.formatRemaining(resetsAt);

function wingHtml(wing) {
  // Pilule binaire : une pastille agrégée par aile — DROITE « busy » (bleu,
  // anneau qui tourne = ça bosse), GAUCHE « idle » (vert = ça attend), chiffre
  // = nombre de sessions. Le détail par état vit dans les rangées du panneau.
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
      <span class="r-state">${esc(window.i18n.t('state_' + row.state))}${row.minutes != null ? esc(' · ' + window.stateDuration.formatMinutes(row.minutes)) : ''}</span>
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
// Dernier état de mise à jour connu (main = source de vérité) : relu au
// refresh, poussé pendant un téléchargement. Voir renderUpdate() plus bas.
let updateState = null;
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

  // Jauges conso : 5H, 7J, puis chaque limite scopée (ex. « 7J FABLE ») —
  // anneaux partagés (usage-ring), même recette que la barre du bas et le
  // popover. reste = temps formaté nu (« 3h20 »).
  const bars = [];
  const add = (label, data) => {
    if (!data || typeof data.utilization !== 'number') return;
    const rem = data.resetsAt ? fmtRemaining(data.resetsAt) : '';
    bars.push(window.usageGauge.usageBar(label, Math.round(data.utilization), rem));
  };
  add('5H', usage && usage.fiveHour);
  add('7J', usage && usage.sevenDay);
  for (const l of (usage && Array.isArray(usage.scopedLimits) ? usage.scopedLimits : [])) {
    const win = l.group === 'session' ? '5H' : '7J';
    const rem = l.resetsAt ? fmtRemaining(l.resetsAt) : '';
    bars.push(window.usageGauge.usageBar(`${win} ${String(l.model).toUpperCase()}`, Math.round(l.percent), rem));
  }
  document.getElementById('gauges').innerHTML = bars.join('');

  // Version + mise à jour : relus à chaque refresh (le main est la source de
  // vérité) — la bannière collante se reconstruit donc toute seule après un
  // repli de panneau, un reload du renderer ou un rallumage de l'île.
  updateState = await window.islandApi.getUpdate();
  if (myId !== refreshSeq) return;
  renderUpdate();
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
// Fermeture RETARDÉE de 140ms : la souris qui frôle le bord, traverse le
// liseré entre pilule et panneau ou tremble d'un pixel refermait le panneau
// instantanément — un clignotement à chaque approche. Le délai laisse le
// mousemove suivant annuler la fermeture (re-survol = clearTimeout). Ne
// concerne QUE la fermeture : l'ouverture reste immédiate, et rien d'autre que
// le survol ne déplie (pas d'auto-expand sur pending/error).
const COLLAPSE_GRACE_MS = 140;
let collapseTimer = null;
function setExpanded(next, immediate = false) {
  if (next) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
    if (document.body.classList.contains('expanded')) return;
    document.body.classList.add('expanded');
    hideBanner(); // le panneau prend le dessus
    return;
  }
  if (!document.body.classList.contains('expanded')) return;
  if (immediate) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
    document.body.classList.remove('expanded');
    return;
  }
  if (collapseTimer) return;
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    document.body.classList.remove('expanded');
  }, COLLAPSE_GRACE_MS);
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
// Sortie franche de la fenêtre / perte de focus : repli IMMÉDIAT, pas de
// grâce — le curseur est parti pour de bon, le doute n'existe plus.
document.addEventListener('mouseleave', () => { setMouse(false); setExpanded(false, true); });
window.addEventListener('blur', () => { setMouse(false); setExpanded(false, true); });

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
// Vidage à l'ouverture du panneau — SAUF la ligne de mise à jour : elle est
// collante par définition, la vider ici reviendrait à l'effacer au premier
// survol de la pilule (le CSS l'escamote déjà pendant que le panneau est
// ouvert, elle réapparaît au repli).
function hideBanner() {
  [...banners.keys()].filter((k) => k !== UPDATE_KEY).forEach(removeBanner);
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

// ── Mise à jour : bannière collante + pied de panneau ──
// Deux surfaces, un seul modèle pur (islandModel.updateNotice) : le pied du
// panneau (version courante, toujours affichée) et une bannière SANS timer.
// Pourquoi collante alors que les bannières de session vivent 10 s : une
// session ratée revient d'elle-même (elle repassera waiting), une release
// ratée non — et le dashboard, seule surface qui la signalait, reste fermé
// des jours chez un utilisateur qui vit dans le tray.
// Clic = installation DIRECTE (décision Paul) ; « Plus tard » est la seule
// sortie sans installer (garde-fou au caractère collant), valable jusqu'au
// prochain lancement de l'app.
const UPDATE_KEY = '__update';

function updateText(n) {
  const t = window.i18n.t;
  if (n.phase === 'downloading') return t('update_downloading', { percent: n.percent });
  if (n.phase === 'installing') return t('update_installing');
  if (n.phase === 'error') return t('update_install_failed');
  return t('island_update', { version: n.latest });
}

function renderUpdate() {
  if (!updateState) return;
  const n = window.islandModel.updateNotice(updateState);
  const t = window.i18n.t;

  // Pied du panneau : « v2.5.0 » seul, ou « v2.5.0 → 2.6.0 » + action.
  const foot = document.getElementById('foot');
  const label = n.phase ? updateText(n) : t('island_update_install');
  const html = `<span class="foot-ver">v${esc(n.current || '?')}${
    n.latest ? ` <span class="foot-next">→ ${esc(n.latest)}</span>` : ''}</span>${
    n.showBanner ? `<span class="foot-action"${n.clickable ? ' data-act="install"' : ''}>${esc(label)}</span>` : ''}`;
  // Même précaution que setWing : renderUpdate() est rappelé ~10 fois par
  // seconde pendant un téléchargement, inutile de reconstruire un pied
  // identique (et de ré-attacher son listener) à chaque push.
  if (foot._html !== html) {
    foot._html = html;
    foot.innerHTML = html;
    const act = foot.querySelector('.foot-action[data-act="install"]');
    if (act) act.addEventListener('click', () => window.islandApi.installUpdate());
  }

  if (!n.showBanner) { removeBanner(UPDATE_KEY); return; }

  let entry = banners.get(UPDATE_KEY);
  if (!entry) {
    const el = document.createElement('div');
    el.className = 'banner-item update';
    el.innerHTML = '<span class="up-arrow">↑</span><span class="banner-text"></span>'
      + '<span class="banner-later"></span><span class="banner-prog"></span>';
    el.addEventListener('click', () => {
      // Relu au clic, pas capturé à la création : la ligne vit longtemps, son
      // état a pu changer (téléchargement déjà lancé depuis le dashboard).
      if (window.islandModel.updateNotice(updateState).clickable) window.islandApi.installUpdate();
    });
    el.querySelector('.banner-later').addEventListener('click', (e) => {
      e.stopPropagation(); // sans ça, « Plus tard » déclencherait l'installation
      window.islandApi.dismissUpdate();
      // Retrait optimiste : le main confirmera par son push, mais un clic dont
      // l'effet attend un aller-retour IPC se lit comme un clic raté.
      removeBanner(UPDATE_KEY);
    });
    document.getElementById('banner').appendChild(el);
    entry = { el, timer: null }; // timer null = collante, par construction
    banners.set(UPDATE_KEY, entry);
    requestAnimationFrame(() => el.classList.add('in'));
  }
  entry.el.querySelector('.banner-text').textContent = updateText(n);
  entry.el.querySelector('.banner-later').textContent = n.phase ? '' : t('island_update_later');
  entry.el.querySelector('.banner-prog').style.width = n.phase === 'downloading' ? `${n.percent}%` : '0%';
  entry.el.dataset.phase = n.phase || '';
  document.getElementById('banner').classList.add('visible');
}

// Push direct du main pendant le téléchargement (~10 fps) : on ne repasse pas
// par refresh(), qui re-interrogerait sessions + config + usage à chaque pourcent.
window.islandApi.onUpdateState((u) => { updateState = u; renderUpdate(); });

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
