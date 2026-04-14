// ═══════════════════════════════════════════════
// Claude Watch — Renderer
// ═══════════════════════════════════════════════

// Lucide-style SVG icons (24x24 viewBox, stroke-based)
const ICONS = {
  bell: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  bellRing: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M2 8c0-2.2.7-4.3 2-6"/><path d="M22 8a10 10 0 0 0-2-6"/></svg>`,
  externalLink: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
  terminal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  minus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  focus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>`,
  play: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  globe: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
  alertTriangle: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  copy: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  moreVertical: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`,
};

const sessions = new Map();
let viewMode = 'grid'; // 'grid' | 'compact'
let alwaysOnTop = false;
let volume = 0.7;
let notifPosition = 'top-right';
let openDropdown = null;
let searchQuery = '';
let sessionOrder = []; // User-defined order of session IDs
let draggedId = null;
let activeFilters = new Set(); // empty = all visible, or: 'active', 'waiting', 'completed'

// ═══ DOM refs ═══

const $content = document.getElementById('content');
const $emptyState = document.getElementById('emptyState');
const $emptyFiltered = document.getElementById('emptyFiltered');
const $gridView = document.getElementById('gridView');
const $compactView = document.getElementById('compactView');
const $btnGrid = document.getElementById('btnGrid');
const $btnCompact = document.getElementById('btnCompact');
const $btnPin = document.getElementById('btnPin');
const $btnAdd = document.getElementById('btnAdd');
const $addModal = document.getElementById('addModal');
const $addInput = document.getElementById('addInput');
const $addConfirm = document.getElementById('addConfirm');
const $addCancel = document.getElementById('addCancel');
const $notificationOverlay = document.getElementById('notificationOverlay');
const $btnSettings = document.getElementById('btnSettings');
const $settingsModal = document.getElementById('settingsModal');
const $settingsClose = document.getElementById('settingsClose');
const $volumeSlider = document.getElementById('volumeSlider');
const $volumeValue = document.getElementById('volumeValue');
const $btnTestSound = document.getElementById('btnTestSound');

// ═══ Init ═══

async function init() {
  const config = await window.api.getConfig();
  viewMode = config.viewMode || 'grid';
  // Migration: old 'list' → 'compact'
  if (viewMode === 'list' || config.compactMode) viewMode = 'compact';
  if (viewMode !== 'grid' && viewMode !== 'compact') viewMode = 'grid';
  alwaysOnTop = config.alwaysOnTop || false;
  volume = config.volume ?? 0.7;
  notifPosition = config.notifPosition || 'top-right';
  sessionOrder = config.sessionOrder || [];

  updateViewToggle();
  updatePinButton();
  updateNotifPosition();
  $volumeSlider.value = Math.round(volume * 100);
  $volumeValue.textContent = `${Math.round(volume * 100)}%`;

  const existingSessions = await window.api.getSessions();
  for (const s of existingSessions) {
    sessions.set(s.sessionId, s);
  }
  render();

  // Event listeners — targeted updates
  window.api.onSessionAdded((data) => {
    sessions.set(data.sessionId, data);
    render(); // full render for new session (needs correct placement)
  });

  window.api.onSessionUpdated((data) => {
    sessions.set(data.sessionId, data);
    updateSession(data); // targeted update — only patch the changed card
  });

  window.api.onSessionRemoved((id) => {
    sessions.delete(id);
    removeSessionFromDOM(id);
  });

  window.api.onShowNotification((data) => {
    showToast(data);
  });

  window.api.onPlaySound(() => {
    playNotificationSound();
  });

  // Toolbar
  $btnGrid.addEventListener('click', () => setView('grid'));
  $btnCompact.addEventListener('click', () => setView('compact'));

  // Status filter chips (multi-select)
  document.querySelectorAll('.status-filter .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const filter = chip.dataset.filter;
      if (activeFilters.has(filter)) {
        activeFilters.delete(filter);
      } else {
        activeFilters.add(filter);
      }
      updateFilterPills();
      render();
    });
  });

  // Clear filters button
  document.getElementById('btnClearFilters').addEventListener('click', () => {
    activeFilters.clear();
    updateFilterPills();
    render();
  });

  // Clear all (filters + search) from empty state
  document.getElementById('btnClearAllFilters').addEventListener('click', () => {
    activeFilters.clear();
    searchQuery = '';
    const search = document.getElementById('searchInput');
    search.value = '';
    search.style.display = 'none';
    updateFilterPills();
    render();
  });
  $btnPin.addEventListener('click', togglePin);
  $btnAdd.addEventListener('click', () => $addModal.style.display = 'flex');
  $addCancel.addEventListener('click', closeAddModal);
  $addConfirm.addEventListener('click', confirmAdd);

  // Rename modal
  document.getElementById('renameConfirm').addEventListener('click', confirmRename);
  document.getElementById('renameCancel').addEventListener('click', closeRenameModal);
  document.getElementById('renameReset').addEventListener('click', resetRename);
  document.getElementById('renameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') closeRenameModal();
  });
  document.getElementById('renameModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('renameModal')) closeRenameModal();
  });
  $addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmAdd();
    if (e.key === 'Escape') closeAddModal();
  });
  $addModal.addEventListener('click', (e) => {
    if (e.target === $addModal) closeAddModal();
  });

  // Settings
  $btnSettings.addEventListener('click', () => $settingsModal.style.display = 'flex');
  $settingsClose.addEventListener('click', () => $settingsModal.style.display = 'none');
  $settingsModal.addEventListener('click', (e) => {
    if (e.target === $settingsModal) $settingsModal.style.display = 'none';
  });
  $volumeSlider.addEventListener('input', (e) => {
    volume = parseInt(e.target.value) / 100;
    $volumeValue.textContent = `${e.target.value}%`;
  });
  $volumeSlider.addEventListener('change', (e) => {
    volume = parseInt(e.target.value) / 100;
    window.api.setVolume(volume);
  });
  $btnTestSound.addEventListener('click', () => playNotificationSound());

  // Notification position picker
  document.querySelectorAll('.position-btn').forEach(btn => {
    btn.addEventListener('click', () => setNotifPosition(btn.dataset.position));
  });

  // Shortcuts modal
  const $shortcutsModal = document.getElementById('shortcutsModal');
  const $shortcutsClose = document.getElementById('shortcutsClose');
  document.getElementById('btnShortcuts').addEventListener('click', () => $shortcutsModal.style.display = 'flex');
  $shortcutsClose.addEventListener('click', () => $shortcutsModal.style.display = 'none');
  $shortcutsModal.addEventListener('click', (e) => {
    if (e.target === $shortcutsModal) $shortcutsModal.style.display = 'none';
  });

  // Search input
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    render();
  });

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (openDropdown && !e.target.closest('.notif-dropdown') && !e.target.closest('.card-btn')) {
      closeDropdown();
    }
  });

  // Close context menu on any click
  document.addEventListener('click', () => hideContextMenu());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd+1-9: focus nth active session
    if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const sorted = getSortedSessions().filter(s => s.state.name !== 'completed');
      const idx = parseInt(e.key) - 1;
      if (sorted[idx]) handleFocus(sorted[idx].sessionId);
    }

    // Cmd+G: toggle grid/list view
    if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
      e.preventDefault();
      setView(viewMode === 'grid' ? 'compact' : 'grid');
    }

    // Cmd+P: toggle always-on-top (pin)
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault();
      togglePin();
    }

    // Cmd+F: toggle search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      const search = document.getElementById('searchInput');
      if (search.style.display === 'none') {
        search.style.display = 'block';
        search.focus();
      } else {
        search.style.display = 'none';
        search.value = '';
        searchQuery = '';
        render();
      }
    }

    // Cmd+? or Cmd+/: show shortcuts
    if ((e.metaKey || e.ctrlKey) && (e.key === '?' || e.key === '/')) {
      e.preventDefault();
      document.getElementById('shortcutsModal').style.display = 'flex';
    }

    // Escape: close modals/dropdowns
    if (e.key === 'Escape') {
      closeDropdown();
      closeAddModal();
      closeRenameModal();
      const settingsModal = document.getElementById('settingsModal');
      if (settingsModal) settingsModal.style.display = 'none';
      const shortcutsModal = document.getElementById('shortcutsModal');
      if (shortcutsModal) shortcutsModal.style.display = 'none';
    }
  });

  // Update durations every second
  setInterval(updateDurations, 1000);
}

// ═══ View switching ═══

function setView(mode) {
  viewMode = mode;
  window.api.setViewMode(mode);
  updateViewToggle();
  render();
}

function updateViewToggle() {
  $btnGrid.classList.toggle('active', viewMode === 'grid');
  $btnCompact.classList.toggle('active', viewMode === 'compact');
}

function togglePin() {
  alwaysOnTop = !alwaysOnTop;
  window.api.setAlwaysOnTop(alwaysOnTop);
  updatePinButton();
}

function updatePinButton() {
  $btnPin.classList.toggle('active', alwaysOnTop);
}


function updateFilterPills() {
  document.querySelectorAll('.status-filter .filter-chip').forEach(p => {
    p.classList.toggle('active', activeFilters.has(p.dataset.filter));
  });
  const clearBtn = document.getElementById('btnClearFilters');
  clearBtn.style.display = activeFilters.size > 0 ? 'inline-flex' : 'none';
}

function updateNotifPosition() {
  $notificationOverlay.setAttribute('data-position', notifPosition);
  document.querySelectorAll('.position-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.position === notifPosition);
  });
}

function setNotifPosition(pos) {
  notifPosition = pos;
  window.api.setNotifPosition(pos);
  updateNotifPosition();
}

// ═══ Rendering ═══

function render() {
  const count = sessions.size;
  const filtersActive = activeFilters.size > 0 || searchQuery;
  const visibleCount = getSortedSessions().length;

  const showNoSessions = count === 0;
  const showNoResults = count > 0 && visibleCount === 0;
  const showItems = visibleCount > 0;

  $emptyState.style.display = showNoSessions ? 'flex' : 'none';
  $emptyFiltered.style.display = showNoResults ? 'flex' : 'none';
  $gridView.style.display = showItems && viewMode === 'grid' ? 'grid' : 'none';
  $compactView.style.display = showItems && viewMode === 'compact' ? 'flex' : 'none';

  // Full rebuild — used for initial load, view switch, add/remove
  fullRender();
  updateStatusBar();
}

function fullRender() {
  const sorted = getSortedSessions();
  const container = viewMode === 'grid' ? $gridView : $compactView;
  const htmlFn = viewMode === 'grid' ? cardHTML : compactItemHTML;
  container.innerHTML = sorted.map(s => htmlFn(s)).join('');
}

function updateSession(s) {
  // Targeted update: find the existing element and patch it in place
  const container = viewMode === 'grid' ? $gridView : $compactView;
  const selector = `[data-session="${s.sessionId}"]`;
  const existing = container.querySelector(selector);

  if (!existing) {
    // New session — need full re-render to place it correctly
    fullRender();
    return;
  }

  const stateName = s.state.name;
  const oldState = existing.dataset.state;

  // If completed status changed, re-render to reorder (completed goes to bottom)
  if ((oldState === 'completed') !== (stateName === 'completed')) {
    fullRender();
    return;
  }

  // Patch in place — replace the element's HTML
  const htmlFn = viewMode === 'grid' ? cardHTML : compactItemHTML;
  const temp = document.createElement('div');
  temp.innerHTML = htmlFn(s);
  const newEl = temp.firstElementChild;

  // Trigger state-changed animation if state actually changed
  if (oldState !== stateName) {
    newEl.classList.add('state-changed');
    newEl.addEventListener('animationend', () => newEl.classList.remove('state-changed'), { once: true });
  }

  existing.replaceWith(newEl);

  updateStatusBar();
}

function removeSessionFromDOM(sessionId) {
  for (const container of [$gridView, $compactView]) {
    const el = container.querySelector(`[data-session="${sessionId}"]`);
    if (el) el.remove();
  }
  // Re-render empty states if needed
  render();
}

function getSortedSessions() {
  let arr = Array.from(sessions.values());

  // Filter by search query
  if (searchQuery) {
    arr = arr.filter(s =>
      s.projectName.toLowerCase().includes(searchQuery) ||
      (s.slug || '').toLowerCase().includes(searchQuery) ||
      (s.gitBranch || '').toLowerCase().includes(searchQuery)
    );
  }

  // Filter by active filter pills (multi-select, OR logic)
  if (activeFilters.size > 0) {
    arr = arr.filter(s => {
      const name = s.state.name;
      if (activeFilters.has('active') && (name === 'running' || name === 'thinking')) return true;
      if (activeFilters.has('waiting') && name === 'waiting') return true;
      if (activeFilters.has('completed') && name === 'completed') return true;
      return false;
    });
  }


  // Separate completed from active
  const active = arr.filter(s => s.state.name !== 'completed');
  const completed = arr.filter(s => s.state.name === 'completed');

  // Sort active sessions by user-defined order, then by start time for new ones
  active.sort((a, b) => {
    const ai = sessionOrder.indexOf(a.sessionId);
    const bi = sessionOrder.indexOf(b.sessionId);
    // Both in order list — use that order
    if (ai !== -1 && bi !== -1) return ai - bi;
    // Only one in list — the one in the list comes first
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    // Neither in list — newest first
    return new Date(b.startedAt) - new Date(a.startedAt);
  });

  // Completed always at bottom, newest first
  completed.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  return [...active, ...completed];
}

function cardHTML(s) {
  const stateName = s.state.name;
  const stateLabel = s.state.label;
  const duration = formatDuration(s.startedAt);
  const tokens = formatTokens(s.tokens);
  const sid = escAttr(s.sessionId);

  return `
    <div class="card" data-state="${stateName}" data-session="${sid}"
         draggable="${stateName !== 'completed' && !searchQuery}"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)"
         oncontextmenu="showContextMenu(event, '${sid}')"
         ondblclick="handleFocus('${sid}')">
      <div class="card-header">
        <div class="card-title">
          <div class="project-name">${esc(s.customName || s.projectName)}</div>
          <div class="session-slug" onclick="handleCopyId('${sid}', event)" title="Copier le session ID">
            ${esc(s.slug || s.sessionId.slice(0, 8))}
            <span class="copy-icon">${ICONS.copy}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="card-btn" onclick="toggleNotifDropdown(event, '${sid}')" title="Notifications">
            ${ICONS.bell}
          </button>
          <button class="card-btn" onclick="handleFocus('${sid}')" title="Focus terminal">
            ${ICONS.terminal}
          </button>
          ${s.remoteUrl ? `<button class="card-btn remote-active" onclick="handleOpenRemote('${escAttr(s.remoteUrl)}')" title="Ouvrir remote control">
            ${ICONS.globe}
          </button>` : ''}
          ${stateName === 'completed' ? `<button class="card-btn" onclick="handleResume('${sid}')" title="Reprendre la session">
            ${ICONS.play}
          </button>
          <button class="card-btn" onclick="handleRemove('${sid}')" title="Supprimer">
            ${ICONS.x}
          </button>` : ''}
          <button class="card-btn" onclick="showContextMenu(event, '${sid}')" title="Plus d'options">
            ${ICONS.moreVertical}
          </button>
        </div>
      </div>
      <div class="state-badge ${stateName}">
        ${(stateName === 'running' || stateName === 'thinking') ? '<span class="spinner"></span>' : '<span class="dot"></span>'}
        ${stateLabel}
        ${s.maybeStuck ? `<span class="stuck-hint" title="Possible action requise">${ICONS.alertTriangle}</span>` : ''}
      </div>
      <div class="card-details">
        <div class="detail">
          <span class="detail-label">Outil</span>
          <span class="detail-value">${(stateName === 'running' || stateName === 'thinking') ? toolPill(s.lastTool) : toolPill(null)}</span>
        </div>
        <div class="detail">
          <span class="detail-label">Durée</span>
          <span class="detail-value ${stateName !== 'completed' ? 'duration-value' : ''}" ${stateName !== 'completed' ? `data-started="${s.startedAt}"` : ''}>${stateName === 'completed' && s.endedAt ? formatDuration(s.startedAt, s.endedAt) : duration}</span>
        </div>
        <div class="detail">
          <span class="detail-label">Tokens</span>
          <span class="detail-value">${tokens}</span>
        </div>
        <div class="detail">
          <span class="detail-label">Modèle</span>
          <span class="detail-value">${formatModel(s.model)}</span>
        </div>
        <div class="detail">
          <span class="detail-label">Branche</span>
          <span class="detail-value branch-value">${esc(s.gitBranch || '—')}</span>
        </div>
      </div>
    </div>
  `;
}

function compactItemHTML(s) {
  const stateName = s.state.name;
  const sid = escAttr(s.sessionId);
  const isActive = stateName === 'running' || stateName === 'thinking';

  return `
    <div class="compact-item" data-state="${stateName}" data-session="${sid}"
         draggable="${stateName !== 'completed' && !searchQuery}"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)"
         oncontextmenu="showContextMenu(event, '${sid}')"
         ondblclick="handleFocus('${sid}')">
      ${isActive ? '<span class="compact-spinner"></span>' : '<span class="compact-dot"></span>'}
      <div class="project-name">${esc(s.customName || s.projectName)}</div>
      <div class="compact-actions">
        <button class="card-btn" onclick="event.stopPropagation(); handleFocus('${sid}')" title="Focus terminal">
          ${ICONS.terminal}
        </button>
        ${s.remoteUrl ? `<button class="card-btn remote-active" onclick="event.stopPropagation(); handleOpenRemote('${escAttr(s.remoteUrl)}')" title="Remote">
          ${ICONS.globe}
        </button>` : ''}
        <button class="card-btn" onclick="event.stopPropagation(); toggleNotifDropdown(event, '${sid}')" title="Notifications">
          ${ICONS.bell}
        </button>
        ${stateName === 'completed' ? `<button class="card-btn" onclick="event.stopPropagation(); handleResume('${sid}')" title="Reprendre">
          ${ICONS.play}
        </button>
        <button class="card-btn" onclick="event.stopPropagation(); handleRemove('${sid}')" title="Supprimer">
          ${ICONS.x}
        </button>` : ''}
        <button class="card-btn" onclick="event.stopPropagation(); showContextMenu(event, '${sid}')" title="Plus d'options">
          ${ICONS.moreVertical}
        </button>
      </div>
    </div>
  `;
}

// ═══ Duration updates ═══

function updateDurations() {
  document.querySelectorAll('.duration-value').forEach(el => {
    const started = el.dataset.started;
    if (started) el.textContent = formatDuration(started);
  });
}

// ═══ Focus terminal ═══

function handleFocus(sessionId) {
  window.api.focusTerminal(sessionId);
}

// ═══ Resume session ═══

function handleResume(sessionId) {
  window.api.resumeSession(sessionId);
}

// ═══ Open remote ═══

function handleOpenRemote(url) {
  window.api.openRemote(url);
}

// ═══ Rename session ═══

let renamingId = null;

function renameSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  renamingId = sessionId;
  const modal = document.getElementById('renameModal');
  const input = document.getElementById('renameInput');
  input.value = s.customName || s.projectName;
  input.placeholder = s.projectName;
  modal.style.display = 'flex';
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function confirmRename() {
  if (!renamingId) return;
  const s = sessions.get(renamingId);
  const input = document.getElementById('renameInput');
  const name = input.value.trim();
  // If empty or matches project name, clear custom name
  const nameToSet = (!name || (s && name === s.projectName)) ? '' : name;
  window.api.setCustomName(renamingId, nameToSet);
  closeRenameModal();
}

function resetRename() {
  if (!renamingId) return;
  window.api.setCustomName(renamingId, '');
  closeRenameModal();
}

function closeRenameModal() {
  document.getElementById('renameModal').style.display = 'none';
  renamingId = null;
}

// ═══ Copy session ID ═══

function handleCopyId(sessionId, event) {
  event.stopPropagation();
  navigator.clipboard.writeText(sessionId).then(() => {
    const el = event.currentTarget;
    const original = el.innerHTML;
    el.innerHTML = `<span style="color: var(--state-running)">✓ Copié</span>`;
    setTimeout(() => { el.innerHTML = original; }, 1200);
  }).catch(() => {});
}

// ═══ Remove session ═══

function handleRemove(sessionId) {
  window.api.removeSession(sessionId);
}

// ═══ Notifications ═══

async function toggleNotifDropdown(event, sessionId) {
  event.stopPropagation();
  closeDropdown();

  const btn = event.currentTarget;
  const card = btn.closest('.card, .compact-item');
  if (!card) return;

  const prefs = await window.api.getNotificationPrefs(sessionId);

  const dropdown = document.createElement('div');
  dropdown.className = 'notif-dropdown';
  dropdown.innerHTML = `
    <div class="notif-option" onclick="toggleNotifPref(event, '${sessionId}', 'modal')">
      <div class="notif-toggle ${prefs.modal ? 'on' : ''}" data-pref="modal"></div>
      <span>Modal in-app</span>
    </div>
    <div class="notif-option" onclick="toggleNotifPref(event, '${sessionId}', 'sound')">
      <div class="notif-toggle ${prefs.sound ? 'on' : ''}" data-pref="sound"></div>
      <span>Son</span>
    </div>
  `;

  btn.style.position = 'relative';
  btn.appendChild(dropdown);
  openDropdown = dropdown;
}

function closeDropdown() {
  if (openDropdown) {
    openDropdown.remove();
    openDropdown = null;
  }
}

async function toggleNotifPref(event, sessionId, pref) {
  event.stopPropagation();
  const toggle = event.currentTarget.querySelector('.notif-toggle');
  const isOn = toggle.classList.toggle('on');
  await window.api.setNotificationPrefs(sessionId, { [pref]: isOn });
  // Preview sound when enabling
  if (pref === 'sound' && isOn) {
    playNotificationSound();
  }
}

// ═══ Toast notifications ═══

const TOAST_DURATION = 10000;

function showToast(data) {
  const sid = escAttr(data.sessionId);
  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-header">
        <strong>${esc(data.projectName)}</strong>
        <button class="toast-close" onclick="this.closest('.notification-toast').remove();">${ICONS.x}</button>
      </div>
      <div class="toast-body">
        <span class="state-badge waiting">
          <span class="dot"></span>
          En attente
        </span>
        <span class="toast-slug">${esc(data.slug || '')}</span>
      </div>
      <div class="toast-actions">
        <button class="toast-focus-btn" onclick="handleFocus('${sid}'); this.closest('.notification-toast').remove();">
          ${ICONS.terminal} Focus terminal
        </button>
      </div>
    </div>
    <div class="toast-timer"></div>
  `;
  $notificationOverlay.appendChild(toast);

  // Start timer animation
  const timerEl = toast.querySelector('.toast-timer');
  timerEl.style.animationDuration = `${TOAST_DURATION}ms`;

  // Auto-dismiss
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
    }
  }, TOAST_DURATION);
}

// ═══ Sound ═══
// Generate chime WAV at startup — uses <audio> element so it follows
// the system audio routing (headphones, bluetooth, etc.)

function generateChimeWav() {
  const sampleRate = 44100;
  const duration = 0.4;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(numSamples);

  const notes = [
    { freq: 1047, start: 0, dur: 0.15 },     // C6
    { freq: 1319, start: 0.12, dur: 0.25 },   // E6
  ];

  for (const note of notes) {
    const startSample = Math.floor(note.start * sampleRate);
    const endSample = Math.min(startSample + Math.floor(note.dur * sampleRate), numSamples);
    for (let i = startSample; i < endSample; i++) {
      const t = (i - startSample) / sampleRate;
      const envelope = Math.exp(-t * 12) * Math.min(t * 50, 1); // fast attack, smooth decay
      buffer[i] += Math.sin(2 * Math.PI * note.freq * t) * envelope;
    }
  }

  // Encode as 16-bit PCM WAV
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const wav = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(wav);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, buffer[i]));
    view.setInt16(headerSize + i * 2, clamped * 0x7FFF, true);
  }

  const blob = new Blob([wav], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

const chimeUrl = generateChimeWav();

async function getDefaultOutputDeviceId() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    // The device marked "default" or the first one
    const def = outputs.find(d => d.deviceId === 'default') || outputs[0];
    return def ? def.deviceId : '';
  } catch (e) {
    return '';
  }
}

async function playNotificationSound() {
  try {
    const audio = new Audio(chimeUrl);
    audio.volume = volume;
    // Route to the current default output device (headphones, bluetooth, etc.)
    const deviceId = await getDefaultOutputDeviceId();
    if (deviceId && audio.setSinkId) {
      await audio.setSinkId(deviceId);
    }
    await audio.play();
  } catch (e) {
    console.error('Audio error:', e);
  }
}

// ═══ Add session modal ═══

function closeAddModal() {
  $addModal.style.display = 'none';
  $addInput.value = '';
}

async function confirmAdd() {
  const value = $addInput.value.trim();
  if (!value) return;

  // If it looks like a directory path, launch a new session there
  if (!value.endsWith('.jsonl') && !value.match(/^[a-f0-9-]{36}$/i) && value.startsWith('/')) {
    window.api.launchSession(value);
    closeAddModal();
    return;
  }

  const success = await window.api.addSession(value);
  if (success) {
    closeAddModal();
  } else {
    $addInput.style.borderColor = '#ef4444';
    setTimeout(() => $addInput.style.borderColor = '', 1500);
  }
}

// ═══ Helpers ═══

function formatDuration(startedAt, endedAt) {
  if (!startedAt) return '—';
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  if (ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

function formatModel(model) {
  if (!model) return '—';
  // "claude-opus-4-6" → "Opus 4.6"
  // "claude-sonnet-4-6" → "Sonnet 4.6"
  // "claude-haiku-4-5-20251001" → "Haiku 4.5"
  const m = model.replace('claude-', '');
  const match = m.match(/^(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (match) {
    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    return `${name} ${match[2]}.${match[3]}`;
  }
  return model;
}

function formatTokens(tokens) {
  if (!tokens) return '—';
  const total = (tokens.input || 0) + (tokens.output || 0);
  if (total === 0) return '—';
  if (total >= 1000000) return `${(total / 1000000).toFixed(1)}M`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}

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

const TOOL_CATEGORIES = {
  // Terminal — green
  Bash: { color: '#22c55e', label: 'Bash' },
  // Read — blue
  Read: { color: '#3b82f6', label: 'Read' },
  Glob: { color: '#3b82f6', label: 'Glob' },
  Grep: { color: '#3b82f6', label: 'Grep' },
  WebSearch: { color: '#3b82f6', label: 'Search' },
  WebFetch: { color: '#3b82f6', label: 'Fetch' },
  // Write — amber
  Edit: { color: '#f59e0b', label: 'Edit' },
  Write: { color: '#f59e0b', label: 'Write' },
  NotebookEdit: { color: '#f59e0b', label: 'Notebook' },
  // Delegation — purple
  Agent: { color: '#a78bfa', label: 'Agent' },
  Skill: { color: '#a78bfa', label: 'Skill' },
  // Tasks — cyan
  TaskCreate: { color: '#06b6d4', label: 'Task' },
  TaskUpdate: { color: '#06b6d4', label: 'Task' },
  TodoWrite: { color: '#06b6d4', label: 'Todo' },
};

function toolPill(toolName) {
  if (!toolName) return '<span class="tool-pill tool-none">—</span>';
  const cat = TOOL_CATEGORIES[toolName] || { color: '#6b7280', label: toolName };
  return `<span class="tool-pill" style="--tool-color: ${cat.color}">${esc(cat.label)}</span>`;
}

// ═══ Drag & Drop ═══

function onDragStart(e) {
  const el = e.target.closest('[data-session]');
  if (!el || el.dataset.state === 'completed') { e.preventDefault(); return; }
  draggedId = el.dataset.session;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedId);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.target.closest('[data-session]');
  if (!target || target.dataset.session === draggedId || target.dataset.state === 'completed') return;

  const container = target.parentElement;
  const dragged = container.querySelector(`[data-session="${draggedId}"]`);
  if (!dragged) return;

  const rect = target.getBoundingClientRect();
  const isGrid = viewMode === 'grid';
  const mid = isGrid
    ? rect.left + rect.width / 2
    : rect.top + rect.height / 2;
  const pos = isGrid ? e.clientX : e.clientY;

  if (pos < mid) {
    container.insertBefore(dragged, target);
  } else {
    container.insertBefore(dragged, target.nextSibling);
  }
}

function onDrop(e) {
  e.preventDefault();
  saveCurrentOrder();
}

function onDragEnd(e) {
  const el = e.target.closest('[data-session]');
  if (el) el.classList.remove('dragging');
  draggedId = null;
  saveCurrentOrder();
}

function saveCurrentOrder() {
  const container = viewMode === 'grid' ? $gridView : $compactView;
  const items = container.querySelectorAll('[data-session]');
  sessionOrder = Array.from(items)
    .map(el => el.dataset.session)
    .filter(id => {
      const s = sessions.get(id);
      return s && s.state.name !== 'completed';
    });
  window.api.setSessionOrder(sessionOrder);
}

// ═══ Status bar ═══

function updateStatusBar() {
  const all = Array.from(sessions.values());
  const active = all.filter(s => s.state.name !== 'completed');
  const waiting = all.filter(s => s.state.name === 'waiting');
  const totalInput = all.reduce((sum, s) => sum + (s.tokens?.input || 0), 0);
  const totalOutput = all.reduce((sum, s) => sum + (s.tokens?.output || 0), 0);

  // Show filtered count when filters are active
  const filtersActive = activeFilters.size > 0 || searchQuery;
  const visibleCount = filtersActive ? getSortedSessions().length : all.length;

  const activeLabel = filtersActive
    ? `${visibleCount}/${all.length} affichées`
    : `${active.length} active${active.length !== 1 ? 's' : ''}`;

  document.getElementById('statActive').textContent = activeLabel;
  document.getElementById('statWaiting').textContent = `${waiting.length} en attente`;
  document.getElementById('statTokens').textContent = `${formatTokens({ input: totalInput, output: totalOutput })} tokens`;
}

// ═══ Context menu ═══

function showContextMenu(e, sessionId) {
  e.preventDefault();
  e.stopPropagation();
  const s = sessions.get(sessionId);
  if (!s) return;
  const sid = escAttr(sessionId);
  const menu = document.getElementById('contextMenu');
  const stateName = s.state.name;

  let items = `
    <div class="context-menu-item" onclick="handleFocus('${sid}'); hideContextMenu();">${ICONS.terminal} Focus terminal</div>
    <div class="context-menu-item" onclick="renameSession('${sid}'); hideContextMenu();">${ICONS.edit} Renommer</div>
  `;
  if (s.remoteUrl) {
    items += `<div class="context-menu-item" onclick="handleOpenRemote('${escAttr(s.remoteUrl)}'); hideContextMenu();">${ICONS.globe} Ouvrir remote</div>`;
  }
  items += `<div class="context-menu-sep"></div>`;
  if (stateName === 'completed') {
    items += `
      <div class="context-menu-item" onclick="handleResume('${sid}'); hideContextMenu();">${ICONS.play} Reprendre</div>
      <div class="context-menu-item" onclick="handleRemove('${sid}'); hideContextMenu();">${ICONS.x} Supprimer</div>
    `;
  }

  menu.innerHTML = items;
  menu.style.display = 'block';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10)}px`;
}

function hideContextMenu() {
  document.getElementById('contextMenu').style.display = 'none';
}

// ═══ Start ═══

init();
