// ═══════════════════════════════════════════════
// Aby Claude Watcher — Renderer
// ═══════════════════════════════════════════════

// Lucide-style SVG icons (24x24 viewBox, stroke-based)
const ICONS = {
  bell: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  bellRing: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M2 8c0-2.2.7-4.3 2-6"/><path d="M22 8a10 10 0 0 0-2-6"/></svg>`,
  bellOff: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
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
  branch: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
  wrench: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
};

const sessions = new Map();
let viewMode = 'grid'; // 'grid' | 'compact' | 'micro'
let previousViewMode = 'grid'; // remembered when entering micro so Back can restore
let alwaysOnTop = false;
let volume = 0.7;
let notifPosition = 'top-right';
let autoLaunch = false;
let windowTransparencyEnabled = false;
let windowOpacity = 0.85;
let vibrancyExperimental = false;
let searchQuery = '';
let sessionOrder = []; // User-defined order of session IDs
let draggedId = null;
let backgroundCollapsed = false; // "Background" section folded — persisted in config

// ═══ DOM refs ═══

const $content = document.getElementById('content');
const $emptyState = document.getElementById('emptyState');
const $emptyFiltered = document.getElementById('emptyFiltered');
const $gridView = document.getElementById('gridView');
const $compactView = document.getElementById('compactView');
const $microView = document.getElementById('microView');
const $microToolbar = document.getElementById('microToolbar');
const $btnGrid = document.getElementById('btnGrid');
const $btnCompact = document.getElementById('btnCompact');
const $btnMicro = document.getElementById('btnMicro');
const $btnBack = document.getElementById('btnBack');
const $btnPinMicro = document.getElementById('btnPinMicro');
const $btnPin = document.getElementById('btnPin');
const $notificationOverlay = document.getElementById('notificationOverlay');
const $btnSettings = document.getElementById('btnSettings');
const $settingsModal = document.getElementById('settingsModal');
const $settingsClose = document.getElementById('settingsClose');
const $volumeSlider = document.getElementById('volumeSlider');
const $volumeValue = document.getElementById('volumeValue');
const $btnTestSound = document.getElementById('btnTestSound');
const $transparencyToggle = document.getElementById('transparencyToggle');
const $opacitySlider = document.getElementById('opacitySlider');
const $opacityValue = document.getElementById('opacityValue');
const $opacityRow = document.getElementById('opacityRow');
const $vibrancyToggle = document.getElementById('vibrancyToggle');
const $vibrancyRestartHint = document.getElementById('vibrancyRestartHint');

// ═══ Init ═══

async function init() {
  // Apply language first so all static strings render correctly
  const lang = await window.api.getLanguage();
  window.i18n.setLanguage(lang);
  applyI18n();

  const config = await window.api.getConfig();
  viewMode = config.viewMode || 'grid';
  // Migration: old 'list' → 'compact'
  if (viewMode === 'list' || config.compactMode) viewMode = 'compact';
  if (viewMode !== 'grid' && viewMode !== 'compact' && viewMode !== 'micro') viewMode = 'grid';
  previousViewMode = (viewMode === 'micro') ? 'grid' : viewMode;
  alwaysOnTop = config.alwaysOnTop || false;
  volume = config.volume ?? 0.7;
  notifPosition = config.notifPosition || 'top-right';
  autoLaunch = !!config.autoLaunch;
  windowTransparencyEnabled = !!config.windowTransparencyEnabled;
  windowOpacity = config.windowOpacity ?? 0.85;
  vibrancyExperimental = !!config.vibrancyExperimental;
  sessionOrder = config.sessionOrder || [];
  backgroundCollapsed = !!config.backgroundSectionCollapsed;
  soundTheme = SOUND_THEMES[config.soundTheme] ? config.soundTheme : 'default';
  regenerateSounds();
  updateSoundThemePicker();

  // applyMicroMode needs alwaysOnTop set so the pin buttons render the right state.
  // It also calls updatePinButton + updateMicroPinButton internally, so we don't repeat them here.
  applyMicroMode();
  updateViewToggle();
  updateNotifPosition();
  updateAutoLaunchToggle();
  $volumeSlider.value = Math.round(volume * 100);
  $volumeValue.textContent = `${Math.round(volume * 100)}%`;
  updateTransparencyControls();
  updateVibrancyControls();

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
    // Skip the in-app toast in micro mode — the whole window is too small
    // for a modal overlay. The pulsing waiting dot is enough signal.
    if (viewMode === 'micro') return;
    // Grid view keeps the bell-gated semantics. Compact always shows the
    // toast — the bell there only controls sound + OS notif.
    if (viewMode === 'grid') {
      const s = sessions.get(data.sessionId);
      if (!s || !s.notifEnabled) return;
    }
    showToast(data);
  });

  window.api.onPlaySound((data) => {
    playNotificationSound();
    const sid = data && data.sessionId;
    const kind = (data && data.kind) || 'waiting';
    // workflow-done = info ponctuelle, pas un "needs you" → pas de cloche persistante
    if (sid && kind !== 'workflow-done') setBell(sid, kind);
  });

  const initialUsage = await window.api.getUsage();
  if (initialUsage) renderUsage(initialUsage);
  window.api.onUsageUpdate(renderUsage);
  window.api.onUsageError(handleUsageError);

  // Toolbar
  $btnGrid.addEventListener('click', () => setView('grid'));
  $btnCompact.addEventListener('click', () => setView('compact'));
  $btnMicro.addEventListener('click', () => setView('micro'));
  $btnBack.addEventListener('click', () => setView(previousViewMode || 'grid'));
  $btnPinMicro.addEventListener('click', togglePin);

  // Clear search from empty state
  document.getElementById('btnClearAllFilters').addEventListener('click', closeSearch);
  $btnPin.addEventListener('click', togglePin);

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

  // Window transparency
  if ($transparencyToggle) $transparencyToggle.addEventListener('click', toggleTransparency);
  // Vibrancy (EXPERIMENTAL, off by default, restart required to apply)
  if ($vibrancyToggle) $vibrancyToggle.addEventListener('click', toggleVibrancy);
  if ($opacitySlider) {
    $opacitySlider.addEventListener('input', (e) => {
      windowOpacity = parseInt(e.target.value) / 100;
      $opacityValue.textContent = `${e.target.value}%`;
      window.api.setWindowOpacity(windowOpacity); // live preview
    });
  }
  // Hover → opaque. A non-focused alwaysOnTop window still receives DOM
  // mouse events, so this drives the "opaque on hover" behaviour.
  document.documentElement.addEventListener('mouseenter', () => window.api.notifyHover(true));
  document.documentElement.addEventListener('mouseleave', () => window.api.notifyHover(false));

  // Sound theme picker
  document.querySelectorAll('.sound-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setSoundTheme(btn.dataset.theme));
  });
  const $btnTestTheme = document.getElementById('btnTestSoundTheme');
  if ($btnTestTheme) $btnTestTheme.addEventListener('click', testCurrentSoundTheme);

  // Notification position picker
  document.querySelectorAll('.position-btn').forEach(btn => {
    btn.addEventListener('click', () => setNotifPosition(btn.dataset.position));
  });

  // Auto-launch toggle
  const autoLaunchBtn = document.getElementById('autoLaunchToggle');
  if (autoLaunchBtn) autoLaunchBtn.addEventListener('click', toggleAutoLaunch);

  // Language picker
  document.querySelectorAll('.language-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      await window.api.setLanguage(lang);
    });
  });
  window.api.onLanguageChanged((lang) => {
    window.i18n.setLanguage(lang);
    applyI18n();
    // Re-render all sessions so state labels update
    render();
  });

  // Settings tabs
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.settings-panel').forEach(p => {
        p.style.display = p.dataset.panel === target ? 'block' : 'none';
      });
      if (target === 'about') loadAboutInfo();
    });
  });

  // About tab: update check + github link
  document.getElementById('btnCheckUpdate').addEventListener('click', () => checkForUpdate(true));
  document.getElementById('aboutGithub').addEventListener('click', async (e) => {
    e.preventDefault();
    const info = await window.api.getAppInfo();
    window.api.openExternalUrl(info.githubUrl);
  });
  document.getElementById('aboutWebsite').addEventListener('click', async (e) => {
    e.preventDefault();
    const info = await window.api.getAppInfo();
    window.api.openExternalUrl(info.websiteUrl);
  });

  // Update available event from main process
  window.api.onUpdateAvailable((info) => {
    lastUpdateResult = { ...info, status: 'update-available' };
    renderUpdateState();
    startUpdateRelativeTicker();
    showUpdateBanner(info);
  });

  window.api.onUpdateProgress((p) => {
    if (lastUpdateResult) {
      lastUpdateResult = { ...lastUpdateResult, status: 'downloading', percent: p.percent, received: p.received, total: p.total };
      renderUpdateState();
    }
    updateBannerProgress(p.percent);
  });

  window.api.onUpdateInstalling(() => {
    if (lastUpdateResult) {
      lastUpdateResult = { ...lastUpdateResult, status: 'installing' };
      renderUpdateState();
    }
    updateBannerInstalling();
  });

  window.api.onUpdateError((info) => {
    if (lastUpdateResult) {
      lastUpdateResult = { ...lastUpdateResult, status: 'install-error', error: info && info.message };
      renderUpdateState();
    }
    const btn = document.getElementById('updateDownload');
    if (btn) {
      btn.disabled = false;
      btn.textContent = t('update_install_failed');
    }
  });

  // About modal
  const $aboutModal = document.getElementById('aboutModal');
  const $aboutClose = document.getElementById('aboutClose');
  document.getElementById('btnAbout').addEventListener('click', () => $aboutModal.style.display = 'flex');
  $aboutClose.addEventListener('click', () => $aboutModal.style.display = 'none');
  $aboutModal.addEventListener('click', (e) => {
    if (e.target === $aboutModal) $aboutModal.style.display = 'none';
  });

  // Search input
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    render();
  });

  // Escape closes whichever modal/dropdown is open. The Cmd-* shortcuts
  // were removed in 1.5.7 — see CHANGELOG.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.style.display = 'none';
    const aboutModal = document.getElementById('aboutModal');
    if (aboutModal) aboutModal.style.display = 'none';
    // Dismiss any visible toasts
    Array.from($notificationOverlay.children).forEach(el => el.remove());
  });

  // Update durations every second
  setInterval(updateDurations, 1000);
}

// ═══ View switching ═══

function setView(mode) {
  // Save previous non-micro view so Back can return to it
  if (mode === 'micro' && viewMode !== 'micro') {
    previousViewMode = viewMode;
  }
  viewMode = mode;
  window.api.setViewMode(mode);
  updateViewToggle();
  applyMicroMode();
  render();
}

function updateViewToggle() {
  $btnGrid.classList.toggle('active', viewMode === 'grid');
  $btnCompact.classList.toggle('active', viewMode === 'compact');
  $btnMicro.classList.toggle('active', viewMode === 'micro');
}

function applyMicroMode() {
  const isMicro = viewMode === 'micro';
  document.body.classList.toggle('micro-mode', isMicro);
  $microToolbar.style.display = isMicro ? 'flex' : 'none';
  // Always sync both pin buttons so whichever toolbar is visible stays truthful
  updatePinButton();
  updateMicroPinButton();
}

function updateMicroPinButton() {
  if ($btnPinMicro) $btnPinMicro.classList.toggle('active', alwaysOnTop);
}

function togglePin() {
  alwaysOnTop = !alwaysOnTop;
  window.api.setAlwaysOnTop(alwaysOnTop);
  updatePinButton();
  updateMicroPinButton();
}

function updatePinButton() {
  $btnPin.classList.toggle('active', alwaysOnTop);
}

function closeSearch() {
  const search = document.getElementById('searchInput');
  search.style.display = 'none';
  search.value = '';
  searchQuery = '';
  render();
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

function updateSoundThemePicker() {
  document.querySelectorAll('.sound-theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === soundTheme);
  });
}

function setSoundTheme(theme) {
  if (!SOUND_THEMES[theme]) return;
  soundTheme = theme;
  regenerateSounds();
  updateSoundThemePicker();
  window.api.setSoundTheme(theme);
  playNotificationSound();
}

function testCurrentSoundTheme() {
  playNotificationSound();
}

function t(key, params) { return window.i18n.t(key, params); }

function applyI18n() {
  document.documentElement.lang = window.i18n.getLanguage();
  // Plain text: [data-i18n]
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // HTML text: [data-i18n-html]
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  // Titles (tooltips): [data-i18n-title]
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  // Placeholders: [data-i18n-placeholder]
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  // Update language picker active state
  document.querySelectorAll('.language-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === window.i18n.getLanguage());
  });
}

function updateAutoLaunchToggle() {
  const btn = document.getElementById('autoLaunchToggle');
  if (btn) {
    btn.classList.toggle('on', autoLaunch);
    btn.setAttribute('aria-checked', String(autoLaunch));
  }
}

function toggleAutoLaunch() {
  autoLaunch = !autoLaunch;
  window.api.setAutoLaunch(autoLaunch);
  updateAutoLaunchToggle();
}

function updateTransparencyControls() {
  if ($transparencyToggle) {
    $transparencyToggle.classList.toggle('on', windowTransparencyEnabled);
    $transparencyToggle.setAttribute('aria-checked', String(windowTransparencyEnabled));
  }
  if ($opacitySlider) {
    $opacitySlider.value = Math.round(windowOpacity * 100);
    $opacitySlider.disabled = !windowTransparencyEnabled;
  }
  if ($opacityValue) $opacityValue.textContent = `${Math.round(windowOpacity * 100)}%`;
  if ($opacityRow) $opacityRow.classList.toggle('disabled', !windowTransparencyEnabled);
}

function toggleTransparency() {
  windowTransparencyEnabled = !windowTransparencyEnabled;
  window.api.setWindowTransparencyEnabled(windowTransparencyEnabled);
  updateTransparencyControls();
}

function updateVibrancyControls() {
  if ($vibrancyToggle) {
    $vibrancyToggle.classList.toggle('on', vibrancyExperimental);
    $vibrancyToggle.setAttribute('aria-checked', String(vibrancyExperimental));
  }
}

function toggleVibrancy() {
  vibrancyExperimental = !vibrancyExperimental;
  window.api.setVibrancyExperimental(vibrancyExperimental);
  updateVibrancyControls();
  // Window material can't be swapped at runtime — surface the "restart to
  // apply" hint so the change isn't mistaken for a live preview.
  if ($vibrancyRestartHint) $vibrancyRestartHint.style.display = '';
}

// ═══ About + updates ═══

let lastUpdateResult = null;
let updateRelativeTimer = null;

async function loadAboutInfo() {
  const info = await window.api.getAppInfo();
  document.getElementById('aboutVersion').textContent = info.version;
  renderUpdateState();
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (sec < 45) return t('rel_just_now');
  if (min < 60) return t('rel_minutes_ago', { n: Math.max(1, min) });
  if (hour < 2) return t('rel_hour_ago');
  if (hour < 24) return t('rel_hours_ago', { n: hour });
  if (day < 2) return t('rel_day_ago');
  return t('rel_days_ago', { n: day });
}

function renderUpdateState() {
  const statusLabel = document.getElementById('updateStatusLabel');
  const statusHint = document.getElementById('updateStatusHint');
  if (!statusLabel || !statusHint) return;

  const result = lastUpdateResult;
  if (!result) {
    statusLabel.textContent = t('update_check_label');
    statusHint.textContent = t('update_check_hint');
    return;
  }

  const when = formatRelativeTime(result.lastCheck);

  if (result.status === 'update-available') {
    statusLabel.textContent = t('update_available', { version: result.latest });
    if (result.canAutoInstall) {
      statusHint.innerHTML = `<a href="#" class="update-link" data-action="install">${t('update_install_btn')}</a> · <a href="#" class="update-link-secondary" data-action="github">${t('update_open_github')}</a>`;
      statusHint.querySelector('[data-action="install"]').addEventListener('click', (e) => {
        e.preventDefault();
        startUpdateDownload(result);
      });
      statusHint.querySelector('[data-action="github"]').addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternalUrl(result.url);
      });
    } else {
      // Fallback: no DMG asset for this arch — link to GitHub.
      statusHint.innerHTML = `<a href="#" class="update-link">${t('update_download_link')}</a>`;
      statusHint.querySelector('.update-link').addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternalUrl(result.url);
      });
    }
  } else if (result.status === 'downloading') {
    const pct = Math.round(result.percent || 0);
    statusLabel.textContent = t('update_downloading', { percent: pct });
    statusHint.innerHTML = `<div class="update-progress"><div class="update-progress-bar" style="width:${pct}%"></div></div>`;
  } else if (result.status === 'installing') {
    statusLabel.textContent = t('update_installing');
    statusHint.textContent = '';
  } else if (result.status === 'install-error') {
    statusLabel.textContent = t('update_install_failed');
    statusHint.textContent = result.error || '';
  } else if (result.status === 'up-to-date') {
    statusLabel.textContent = t('update_up_to_date', { app: 'Aby Claude Watcher' });
    statusHint.textContent = t('update_up_to_date_hint', { version: result.current, when });
  } else if (result.status === 'no-releases') {
    statusLabel.textContent = t('update_no_releases');
    statusHint.textContent = t('update_no_releases_hint');
  } else if (result.status === 'rate-limited') {
    statusLabel.textContent = t('update_rate_limited');
    statusHint.textContent = t('update_rate_limited_hint', { when });
  } else if (result.status === 'checking') {
    statusLabel.textContent = t('update_checking');
    statusHint.textContent = t('update_checking_hint');
  } else {
    statusLabel.textContent = t('update_error');
    statusHint.textContent = result.error || t('update_error_hint');
  }
}

function startUpdateRelativeTicker() {
  if (updateRelativeTimer) return;
  updateRelativeTimer = setInterval(() => {
    if (!lastUpdateResult || !lastUpdateResult.lastCheck) return;
    const panel = document.querySelector('.settings-panel[data-panel="about"]');
    if (panel && panel.style.display !== 'none') renderUpdateState();
  }, 30000);
}

async function checkForUpdate(force) {
  lastUpdateResult = { status: 'checking' };
  renderUpdateState();

  const result = await window.api.checkUpdates(force);
  lastUpdateResult = result;
  renderUpdateState();
  startUpdateRelativeTicker();

  if (result.status === 'update-available') {
    showUpdateBanner(result);
  }
}

function showUpdateBanner(info) {
  const existing = document.getElementById('updateBanner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.className = 'update-banner';
  const btnLabel = info.canAutoInstall ? t('update_install_btn') : t('update_banner_download');
  banner.innerHTML = `
    <span class="update-banner-text">${t('update_available', { version: `<strong>${esc(info.latest)}</strong>` })}</span>
    <button class="update-banner-btn" id="updateDownload">${btnLabel}</button>
    <button class="update-banner-close" id="updateDismiss">${ICONS.x}</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('updateDownload').addEventListener('click', () => {
    if (info.canAutoInstall) {
      startUpdateDownload(info);
    } else {
      window.api.openExternalUrl(info.url);
    }
  });
  document.getElementById('updateDismiss').addEventListener('click', () => {
    banner.remove();
  });
}

function updateBannerProgress(percent) {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  const btn = document.getElementById('updateDownload');
  const text = banner.querySelector('.update-banner-text');
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('update_downloading', { percent: Math.round(percent) });
  }
  if (text) {
    text.innerHTML = `<div class="update-progress"><div class="update-progress-bar" style="width:${percent}%"></div></div>`;
  }
}

function updateBannerInstalling() {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  const btn = document.getElementById('updateDownload');
  const text = banner.querySelector('.update-banner-text');
  if (btn) { btn.disabled = true; btn.textContent = t('update_installing'); }
  if (text) text.textContent = '';
}

function startUpdateDownload(info) {
  // Move the settings panel into "downloading" state
  lastUpdateResult = { ...info, status: 'downloading', percent: 0 };
  renderUpdateState();
  updateBannerProgress(0);
  window.api.downloadUpdate(info);
}

// ═══ Rendering ═══

function getRenderableSessions() {
  return getSortedSessions();
}

function render() {
  const count = sessions.size;
  const visibleCount = getRenderableSessions().length;

  const showNoSessions = count === 0;
  const showNoResults = count > 0 && visibleCount === 0;
  const showItems = visibleCount > 0;

  $emptyState.style.display = showNoSessions ? 'flex' : 'none';
  $emptyFiltered.style.display = showNoResults ? 'flex' : 'none';
  $gridView.style.display = showItems && viewMode === 'grid' ? 'grid' : 'none';
  $compactView.style.display = showItems && viewMode === 'compact' ? 'grid' : 'none';
  $microView.style.display = showItems && viewMode === 'micro' ? 'flex' : 'none';

  // Full rebuild — used for initial load, view switch, add/remove
  fullRender();
  updateStatusBar();
}

function viewContainer() {
  if (viewMode === 'grid') return $gridView;
  if (viewMode === 'compact') return $compactView;
  return $microView;
}

function viewItemHTML() {
  if (viewMode === 'grid') return cardHTML;
  if (viewMode === 'compact') return compactItemHTML;
  return microItemHTML;
}

function fullRender() {
  const sorted = getRenderableSessions();
  const htmlFn = viewItemHTML();
  // Interactive sessions first, headless (claude -p) below under a
  // collapsible "Background" divider. Header only in grid/compact —
  // micro is too small, the partition order alone is enough there.
  const interactive = sorted.filter(s => !s.isBackground);
  const background = sorted.filter(s => s.isBackground);
  let html = interactive.map(s => htmlFn(s)).join('');
  if (background.length > 0) {
    if (viewMode !== 'micro') html += backgroundSectionHeaderHTML(background.length);
    if (viewMode === 'micro' || !backgroundCollapsed) {
      html += background.map(s => htmlFn(s)).join('');
    }
  }
  viewContainer().innerHTML = html;
  reapplyAllBells();
}

function backgroundSectionHeaderHTML(count) {
  return `
    <div class="bg-section-header${backgroundCollapsed ? ' collapsed' : ''}" onclick="toggleBackgroundSection()">
      <span class="bg-section-chevron">${backgroundCollapsed ? '▸' : '▾'}</span>
      <span class="bg-section-label">⚙ ${esc(t('background_section', { n: count }))}</span>
    </div>
  `;
}

function toggleBackgroundSection() {
  backgroundCollapsed = !backgroundCollapsed;
  window.api.setBackgroundCollapsed(backgroundCollapsed);
  render();
}

function updateSession(s) {
  // Targeted update: find the existing element and patch it in place
  const container = viewContainer();
  const selector = `[data-session="${s.sessionId}"]`;
  const existing = container.querySelector(selector);

  if (!existing && s.isBackground && backgroundCollapsed && viewMode !== 'micro') {
    // Collapsed background session: not in the DOM by design. Without this
    // guard the `!existing` branch below would fullRender() on every token
    // update of every hidden headless session.
    updateStatusBar();
    return;
  }

  if (!existing) {
    // New session — need full re-render to place it correctly
    fullRender();
    return;
  }

  // isBackground flipped (headless session resumed interactively, …) — the
  // card must move across the section divider, which an in-place patch
  // can't do. Note: in micro view the [data-session] node is the .micro-group
  // wrapper; the bg-session class sits on its .micro-item child.
  const wasBg = existing.classList.contains('bg-session') ||
                !!existing.querySelector(':scope > .micro-item.bg-session');
  if (!!s.isBackground !== wasBg) {
    fullRender();
    updateStatusBar();
    return;
  }

  const stateName = s.state.name;
  const oldState = existing.dataset.state;

  // Patch in place — replace the element's HTML
  const htmlFn = viewItemHTML();
  const temp = document.createElement('div');
  temp.innerHTML = htmlFn(s);
  const newEl = temp.firstElementChild;

  // Trigger state-changed animation if state actually changed
  if (oldState !== stateName) {
    newEl.classList.add('state-changed');
    newEl.addEventListener('animationend', () => newEl.classList.remove('state-changed'), { once: true });
  }

  existing.replaceWith(newEl);

  // Bell + toast handoff: a bell on a session that's now inactive (error)
  // or actively interacting again (running/thinking) is stale and gets
  // cleared. Bell otherwise re-attaches to the new DOM indicator.
  const bell = activeBells.get(s.sessionId);
  const isActiveAgain = stateName === 'running' || stateName === 'thinking';
  const isInactive = stateName === 'error';
  if (bell) {
    if (isActiveAgain || isInactive) clearBell(s.sessionId, { skipRender: true });
    else applyBellVisual(s.sessionId, bell.kind);
  }
  if (isActiveAgain || isInactive) dismissToastForSession(s.sessionId);

  updateStatusBar();
}

function removeSessionFromDOM(sessionId) {
  clearBell(sessionId);
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

  // Sort by user-defined order, falling back to newest first
  arr.sort((a, b) => {
    const ai = sessionOrder.indexOf(a.sessionId);
    const bi = sessionOrder.indexOf(b.sessionId);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return new Date(b.startedAt) - new Date(a.startedAt);
  });

  return arr;
}

// "Inactif" / "Sleeping" — shown when a waiting session has drifted past its
// bell window (no bell active = user hasn't acknowledged within 2 min).
function getStateLabel(s) {
  if (s.state.name === 'waiting' && !activeBells.has(s.sessionId)) {
    return t('state_waiting_idle');
  }
  return t('state_' + s.state.name);
}

function subagentRowHTML(sa) {
  const raw = sa.description || sa.agentType || 'subagent';
  return `
    <div class="subagent-row" data-agent="${escAttr(sa.agentId)}">
      <span class="subagent-spinner"></span>
      <span class="subagent-type">${esc(sa.agentType || '')}</span>
      <span class="subagent-desc" title="${escAttr(raw)}">${esc(raw)}</span>
    </div>
  `;
}

function workflowRowHTML(wf) {
  const progress = t('workflow_progress', {
    running: wf.running, done: wf.done, started: wf.started, n: wf.running,
  });
  return `
    <div class="workflow-row" data-run="${escAttr(wf.runId)}">
      <span class="subagent-spinner workflow-spinner"></span>
      <span class="workflow-name" title="${escAttr(wf.name)}">⚡ ${esc(wf.name)}</span>
      <span class="workflow-progress">${esc(progress)}</span>
    </div>
  `;
}

// Bloc commun aux 3 vues : badges workflows (agrégés) au-dessus des rows
// subagents. Le header ne compte que les subagents directs — les agents d'un
// workflow sont résumés par leur badge.
function subagentsBlockHTML(s) {
  const workflows = s.workflows || [];
  const subs = s.subagents || [];
  if (workflows.length === 0 && subs.length === 0) return '';
  const wfRows = workflows.map(workflowRowHTML).join('');
  const count = subs.length;
  const label = count === 1 ? 'sous-agent' : 'sous-agents';
  const header = count ? `<div class="subagents-header">${count} ${label} en cours</div>` : '';
  const rows = subs.map(subagentRowHTML).join('');
  return `
    <div class="subagents-block" data-count="${count}">
      ${wfRows}
      ${header}
      ${rows}
    </div>
  `;
}

function cardHTML(s) {
  const stateName = s.state.name;
  const stateLabel = getStateLabel(s);
  const duration = formatDuration(s.startedAt);
  const tokens = formatTokens(s.tokens);
  const sid = escAttr(s.sessionId);

  return `
    <div class="card${s.isBackground ? ' bg-session' : ''}" data-state="${stateName}" data-session="${sid}"
         draggable="${!searchQuery}"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)"
onclick="handleCardClick(event, '${sid}')">
      <span class="card-bloom"></span>
      <div class="card-header">
        <div class="card-title">
          <div class="project-name editable-name" onclick="event.stopPropagation(); startInlineRename(event, '${sid}')" title="${t('action_rename_hint')}">
            <span class="project-name-text">${esc(s.customName || s.projectName)}</span>
            <span class="edit-hint">${ICONS.edit}</span>
          </div>
        </div>
        <div class="card-actions">
          ${stateName === 'error' ? `<button class="card-btn" onclick="event.stopPropagation(); handleRemove('${sid}')" title="${t('action_delete')}">${ICONS.x}</button>` : ''}
          <button class="card-btn notif-btn ${s.notifEnabled ? 'notif-on' : ''}" onclick="event.stopPropagation(); toggleNotif(event, '${sid}')" title="${t('action_notifications')}">
            ${s.notifEnabled ? ICONS.bell : ICONS.bellOff}
          </button>
        </div>
      </div>
      <div class="state-badge ${stateName}">
        ${(stateName === 'running' || stateName === 'thinking') ? '<span class="spinner"></span>' : '<span class="dot"></span>'}
        ${stateLabel}
      </div>
      <div class="card-details">
        <div class="detail">
          <span class="detail-label">${t('branch')}</span>
          <span class="detail-value branch-value">${esc(s.gitBranch || '—')}</span>
        </div>
        <div class="detail">
          <span class="detail-label">${t('duration')}</span>
          <span class="detail-value duration-value" data-started="${s.startedAt}">${duration}</span>
        </div>
        <div class="detail detail-session">
          <span class="detail-label">${t('session')}</span>
          <span class="detail-value session-id-value" onclick="handleCopyId(event, '${sid}')" title="${t('action_copy_id')}"><span class="session-id-text">${esc(s.sessionId)}</span><span class="session-id-copy">${ICONS.copy}</span></span>
        </div>
        <div class="detail">
          <span class="detail-label">${t('tokens')}</span>
          <span class="detail-value">${tokens}</span>
        </div>
        <div class="detail">
          <span class="detail-label">${t('model')}</span>
          <span class="detail-value">${formatModel(s.model)}</span>
        </div>
        <div class="detail">
          <span class="detail-label">${t('tool')}</span>
          <span class="detail-value">${(stateName === 'running' || stateName === 'thinking') ? toolPill(s.lastTool) : toolPill(null)}</span>
        </div>
      </div>
      ${subagentsBlockHTML(s)}
    </div>
  `;
}

function microItemHTML(s) {
  const stateName = s.state.name;
  const sid = escAttr(s.sessionId);
  const name = s.customName || s.projectName;
  const isActive = stateName === 'running' || stateName === 'thinking';
  const isPending = stateName === 'pending';
  const indicator = isActive
    ? '<span class="micro-item-spinner"></span>'
    : isPending
      ? `<span class="pending-indicator">${ICONS.bellRing}</span>`
      : '<span class="micro-item-dot"></span>';
  const tooltip = `${name} — ${getStateLabel(s)}`;
  const notifIcon = s.notifEnabled
    ? `<button class="micro-notif-btn notif-on" onclick="event.stopPropagation(); toggleNotif(event, '${sid}')" title="${t('action_notifications')}">${ICONS.bell}</button>`
    : `<button class="micro-notif-btn" onclick="event.stopPropagation(); toggleNotif(event, '${sid}')" title="${t('action_notifications')}">${ICONS.bellOff}</button>`;
  // Wrap parent row + subagent rows in a group so data-session targets the
  // whole stack (drag-drop, bell, updateSession). The .micro-item itself loses
  // data-session to avoid double-matches in selectors.
  return `
    <div class="micro-group" data-session="${sid}"
         draggable="${!searchQuery}"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)">
      <div class="micro-item${s.isBackground ? ' bg-session' : ''}" data-state="${stateName}"
           title="${escAttr(tooltip)}"
           onclick="handleFocus('${sid}')">
        ${indicator}
        <span class="micro-item-name">${esc(name)}</span>
        ${notifIcon}
      </div>
      ${subagentsBlockHTML(s)}
    </div>
  `;
}

function compactItemHTML(s) {
  const stateName = s.state.name;
  const sid = escAttr(s.sessionId);
  const isActive = stateName === 'running' || stateName === 'thinking';
  const stateLabel = getStateLabel(s);

  // Always wrap in a fixed-size slot so bell-flash (12×12) doesn't push the
  // label sideways when it replaces the dot.
  const inner = isActive
    ? '<span class="compact-spinner"></span>'
    : stateName === 'pending'
      ? `<span class="pending-indicator">${ICONS.bellRing}</span>`
      : '<span class="compact-dot"></span>';
  const stateIndicator = `<span class="compact-state-slot">${inner}</span><span class="compact-meta-sep">·</span>`;

  const toolDisplay = isActive && s.lastTool
    ? toolPill(s.lastTool)
    : '<span class="compact-card-muted">—</span>';

  return `
    <div class="compact-card${s.isBackground ? ' bg-session' : ''}" data-state="${stateName}" data-session="${sid}"
         draggable="${!searchQuery}"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)"
onclick="handleCardClick(event, '${sid}')">
      <div class="compact-card-header">
        <div class="compact-card-name editable-name" onclick="event.stopPropagation(); startInlineRename(event, '${sid}')" title="${t('action_rename_hint')}">
          <span class="project-name-text">${esc(s.customName || s.projectName)}</span>
          <span class="edit-hint">${ICONS.edit}</span>
        </div>
        <div class="compact-card-actions">
          ${stateName === 'error' ? `<button class="card-btn" onclick="event.stopPropagation(); handleRemove('${sid}')" title="${t('action_delete')}">${ICONS.x}</button>` : ''}
          <button class="card-btn notif-btn ${s.notifEnabled ? 'notif-on' : ''}" onclick="event.stopPropagation(); toggleNotif(event, '${sid}')" title="${t('action_notifications')}">
            ${s.notifEnabled ? ICONS.bell : ICONS.bellOff}
          </button>
        </div>
      </div>
      <div class="compact-card-row">
        <span class="compact-card-state">
          ${stateIndicator}<span class="compact-card-state-label">${stateLabel}</span>
        </span>
        <span class="compact-meta-sep">·</span>
        <span class="compact-card-tool">${toolDisplay}</span>
      </div>
      <div class="compact-card-branch">
        <span class="compact-card-branch-icon">${ICONS.branch || '⎇'}</span>
        <span class="branch-value">${esc(s.gitBranch || '—')}</span>
      </div>
      <div class="compact-card-session session-id-value" onclick="handleCopyId(event, '${sid}')" title="${t('action_copy_id')}">
        <span class="compact-card-branch-icon">${ICONS.copy}</span>
        <span class="session-id-text">${esc(s.sessionId)}</span>
      </div>
      ${subagentsBlockHTML(s)}
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
  const s = sessions.get(sessionId);
  // Headless sessions have no terminal to focus — covers card click,
  // micro item click and toast click in one place.
  if (s && s.isBackground) return;
  window.api.focusTerminal(sessionId);
}

// ═══ Notification bell ═══
// State lives in JS, not the DOM, because session updates rebuild the DOM
// nodes (replaceWith / fullRender) — the bell would be wiped within seconds
// otherwise. We re-inject the visual on every render and clear it when the
// session goes back to an active state (running/thinking) or on timeout.

const BELL_DURATION = 120000; // 2 min — long enough to catch on next glance
const activeBells = new Map(); // sessionId → { kind, timerId }

function setBell(sessionId, kind) {
  const existing = activeBells.get(sessionId);
  if (existing && existing.timerId) clearTimeout(existing.timerId);
  const timerId = setTimeout(() => clearBell(sessionId), BELL_DURATION);
  activeBells.set(sessionId, { kind, timerId });
  // Re-render: the waiting label flips to its "fresh" form (no bell → with
  // bell). updateSession's bell handoff re-applies the visual on the new DOM.
  const s = sessions.get(sessionId);
  if (s) updateSession(s);
  else applyBellVisual(sessionId, kind);
}

// opts.skipRender = true when called from updateSession's own bell handoff
// (the DOM was just rebuilt with the new state, no need to re-render).
function clearBell(sessionId, opts) {
  const entry = activeBells.get(sessionId);
  if (!entry) return;
  if (entry.timerId) clearTimeout(entry.timerId);
  activeBells.delete(sessionId);
  removeBellVisual(sessionId);
  if (opts && opts.skipRender) return;
  // Re-render: if state is still waiting, label flips to "Inactif".
  const s = sessions.get(sessionId);
  if (s && s.state.name === 'waiting') updateSession(s);
}

// Re-injects the bell on whatever indicator the current view has for this
// session (dot or spinner). Idempotent — skips items that already have one.
function applyBellVisual(sessionId, kind) {
  document.querySelectorAll(`[data-session="${sessionId}"]`).forEach(item => {
    if (item.querySelector('.bell-flash')) return;
    const indicator = item.querySelector(
      '.micro-item-dot, .micro-item-spinner, .compact-dot, .compact-spinner, .state-badge .dot, .state-badge .spinner'
    );
    if (!indicator) return;
    const color = kind === 'pending' ? 'var(--state-pending)' : 'var(--state-waiting)';
    const bellSvg = ICONS.bellRing.replace('width="14"', 'width="12"').replace('height="14"', 'height="12"');
    const flash = document.createElement('span');
    flash.className = 'bell-flash';
    flash.style.color = color;
    flash.innerHTML = bellSvg;
    indicator.dataset.bellHidden = '1';
    indicator.style.display = 'none';
    indicator.parentElement.insertBefore(flash, indicator);
  });
}

function removeBellVisual(sessionId) {
  document.querySelectorAll(`[data-session="${sessionId}"]`).forEach(item => {
    item.querySelectorAll('.bell-flash').forEach(f => f.remove());
    item.querySelectorAll('[data-bell-hidden]').forEach(el => {
      el.style.display = '';
      delete el.dataset.bellHidden;
    });
  });
}

function reapplyAllBells() {
  for (const [sid, bell] of activeBells) applyBellVisual(sid, bell.kind);
}

// ═══ Card click — focus terminal (suppressed if user is dragging) ═══

function handleCardClick(event, sessionId) {
  // The handler is attached to the whole card, so any element inside that
  // wants different behaviour must call event.stopPropagation() first
  // (handled by the action buttons + the editable name).
  if (event.defaultPrevented) return;
  handleFocus(sessionId);
}

// ═══ Inline rename — replaces the project name with an input ═══

function startInlineRename(event, sessionId) {
  if (event && event.stopPropagation) event.stopPropagation();
  const s = sessions.get(sessionId);
  if (!s) return;

  // Find the .editable-name container — works for both grid and compact cards.
  const card = document.querySelector(`[data-session="${sessionId}"] .editable-name`);
  if (!card || card.classList.contains('renaming')) return;

  const currentName = s.customName || s.projectName;
  const placeholder = s.projectName;

  card.classList.add('renaming');
  card.innerHTML = `<input class="inline-rename-input" type="text" value="${escAttr(currentName)}" placeholder="${escAttr(placeholder)}" />`;
  const input = card.querySelector('.inline-rename-input');
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) {
      const value = input.value.trim();
      const nameToSet = (!value || value === s.projectName) ? '' : value;
      const current = s.customName || '';
      if (nameToSet !== current) {
        window.api.setCustomName(sessionId, nameToSet);
      }
    }
    // The next session-updated render will replace the inline input with
    // the static span. If no update arrives (no-op rename), restore manually.
    setTimeout(() => {
      const stillThere = document.querySelector(`[data-session="${sessionId}"] .editable-name.renaming`);
      if (stillThere) {
        const updated = sessions.get(sessionId);
        const display = updated ? (updated.customName || updated.projectName) : currentName;
        stillThere.classList.remove('renaming');
        stillThere.innerHTML = `<span class="project-name-text">${esc(display)}</span><span class="edit-hint">${ICONS.edit}</span>`;
      }
    }, 100);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  // Prevent the card click from firing when interacting with the input.
  input.addEventListener('click', (e) => e.stopPropagation());
}

// ═══ Copy session ID ═══

function handleCopyId(event, sessionId) {
  event.stopPropagation();
  const el = event.currentTarget;
  window.api.copyToClipboard(sessionId);
  if (!el) return;
  const original = el.innerHTML;
  el.innerHTML = `<span style="color: var(--state-running)">${t('action_copied')}</span>`;
  setTimeout(() => { el.innerHTML = original; }, 1200);
}

// ═══ Remove session ═══

function handleRemove(sessionId) {
  window.api.removeSession(sessionId);
}

// ═══ Notifications ═══

async function toggleNotif(event, sessionId) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const prefs = await window.api.getNotificationPrefs(sessionId);
  const wasOn = !!(prefs.modal || prefs.sound);
  const newVal = !wasOn;
  await window.api.setNotificationPrefs(sessionId, { modal: newVal, sound: newVal });

  // Update the session data in local cache
  const s = sessions.get(sessionId);
  if (s) s.notifEnabled = newVal;

  // Update button visually in place
  btn.classList.toggle('notif-on', newVal);
  btn.innerHTML = newVal ? ICONS.bell : ICONS.bellOff;

  // Preview sound when enabling
  if (newVal) playNotificationSound();
}

// ═══ Toast notifications ═══

const TOAST_DURATION = 10000;

// « ⚡ deep-research terminé — 103 agents, 6 min ». Retour pré-échappé : il est
// injecté tel quel dans le innerHTML du toast.
function workflowDoneLabel(data) {
  const parts = [];
  if (data.agentCount) parts.push(t('workflow_agents', { n: data.agentCount }));
  if (data.durationMs) parts.push(`${Math.max(1, Math.round(data.durationMs / 60000))} min`);
  const suffix = parts.length ? ` — ${parts.join(', ')}` : '';
  return `⚡ ${esc(data.workflowName || '')} ${t('workflow_done')}${esc(suffix)}`;
}

// Banner-style toast: a single clickable line that focuses the terminal.
// Color follows the notification kind (blue for waiting, orange for pending).
// Auto-dismisses after TOAST_DURATION, on Escape, or when the session goes
// back to an active state (handled in updateSession).
function showToast(data) {
  const kind = data.kind === 'pending' ? 'pending'
    : data.kind === 'workflow-done' ? 'workflow-done'
    : 'waiting';
  const stateLabel = kind === 'pending' ? t('state_pending')
    : kind === 'workflow-done' ? workflowDoneLabel(data)
    : t('state_waiting');

  // Don't stack — replace any existing toast for the same session
  const previous = $notificationOverlay.querySelector(
    `.notification-toast[data-session="${escAttr(data.sessionId)}"]`
  );
  if (previous) previous.remove();

  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.dataset.session = data.sessionId;
  toast.dataset.kind = kind;
  toast.setAttribute('role', 'button');
  toast.setAttribute('tabindex', '0');
  toast.title = t('action_focus_terminal');
  const bell = ICONS.bellRing.replace('width="14"', 'width="13"').replace('height="14"', 'height="13"');
  toast.innerHTML = `
    <span class="toast-bell">${bell}</span>
    <span class="toast-name">${esc(data.customName || data.projectName)}</span>
    <span class="toast-arrow">→</span>
    <span class="toast-state">${stateLabel}</span>
    <button class="toast-close" title="${t('close')}" aria-label="${t('close')}">${ICONS.x}</button>
    <div class="toast-timer"></div>
  `;
  toast.addEventListener('click', () => {
    handleFocus(data.sessionId);
    toast.remove();
  });
  // Close button dismisses without triggering focus
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toast.remove();
  });
  $notificationOverlay.appendChild(toast);

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

function dismissToastForSession(sessionId) {
  const toast = $notificationOverlay.querySelector(
    `.notification-toast[data-session="${escAttr(sessionId)}"]`
  );
  if (toast) toast.remove();
}

// ═══ Sound ═══
// WAV is synthesized in JS and played via <audio> so it follows the system
// audio routing (headphones, bluetooth, etc.). Regenerated when the theme
// changes — see SOUND_THEMES + regenerateSounds below.

function generateChimeWav(notes, duration) {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(numSamples);

  for (const note of notes) {
    const startSample = Math.floor(note.start * sampleRate);
    const endSample = Math.min(startSample + Math.floor(note.dur * sampleRate), numSamples);
    const decay = note.decay || 12;
    const attack = note.attack || 50;
    const amp = note.amp || 1;
    const tremRate = note.tremRate || 0;
    const tremDepth = note.tremDepth || 0;
    for (let i = startSample; i < endSample; i++) {
      const t = (i - startSample) / sampleRate;
      let envelope = Math.exp(-t * decay) * Math.min(t * attack, 1);
      if (tremRate > 0) {
        envelope *= 1 - tremDepth * 0.5 * (1 - Math.cos(2 * Math.PI * tremRate * t));
      }
      buffer[i] += amp * Math.sin(2 * Math.PI * note.freq * t) * envelope;
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

// One sound per preset — same chime for end-of-turn and needs-action.
// The visual layer (toast, micro bell flash) still distinguishes the two states.
const SOUND_THEMES = {
  default: { duration: 0.4, notes: [
    { freq: 1047, start: 0,    dur: 0.15 },   // C6
    { freq: 1319, start: 0.12, dur: 0.25 },   // E6
  ]},
  vibraphone: {
    // Warm metallic ring with characteristic tremolo (~6 Hz).
    // Fundamental + 4th partial (4× freq) — that's a vibraphone bar's voice.
    duration: 0.8,
    notes: [
      { freq: 698,  start: 0,    dur: 0.6, decay: 5, attack: 80, tremRate: 6, tremDepth: 0.35 },              // F5
      { freq: 2792, start: 0,    dur: 0.4, decay: 9, attack: 80, amp: 0.22, tremRate: 6, tremDepth: 0.35 },   // F7 partial
      { freq: 880,  start: 0.20, dur: 0.6, decay: 5, attack: 80, tremRate: 6, tremDepth: 0.35 },              // A5
      { freq: 3520, start: 0.20, dur: 0.4, decay: 9, attack: 80, amp: 0.22, tremRate: 6, tremDepth: 0.35 },   // A7 partial
    ],
  },
  wood: { duration: 0.4, notes: [
    { freq: 1047, start: 0,    dur: 0.18, decay: 25, attack: 200 },   // C6 dry
    { freq: 1568, start: 0.12, dur: 0.18, decay: 25, attack: 200 },   // G6 dry
  ]},
  soft: { duration: 0.6, notes: [
    { freq: 440, start: 0,    dur: 0.30, decay: 8, attack: 35, amp: 0.6 },   // A4
    { freq: 523, start: 0.20, dur: 0.40, decay: 8, attack: 35, amp: 0.6 },   // C5
  ]},
};

let soundUrl = null;
let soundTheme = 'default';

function regenerateSounds() {
  if (soundUrl) URL.revokeObjectURL(soundUrl);
  const theme = SOUND_THEMES[soundTheme] || SOUND_THEMES.default;
  soundUrl = generateChimeWav(theme.notes, theme.duration);
}

regenerateSounds();

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
    const audio = new Audio(soundUrl);
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

// ═══ Helpers ═══

function formatDuration(startedAt) {
  if (!startedAt) return '—';
  const ms = Date.now() - new Date(startedAt).getTime();
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
  if (!el) { e.preventDefault(); return; }
  draggedId = el.dataset.session;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedId);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.target.closest('[data-session]');
  if (!target || target.dataset.session === draggedId) return;

  // No cross-section drag: the group is dictated by isBackground, not by position.
  const ds = sessions.get(draggedId);
  const ts = sessions.get(target.dataset.session);
  if (!ds || !ts || !!ds.isBackground !== !!ts.isBackground) return;

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
  const container = viewContainer();
  const items = container.querySelectorAll('[data-session]');
  const visible = Array.from(items)
    .map(el => el.dataset.session)
    .filter(id => sessions.has(id));
  // Sessions hidden from the DOM (collapsed Background section) keep their
  // previous relative order, appended after the visible ones. Grouping into
  // interactive/background happens after the sort, so position in this flat
  // list only matters within each group.
  const hidden = sessionOrder.filter(id => sessions.has(id) && !visible.includes(id));
  sessionOrder = visible.concat(hidden);
  window.api.setSessionOrder(sessionOrder);
}

// ═══ Status bar ═══

function updateStatusBar() {
  // Fallback (no usage data) only — populated by renderUsage() / handleUsageError().
  const fallback = document.getElementById('statusFallback');
  if (!fallback || fallback.style.display === 'none') return;

  const all = Array.from(sessions.values());
  const waiting = all.filter(s => s.state.name === 'waiting');
  const totalInput = all.reduce((sum, s) => sum + (s.tokens?.input || 0), 0);
  const totalOutput = all.reduce((sum, s) => sum + (s.tokens?.output || 0), 0);

  const activeLabel = searchQuery
    ? t('status_filtered', { visible: getSortedSessions().length, total: all.length })
    : t('status_active', { n: all.length });

  document.getElementById('statActive').textContent = activeLabel;
  document.getElementById('statWaiting').textContent = t('status_waiting', { n: waiting.length });
  const tokensText = formatTokens({ input: totalInput, output: totalOutput });
  document.getElementById('statTokens').textContent = t('status_tokens', { n: tokensText });
}

function renderUsage(data) {
  const group = document.getElementById('usageGroup');
  const fallback = document.getElementById('statusFallback');
  if (!group) return;
  group.style.display = '';
  if (fallback) fallback.style.display = 'none';

  const set = (barId, pctId, win) => {
    const bar = document.getElementById(barId);
    const pct = document.getElementById(pctId);
    if (!bar || !pct) return;
    if (!win || typeof win.utilization !== 'number') {
      bar.style.width = '0%';
      bar.classList.remove('warn', 'danger');
      pct.textContent = '—';
      return;
    }
    const u = Math.max(0, Math.min(100, win.utilization));
    bar.style.width = `${u}%`;
    bar.classList.toggle('warn', u >= 70 && u < 90);
    bar.classList.toggle('danger', u >= 90);
    pct.textContent = `${Math.round(u)}%`;
  };

  set('usageBar5h', 'usagePct5h', data.fiveHour);
  set('usageBar7d', 'usagePct7d', data.sevenDay);

  const renderReset = (el, win) => {
    if (!el) return;
    const next = win && win.resetsAt;
    const txt = el.querySelector('.usage-reset-text');
    if (next) {
      el.style.display = '';
      if (txt) txt.textContent = formatResetTime(next);
    } else {
      el.style.display = 'none';
    }
  };
  renderReset(document.getElementById('usageReset'), data.fiveHour);
  renderReset(document.getElementById('usageReset7d'), data.sevenDay);
  group.title = formatUsageTooltip(data);
}

function formatResetTime(iso) {
  try {
    const d = new Date(iso);
    const diffMs = d.getTime() - Date.now();
    if (diffMs <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  } catch { return ''; }
}

function formatUsageTooltip(d) {
  const lines = [];
  const fmt = (key, win) => {
    if (!win) return;
    const pct = Math.round(win.utilization);
    const time = win.resetsAt ? new Date(win.resetsAt).toLocaleString() : '?';
    lines.push(t(key, { pct, time }));
  };
  fmt('usage_tooltip_5h', d.fiveHour);
  fmt('usage_tooltip_7d', d.sevenDay);
  fmt('usage_tooltip_7d_sonnet', d.sevenDaySonnet);
  fmt('usage_tooltip_7d_opus', d.sevenDayOpus);
  return lines.join('\n');
}

function handleUsageError(code) {
  const group = document.getElementById('usageGroup');
  const fallback = document.getElementById('statusFallback');
  if (!group || !fallback) return;
  group.style.display = 'none';
  fallback.style.display = '';
  fallback.title = t('usage_unavailable', { code });
  updateStatusBar();
}

// ═══ Start ═══

init();
