// Popover mini-view — shows active sessions in a compact list + usage gauges.

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// « reste X » compact (même style que l'île : « 35 min », « 7 h 33 », « 3 j 12 h »).
function fmtRemaining(resetsAt) {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const min = Math.round(ms / 60000);
  if (min >= 1440) {
    const d = Math.floor(min / 1440);
    const h = Math.round((min % 1440) / 60);
    return h ? `${d} j ${h} h` : `${d} j`;
  }
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m}` : `${h} h`;
  }
  return `${min} min`;
}

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
    const isActive = stateName === 'running' || stateName === 'thinking';
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
  const cls = pct > 80 ? ' hot' : pct >= 50 ? ' warn' : '';
  const rem = resetsAt ? fmtRemaining(resetsAt) : '';
  const right = rem ? window.i18n.t('island_reste', { t: rem }) : '';
  return `<div class="pop-gauge">`
    + `<div class="pop-gauge-track"><div class="pop-gauge-fill${cls}" style="width:${Math.min(100, pct)}%"></div></div>`
    + `<div class="pop-gauge-label"><span>${esc(label)} · ${pct}%</span><span>${esc(right)}</span></div>`
    + `</div>`;
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
