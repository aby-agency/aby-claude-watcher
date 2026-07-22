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

function fmtMin(minutes) {
  if (minutes === null || minutes === undefined) return '';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function fmtRemaining(resetsAt) {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return fmtMin(Math.round(ms / 60000));
}

function ledHtml(led, bg) {
  return `<span class="led${bg ? ' bg' : ''}" data-state="${esc(led.state)}"></span>`;
}

function wingHtml(wing, bg) {
  return wing.leds.map((l) => ledHtml(l, bg)).join('')
    + (wing.more ? `<span class="more">+${wing.more}</span>` : '');
}

function rowHtml(row) {
  const dur = row.minutes !== null ? ` · ${fmtMin(row.minutes)}` : '';
  return `
    <div class="row" data-session="${esc(row.sessionId)}" data-bg="${row.isBackground ? '1' : ''}">
      <span class="led${row.isBackground ? ' bg' : ''}" data-state="${esc(row.state)}"></span>
      <span class="r-name">${esc(row.name)}</span>
      <span class="r-state">${esc(window.i18n.t('state_' + row.state))}${esc(dur)}</span>
    </div>`;
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
  document.getElementById('wingLeft').innerHTML = wingHtml(m.left, false);
  document.getElementById('wingRight').innerHTML = wingHtml(m.right, true);

  const $rows = document.getElementById('rows');
  $rows.innerHTML = m.rows.length
    ? m.rows.map(rowHtml).join('')
    : `<div class="island-empty">${esc(window.i18n.t('island_empty'))}</div>`;
  document.getElementById('rowsBg').innerHTML = m.backgroundRows.map(rowHtml).join('');

  // Focus on click — interactive rows only (headless: no click-focus).
  document.querySelectorAll('#rows .row[data-session]').forEach((item) => {
    item.addEventListener('click', () => window.islandApi.focusSession(item.dataset.session));
  });

  const $gauge = document.getElementById('gaugeBlock');
  const five = usage && usage.fiveHour;
  if (five && typeof five.utilization === 'number') {
    const pct = Math.round(five.utilization);
    const $fill = document.getElementById('gaugeFill');
    $fill.style.width = `${Math.min(100, pct)}%`;
    $fill.className = 'gauge-fill' + (pct >= 80 ? ' hot' : pct >= 50 ? ' warn' : '');
    document.getElementById('gaugeLeft').textContent = `5H · ${pct}%`;
    const rem = five.resetsAt ? fmtRemaining(five.resetsAt) : '';
    document.getElementById('gaugeRight').textContent = rem
      ? window.i18n.t('island_reste', { t: rem }) : '';
    $gauge.style.display = '';
  } else {
    $gauge.style.display = 'none';
  }
}

// ── Hover machinery ──
let hovering = false;
function inRect(el, x, y, pad = 0) {
  const r = el.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
function setHover(next) {
  if (next === hovering) return;
  hovering = next;
  document.body.classList.toggle('expanded', hovering);
  window.islandApi.setHover(hovering);
}
document.addEventListener('mousemove', (e) => {
  const overPill = inRect(document.getElementById('pill'), e.clientX, e.clientY, 4);
  const overPanel = hovering && inRect(document.getElementById('panel'), e.clientX, e.clientY, 4);
  setHover(overPill || overPanel);
});
// Mouse left the window entirely (fast exit can skip the last mousemove).
document.addEventListener('mouseleave', () => setHover(false));
window.addEventListener('blur', () => setHover(false));

// Debounce rapid updates (same pattern as the old popover).
let refreshPending = null;
function scheduleRefresh() {
  if (refreshPending) return;
  refreshPending = setTimeout(() => { refreshPending = null; refresh(); }, 100);
}
window.islandApi.onUpdate(scheduleRefresh);
// Re-render every 30s so the "· N min" durations tick without session events.
setInterval(scheduleRefresh, 30000);
refresh();
