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
};

const sessions = new Map();
let viewMode = 'grid';
let alwaysOnTop = false;
let volume = 0.7;
let openDropdown = null;
let searchQuery = '';
let sessionOrder = []; // User-defined order of session IDs
let draggedId = null;

// ═══ DOM refs ═══

const $content = document.getElementById('content');
const $emptyState = document.getElementById('emptyState');
const $gridView = document.getElementById('gridView');
const $listView = document.getElementById('listView');
const $sessionCount = document.getElementById('sessionCount');
const $btnGrid = document.getElementById('btnGrid');
const $btnList = document.getElementById('btnList');
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
  alwaysOnTop = config.alwaysOnTop || false;
  volume = config.volume ?? 0.7;
  sessionOrder = config.sessionOrder || [];

  updateViewToggle();
  updatePinButton();
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
  $btnList.addEventListener('click', () => setView('list'));
  $btnPin.addEventListener('click', togglePin);
  $btnAdd.addEventListener('click', () => $addModal.style.display = 'flex');
  $addCancel.addEventListener('click', closeAddModal);
  $addConfirm.addEventListener('click', confirmAdd);
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

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd+1-9: focus nth active session
    if (e.metaKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const sorted = getSortedSessions().filter(s => s.state.name !== 'completed');
      const idx = parseInt(e.key) - 1;
      if (sorted[idx]) handleFocus(sorted[idx].sessionId);
    }

    // Cmd+G: toggle grid/list view
    if (e.metaKey && e.key === 'g') {
      e.preventDefault();
      setView(viewMode === 'grid' ? 'list' : 'grid');
    }

    // Cmd+P: toggle always-on-top (pin)
    if (e.metaKey && e.key === 'p') {
      e.preventDefault();
      togglePin();
    }

    // Cmd+F: toggle search
    if (e.metaKey && e.key === 'f') {
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

    // Escape: close modals/dropdowns
    if (e.key === 'Escape') {
      closeDropdown();
      closeAddModal();
      const settingsModal = document.getElementById('settingsModal');
      if (settingsModal) settingsModal.style.display = 'none';
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
  $btnList.classList.toggle('active', viewMode === 'list');
}

function togglePin() {
  alwaysOnTop = !alwaysOnTop;
  window.api.setAlwaysOnTop(alwaysOnTop);
  updatePinButton();
}

function updatePinButton() {
  $btnPin.classList.toggle('active', alwaysOnTop);
}

// ═══ Rendering ═══

function render() {
  const count = sessions.size;
  $sessionCount.textContent = `${count} session${count !== 1 ? 's' : ''}`;

  const hasItems = count > 0;
  $emptyState.style.display = hasItems ? 'none' : 'flex';
  $gridView.style.display = hasItems && viewMode === 'grid' ? 'grid' : 'none';
  $listView.style.display = hasItems && viewMode === 'list' ? 'flex' : 'none';

  // Full rebuild — used for initial load, view switch, add/remove
  fullRender();
  updateStatusBar();
}

function fullRender() {
  const sorted = getSortedSessions();
  const container = viewMode === 'grid' ? $gridView : $listView;
  const htmlFn = viewMode === 'grid' ? cardHTML : listItemHTML;
  container.innerHTML = sorted.map(s => htmlFn(s)).join('');
}

function updateSession(s) {
  // Targeted update: find the existing element and patch it in place
  const container = viewMode === 'grid' ? $gridView : $listView;
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
  const htmlFn = viewMode === 'grid' ? cardHTML : listItemHTML;
  const temp = document.createElement('div');
  temp.innerHTML = htmlFn(s);
  const newEl = temp.firstElementChild;
  existing.replaceWith(newEl);

  // Update session count
  $sessionCount.textContent = `${sessions.size} session${sessions.size !== 1 ? 's' : ''}`;
  updateStatusBar();
}

function removeSessionFromDOM(sessionId) {
  for (const container of [$gridView, $listView]) {
    const el = container.querySelector(`[data-session="${sessionId}"]`);
    if (el) el.remove();
  }
  const count = sessions.size;
  $sessionCount.textContent = `${count} session${count !== 1 ? 's' : ''}`;
  if (count === 0) {
    $emptyState.style.display = 'flex';
    $gridView.style.display = 'none';
    $listView.style.display = 'none';
  }
  updateStatusBar();
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
         draggable="${stateName !== 'completed'}"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)">
      <div class="card-header">
        <div class="card-title">
          <div class="project-name">${esc(s.projectName)}</div>
          <div class="session-slug">${esc(s.slug || s.sessionId.slice(0, 8))}</div>
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
        </div>
      </div>
      <div class="state-badge ${stateName}">
        <span class="dot"></span>
        ${stateLabel}
      </div>
      ${s.lastMessage ? `<div class="card-preview">${esc(s.lastMessage)}</div>` : ''}
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
          <span class="detail-label">Coût</span>
          <span class="detail-value">${formatCost(s.tokens, s.model)}</span>
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

function listItemHTML(s) {
  const stateName = s.state.name;
  const duration = formatDuration(s.startedAt);
  const sid = escAttr(s.sessionId);

  return `
    <div class="list-item" data-state="${stateName}" data-session="${sid}"
         draggable="${stateName !== 'completed'}"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)">
      <div class="state-dot"></div>
      <div class="project-name">${esc(s.projectName)}</div>
      <span class="last-tool">${(stateName === 'running' || stateName === 'thinking') ? toolPill(s.lastTool) : toolPill(null)}</span>
      <span class="duration ${stateName !== 'completed' ? 'duration-value' : ''}" ${stateName !== 'completed' ? `data-started="${s.startedAt}"` : ''}>${stateName === 'completed' && s.endedAt ? formatDuration(s.startedAt, s.endedAt) : duration}</span>
      <div class="list-actions">
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

// ═══ Remove session ═══

function handleRemove(sessionId) {
  window.api.removeSession(sessionId);
}

// ═══ Notifications ═══

async function toggleNotifDropdown(event, sessionId) {
  event.stopPropagation();
  closeDropdown();

  const btn = event.currentTarget;
  const card = btn.closest('.card') || btn.closest('.list-item');
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

function formatCost(tokens, model) {
  if (!tokens) return '—';
  const input = tokens.input || 0;
  const output = tokens.output || 0;
  if (input === 0 && output === 0) return '—';

  // Pricing per 1M tokens (USD)
  const pricing = {
    'opus': { input: 15, output: 75 },
    'sonnet': { input: 3, output: 15 },
    'haiku': { input: 0.25, output: 1.25 },
  };

  let tier = pricing.sonnet; // default
  if (model) {
    const m = model.toLowerCase();
    if (m.includes('opus')) tier = pricing.opus;
    else if (m.includes('haiku')) tier = pricing.haiku;
    else if (m.includes('sonnet')) tier = pricing.sonnet;
  }

  const cost = (input * tier.input + output * tier.output) / 1000000;
  if (cost < 0.01) return '<$0.01';
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(1)}`;
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
  const container = viewMode === 'grid' ? $gridView : $listView;
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
  const active = all.filter(s => !['completed', 'idle'].includes(s.state.name));
  const waiting = all.filter(s => s.state.name === 'waiting');
  const totalInput = all.reduce((sum, s) => sum + (s.tokens?.input || 0), 0);
  const totalOutput = all.reduce((sum, s) => sum + (s.tokens?.output || 0), 0);

  let totalCost = 0;
  for (const s of all) {
    const inp = s.tokens?.input || 0;
    const out = s.tokens?.output || 0;
    const m = (s.model || '').toLowerCase();
    let rate = { input: 3, output: 15 };
    if (m.includes('opus')) rate = { input: 15, output: 75 };
    else if (m.includes('haiku')) rate = { input: 0.25, output: 1.25 };
    totalCost += (inp * rate.input + out * rate.output) / 1000000;
  }

  document.getElementById('statActive').textContent = `${active.length} active${active.length !== 1 ? 's' : ''}`;
  document.getElementById('statWaiting').textContent = `${waiting.length} en attente`;
  document.getElementById('statTokens').textContent = `${formatTokens({ input: totalInput, output: totalOutput })} tokens`;
  document.getElementById('statCost').textContent = totalCost < 0.01 ? '$0.00' : `$${totalCost.toFixed(2)}`;
}

// ═══ Start ═══

init();
