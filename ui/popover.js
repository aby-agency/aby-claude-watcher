// Popover mini-view — shows active sessions in a compact list

const STATE_COLORS = {
  thinking: '#a78bfa',
  running: '#22c55e',
  waiting: '#3b82f6',
  error: '#ef4444',
};

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
    const color = STATE_COLORS[stateName] || '#6b7280';
    const isActive = stateName === 'running' || stateName === 'thinking';
    const indicator = isActive
      ? `<span class="pop-spinner" style="border-color: ${color}; border-top-color: transparent; border-right-color: transparent"></span>`
      : `<span class="pop-dot" style="background: ${color}"></span>`;
    const displayName = customNames[s.sessionId] || s.projectName;
    return `
      <div class="pop-item" data-session="${esc(s.sessionId)}">
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

let refreshSeq = 0;
async function refresh() {
  const myId = ++refreshSeq;
  const sessions = await window.popoverApi.getSessions();
  if (myId !== refreshSeq) return; // stale, abort
  const config = await window.popoverApi.getConfig();
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
  // Auto-resize to fit content
  requestAnimationFrame(() => {
    const height = document.querySelector('.popover-body').scrollHeight;
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
