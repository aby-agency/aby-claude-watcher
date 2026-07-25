// Popover mini-view — shows active sessions in a compact list + usage gauges.

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Temps restant : formateur partagé (window.usageGauge) — format compact
// unifié avec le dashboard et l'île (« 45m », « 2h46 », « 3j12h »).
const fmtRemaining = (resetsAt) => window.usageGauge.formatRemaining(resetsAt);

function renderPopover(sessions, config) {
  const $list = document.getElementById('popList');
  const $header = document.getElementById('popHeader');

  const customNames = (config && config.customNames) || {};
  const sessionOrder = (config && config.sessionOrder) || [];

  $header.textContent = window.i18n.t('popover_header', { n: sessions.length });

  if (sessions.length === 0) {
    $list.innerHTML = `<div class="popover-empty">${window.i18n.t('popover_empty')}</div>`;
    return;
  }

  // Use same order as main window (user-defined sessionOrder, newest first for new ones)
  sessions.sort((a, b) => {
    const ai = sessionOrder.indexOf(a.sessionId);
    const bi = sessionOrder.indexOf(b.sessionId);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return new Date(b.startedAt) - new Date(a.startedAt);
  });

  $list.innerHTML = sessions.map(s => {
    const stateName = s.state.name;
    // job/delegating = tour suspendu à une tâche de fond ou à des sous-agents
    // → spinner, comme running/thinking.
    const isActive = ['running', 'thinking', 'job', 'delegating'].includes(stateName);
    // Color comes from CSS via [data-state] (same convention as .micro-item),
    // not from an inline style — keeps state colors single-sourced in styles.css.
    const indicator = isActive
      ? `<span class="pop-spinner"></span>`
      : `<span class="pop-dot"></span>`;
    const displayName = customNames[s.sessionId] || s.projectName;
    return `
      <div class="pop-item" data-session="${esc(s.sessionId)}" data-state="${esc(stateName)}">
        ${indicator}
        <span class="pop-name">${esc(displayName)}</span>
        <span class="pop-state">${esc(window.i18n.t('state_' + s.state.name))}</span>
      </div>
    `;
  }).join('');

  // Wire up click handlers
  $list.querySelectorAll('.pop-item').forEach(item => {
    item.addEventListener('click', () => {
      window.popoverApi.focusSession(item.dataset.session);
      window.popoverApi.hide();
    });
  });
}

// Jauges conso — 5H / 7J puis limites scopées (ex. « 7J FABLE »), rendu
// générique depuis getUsage(). Seuils alignés île/tray : warn ≥50, hot >80.
function gaugeRow(label, pct, resetsAt) {
  // Barre partagée (usage-ring) — Paul préfère la barre à l'anneau dans le
  // popover. reste = temps formaté nu (« 3h20 »).
  const rem = resetsAt ? fmtRemaining(resetsAt) : '';
  return window.usageGauge.usageBar(label, pct, rem);
}

function renderGauges(usage) {
  const $g = document.getElementById('popGauges');
  if (!usage) { $g.innerHTML = ''; return; }
  const rows = [];
  const base = (label, data) => {
    if (!data || typeof data.utilization !== 'number') return;
    rows.push(gaugeRow(label, Math.round(data.utilization), data.resetsAt));
  };
  base('5H', usage.fiveHour);
  base('7J', usage.sevenDay);
  for (const l of usage.scopedLimits || []) {
    const win = l.group === 'session' ? '5H' : '7J';
    rows.push(gaugeRow(`${win} ${String(l.model).toUpperCase()}`, Math.round(l.percent), l.resetsAt));
  }
  $g.innerHTML = rows.join('');
}

let refreshSeq = 0;
async function refresh() {
  const myId = ++refreshSeq;
  const sessions = await window.popoverApi.getSessions();
  if (myId !== refreshSeq) return; // stale, abort
  const config = await window.popoverApi.getConfig();
  if (myId !== refreshSeq) return; // stale, abort
  const usage = await window.popoverApi.getUsage();
  if (myId !== refreshSeq) return; // stale, abort
  // Sync language
  const lang = config.language || window.i18n.detectSystemLanguage();
  window.i18n.setLanguage(lang);
  // Apply i18n to static elements (title, button labels)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = window.i18n.t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', window.i18n.t(el.dataset.i18nTitle));
  });
  renderPopover(sessions, config);
  renderGauges(usage);
  // Auto-resize to fit content
  requestAnimationFrame(() => {
    const header = document.querySelector('.popover-header');
    const list = document.getElementById('popList');
    const gauges = document.getElementById('popGauges');
    const footer = document.querySelector('.popover-footer');
    // .popover-body has 1px borders top + bottom = 2px
    const height = header.offsetHeight + list.scrollHeight + gauges.offsetHeight + footer.offsetHeight + 2;
    window.popoverApi.resize(height);
  });
}

document.getElementById('popOpenBtn').addEventListener('click', () => {
  window.popoverApi.openMainWindow();
  window.popoverApi.hide();
});

document.getElementById('popQuitBtn').addEventListener('click', () => {
  window.popoverApi.quit();
});

// Debounce rapid updates to avoid hammering IPC with many sessions
let refreshPending = null;
function scheduleRefresh() {
  if (refreshPending) return;
  refreshPending = setTimeout(() => {
    refreshPending = null;
    refresh();
  }, 100);
}

window.popoverApi.onUpdate(scheduleRefresh);
refresh();
