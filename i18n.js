// i18n.js — shared translations (works in both Node main process and renderer)

(function (root) {
  const strings = {
    fr: {
      // States
      state_thinking: 'Réflexion',
      state_running: 'Exécution',
      state_waiting: 'En attente',
      state_waiting_idle: 'Inactif',
      state_pending: 'Action requise',
      state_error: 'Erreur',
      background_section: 'Background ({n})',
      workflow_progress: '{running} agent{s} actif{s} ({done}/{started})',
      workflow_done: 'terminé',
      workflow_agents: '{n} agent{s}',

      // Toolbar tooltips
      search_placeholder: 'Rechercher...',
      view_grid: 'Vue grille',
      view_compact: 'Vue compacte',
      view_micro: 'Vue micro',
      micro_back: 'Retour',
      pin_title: 'Always on top',
settings_title: 'Paramètres',

      // Empty states
      empty_title: 'Aucune session Claude Code',
      empty_hint: 'Lancez <code>claude</code> dans un terminal — les sessions apparaissent ici automatiquement',
      empty_filtered_title: 'Aucun résultat',
      empty_filtered_hint: 'Essayez une autre recherche',
      reset: 'Réinitialiser',

      // Card details
      tool: 'Outil',
      duration: 'Durée',
      tokens: 'Tokens',
      model: 'Modèle',
      branch: 'Branche',
      session: 'Session',

      // Card actions
      action_notifications: 'Notifications',
      action_focus_terminal: 'Focus terminal',
      action_delete: 'Supprimer',
      action_more: "Plus d'options",
      action_copy_id: 'Copier le session ID',
      action_copied: '✓ Copié',

      // Modals
      action_rename: 'Renommer',
      action_rename_hint: 'Cliquer pour renommer',
      cancel: 'Annuler',
      close: 'Fermer',

      // Settings tabs
      tab_general: 'Général',
      tab_notifications: 'Notifications',
      tab_about: 'À propos',

      // Settings — general
      auto_launch_label: 'Lancement au démarrage',
      auto_launch_hint: 'Ouvrir <strong>Aby Claude Watcher</strong> automatiquement à la connexion',
      auto_launch_hint_html: 'Ouvrir <strong>Aby Claude Watcher</strong> automatiquement à la connexion',
      language_label: 'Langue',
      language_hint: "Langue de l'interface",
      transparency_label: 'Transparence de la fenêtre',
      transparency_hint: 'Rendre la fenêtre translucide au repos, opaque au survol ou au focus',
      vibrancy_label: 'Verre translucide (expérimental)',
      vibrancy_hint: 'Instable sur macOS Tahoe — désactivé par défaut. Redémarrer l\'app pour appliquer.',
      vibrancy_restart_hint: 'Redémarrer l\'app pour appliquer.',

      // Settings — notifications
      volume_label: 'Volume',
      test_sound: 'Tester le son',
      position_label: "Position à l'écran",
      position_top_left: 'Haut gauche',
      position_top_right: 'Haut droite',
      position_bottom_left: 'Bas gauche',
      position_bottom_right: 'Bas droite',
      sound_theme_label: 'Tonalité',
      sound_theme_hint: 'Style des sons de notification',
      sound_theme_default: 'Standard',
      sound_theme_vibraphone: 'Vibraphone',
      sound_theme_wood: 'Bois',
      sound_theme_soft: 'Feutré',

      // Settings — about
      about_version: 'Version',
      update_check_label: 'Aucune vérification récente',
      update_check_hint: 'Cliquez pour chercher une mise à jour',
      update_checking: 'Vérification...',
      update_checking_hint: 'Connexion à GitHub',
      update_available: 'Nouvelle version {version} disponible',
      update_download_link: 'Télécharger sur GitHub',
      update_up_to_date: '{app} est à jour',
      update_up_to_date_hint: 'Version {version} — vérifié {when}',
      update_no_releases: 'Aucune version publiée',
      update_no_releases_hint: "Le projet n'a pas encore de release GitHub",
      update_rate_limited: 'Vérifié récemment',
      update_rate_limited_hint: 'Dernière vérification {when} — cliquez pour forcer',
      update_error: 'Erreur de vérification',
      update_error_hint: 'Vérifiez votre connexion',
      update_check_btn: 'Vérifier',
      update_banner_download: 'Télécharger',
      update_install_btn: 'Installer maintenant',
      update_downloading: 'Téléchargement {percent}%',
      update_installing: 'Installation et redémarrage…',
      update_install_failed: 'Échec — voir les logs',
      update_open_github: 'Ouvrir sur GitHub',
      rel_just_now: "à l'instant",
      rel_minutes_ago: 'il y a {n} min',
      rel_hour_ago: 'il y a 1 h',
      rel_hours_ago: 'il y a {n} h',
      rel_day_ago: 'hier',
      rel_days_ago: 'il y a {n} jours',

      // Notifications
      notif_modal: 'Modal in-app',
      notif_sound: 'Son',
      notif_session_waiting: 'Session en attente',
      notif_body_pending: 'Permission requise',
      notif_body_waiting: 'En attente de ta saisie',

      // Popover
      popover_empty: 'Aucune session active',
      popover_header: '{n} session{s}',
      popover_open: 'Ouvrir',
      popover_quit: 'Quitter',
      popover_quit_title: 'Quitter Aby Claude Watcher',

      // Status bar
      status_active: '{n} active{s}',
      status_waiting: '{n} en attente',
      status_tokens: '{n} tokens',
      status_filtered: '{visible}/{total} affichées',
      usage_tooltip_5h: '5h : {pct}% — reset {time}',
      usage_tooltip_7d: '7j : {pct}% — reset {time}',
      usage_tooltip_7d_sonnet: '7j Sonnet : {pct}% — reset {time}',
      usage_tooltip_7d_opus: '7j Opus : {pct}% — reset {time}',
      usage_unavailable: 'Quota Claude indisponible ({code})',

      // Tray
      tray_tooltip: '{app} — {n} active{s}',
      tray_tooltip_waiting: ' ({n} en attente)',

      // About modal
      about_title: 'À propos d\'Aby Claude Watcher',
      about_tagline: 'Tableau de bord temps réel pour vos sessions Claude Code.',
      about_feature_detect: 'Détecte automatiquement chaque nouvelle session Claude Code',
      about_feature_state: 'État live par session : reflechit, exécute, attend',
      about_feature_notify: 'Notifie quand Claude attend votre saisie',
      about_feature_focus: 'Un clic pour revenir au terminal d\'origine',
      about_feature_usage: 'Suit les fenêtres 5h et 7 jours avec décompte avant reset',
      about_hint: 'Appuyez sur <kbd>Esc</kbd> pour fermer un panneau.',
    },

    en: {
      // States
      state_thinking: 'Thinking',
      state_running: 'Running',
      state_waiting: 'Waiting',
      state_waiting_idle: 'Sleeping',
      state_pending: 'Needs you',
      state_error: 'Error',
      background_section: 'Background ({n})',
      workflow_progress: '{running} agent{s} active ({done}/{started})',
      workflow_done: 'done',
      workflow_agents: '{n} agent{s}',

      // Toolbar tooltips
      search_placeholder: 'Search...',
      view_grid: 'Grid view',
      view_compact: 'Compact view',
      view_micro: 'Micro view',
      micro_back: 'Back',
      pin_title: 'Always on top',
settings_title: 'Settings',

      // Empty states
      empty_title: 'No Claude Code sessions',
      empty_hint: 'Run <code>claude</code> in a terminal — sessions appear here automatically',
      empty_filtered_title: 'No results',
      empty_filtered_hint: 'Try a different search',
      reset: 'Reset',

      // Card details
      tool: 'Tool',
      duration: 'Duration',
      tokens: 'Tokens',
      model: 'Model',
      branch: 'Branch',
      session: 'Session',

      // Card actions
      action_notifications: 'Notifications',
      action_focus_terminal: 'Focus terminal',
      action_delete: 'Delete',
      action_more: 'More options',
      action_copy_id: 'Copy session ID',
      action_copied: '✓ Copied',

      // Modals
      action_rename: 'Rename',
      action_rename_hint: 'Click to rename',
      cancel: 'Cancel',
      close: 'Close',

      // Settings tabs
      tab_general: 'General',
      tab_notifications: 'Notifications',
      tab_about: 'About',

      // Settings — general
      auto_launch_label: 'Launch at startup',
      auto_launch_hint: 'Open <strong>Aby Claude Watcher</strong> automatically at login',
      auto_launch_hint_html: 'Open <strong>Aby Claude Watcher</strong> automatically at login',
      language_label: 'Language',
      language_hint: 'Interface language',
      transparency_label: 'Window transparency',
      transparency_hint: 'Make the window translucent when idle, opaque on hover or focus',
      vibrancy_label: 'Translucent glass (experimental)',
      vibrancy_hint: 'Unstable on macOS Tahoe — off by default. Restart the app to apply.',
      vibrancy_restart_hint: 'Restart the app to apply.',

      // Settings — notifications
      volume_label: 'Volume',
      test_sound: 'Test sound',
      position_label: 'On-screen position',
      position_top_left: 'Top left',
      position_top_right: 'Top right',
      position_bottom_left: 'Bottom left',
      position_bottom_right: 'Bottom right',
      sound_theme_label: 'Sound theme',
      sound_theme_hint: 'Notification sound style',
      sound_theme_default: 'Default',
      sound_theme_vibraphone: 'Vibraphone',
      sound_theme_wood: 'Wood',
      sound_theme_soft: 'Soft',

      // Settings — about
      about_version: 'Version',
      update_check_label: 'No recent check',
      update_check_hint: 'Click to check for updates',
      update_checking: 'Checking...',
      update_checking_hint: 'Connecting to GitHub',
      update_available: 'New version {version} available',
      update_download_link: 'Download on GitHub',
      update_up_to_date: '{app} is up to date',
      update_up_to_date_hint: 'Version {version} — checked {when}',
      update_no_releases: 'No release published',
      update_no_releases_hint: 'The project has no GitHub release yet',
      update_rate_limited: 'Checked recently',
      update_rate_limited_hint: 'Last check {when} — click to force',
      update_error: 'Check failed',
      update_error_hint: 'Check your connection',
      update_check_btn: 'Check',
      update_banner_download: 'Download',
      update_install_btn: 'Install now',
      update_downloading: 'Downloading {percent}%',
      update_installing: 'Installing and restarting…',
      update_install_failed: 'Failed — check logs',
      update_open_github: 'Open on GitHub',
      rel_just_now: 'just now',
      rel_minutes_ago: '{n} min ago',
      rel_hour_ago: '1 h ago',
      rel_hours_ago: '{n} h ago',
      rel_day_ago: 'yesterday',
      rel_days_ago: '{n} days ago',

      // Notifications
      notif_modal: 'In-app modal',
      notif_sound: 'Sound',
      notif_session_waiting: 'Session waiting',
      notif_body_pending: 'Permission required',
      notif_body_waiting: 'Waiting for your input',

      // Popover
      popover_empty: 'No active session',
      popover_header: '{n} session{s}',
      popover_open: 'Open',
      popover_quit: 'Quit',
      popover_quit_title: 'Quit Aby Claude Watcher',

      // Status bar
      status_active: '{n} active',
      status_waiting: '{n} waiting',
      status_tokens: '{n} tokens',
      status_filtered: '{visible}/{total} shown',
      usage_tooltip_5h: '5h: {pct}% — reset {time}',
      usage_tooltip_7d: '7d: {pct}% — reset {time}',
      usage_tooltip_7d_sonnet: '7d Sonnet: {pct}% — reset {time}',
      usage_tooltip_7d_opus: '7d Opus: {pct}% — reset {time}',
      usage_unavailable: 'Claude usage unavailable ({code})',

      // Tray
      tray_tooltip: '{app} — {n} active',
      tray_tooltip_waiting: ' ({n} waiting)',

      // About modal
      about_title: 'About Aby Claude Watcher',
      about_tagline: 'Real-time dashboard for your Claude Code sessions.',
      about_feature_detect: 'Auto-detects every new Claude Code session as it spawns',
      about_feature_state: 'Live state per session: thinking, running, waiting',
      about_feature_notify: 'Notifies you when Claude is waiting for your input',
      about_feature_focus: 'One click to focus the originating terminal',
      about_feature_usage: 'Tracks 5h and 7-day usage windows with countdown to reset',
      about_hint: 'Press <kbd>Esc</kbd> to close any panel.',
    },
  };

  let currentLang = 'fr';

  function setLanguage(lang) {
    if (lang === 'fr' || lang === 'en') currentLang = lang;
  }

  function getLanguage() {
    return currentLang;
  }

  function detectSystemLanguage() {
    try {
      const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
      const env = (typeof process !== 'undefined' && process.env && (process.env.LANG || process.env.LC_ALL)) || '';
      const source = (nav || env).toLowerCase();
      if (source.startsWith('fr')) return 'fr';
      if (source.startsWith('en')) return 'en';
    } catch {}
    return 'fr';
  }

  function t(key, params) {
    const dict = strings[currentLang] || strings.fr;
    let s = dict[key] || strings.fr[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
    }
    // Handle plural {s} — "" or "s" based on n
    if (params && typeof params.n === 'number') {
      s = s.replace(/\{s\}/g, params.n !== 1 ? 's' : '');
    } else {
      s = s.replace(/\{s\}/g, '');
    }
    return s;
  }

  const api = { strings, t, setLanguage, getLanguage, detectSystemLanguage };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.i18n = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
