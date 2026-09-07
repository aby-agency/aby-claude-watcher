// ─── island-model.js ───
// Pure logic for the dynamic island — no Electron deps → unit-testable.
// Dual export: module.exports (main process, tests) + window.islandModel
// (island renderer, loaded via <script> like i18n.js).

// Position horizontale de la fenêtre + largeur du gap central (zone encoche).
// `notch` = mesure AppKit {left, width} en pt relative au display, ou null.
// Mesuré : fenêtre centrée sur le CENTRE RÉEL de l'encoche (elle peut être
// décentrée de quelques pt — 7 pt constatés sur MBP 16") et gap = largeur
// mesurée + marge de sécurité. Sans mesure : centré display, gap 180.
const NOTCH_GAP_FALLBACK = 180;
const NOTCH_GAP_MARGIN = 24;
// Hauteur de fenêtre : le panneau n'a ni cap ni scrollbar (la liste prend sa
// hauteur naturelle) — l'ex-340 rognait jauges et footer dès ~5 sessions, le
// bas du drop disparaissait sous le bord de la fenêtre. 800 absorbe une
// flotte réaliste (≈ 15 sessions avec sous-lignes) ; la fenêtre étant
// transparente et click-through, le surplus est invisible et sans coût.
// Clampée au display (petit écran externe).
const WIN_H_MAX = 800;
// Plafond de sous-lignes d'agents par session dans le volet. L'île est une
// surface de coup d'œil : au-delà, on résume « +N autres » — la liste complète
// vit sur la carte du dashboard. Sans plafond, un fan-out de 20 audits par
// session (Etienne, 2026-09-02 : ~40 lignes sur deux sessions) poussait jauges
// et pied sous le bord de la fenêtre de 800pt, sans scroll.
const ISLAND_MAX_SUBROWS = 6;

function islandLayout(display, notch, winW) {
  const h = Math.min(WIN_H_MAX, display.bounds.height);
  const valid = notch && notch.width > 0 && notch.left >= 0;
  if (valid) {
    const notchCenter = display.bounds.x + notch.left + notch.width / 2;
    return {
      x: Math.round(notchCenter - winW / 2),
      gapPx: Math.round(notch.width + NOTCH_GAP_MARGIN),
      h,
    };
  }
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - winW) / 2),
    // Sans mesure, même gap partout : display à encoche → largeur prudente ;
    // display sans encoche (docké) → FAUSSE encoche aux dimensions de la
    // vraie (pilule compacte essayée puis écartée : « tout petit » sur 34").
    gapPx: NOTCH_GAP_FALLBACK,
    h,
  };
}

// Payload de la bannière needs-you — construit depuis une session watcher
// fraîche (main.js re-lit par id avant d'appeler : jamais d'objet périmé).
function bannerPayload(session, customName) {
  return {
    sessionId: session.sessionId,
    name: customName || session.sessionName || session.projectName || 'Claude Code',
    state: (session.state && session.state.name) || null,
  };
}

// Notice de mise à jour — modèle unique pour les DEUX surfaces de l'île : la
// ligne de version du panneau déplié (toujours là, ne serait-ce que pour dire
// « v2.5.0 ») et la bannière collante sous l'encoche (seulement quand une
// version plus récente existe). Pur → testé sans Electron ni DOM.
//
// Pourquoi une bannière SANS timer alors que les bannières de session vivent
// 10 s : une session ratée revient (elle repassera waiting), une release non
// vue ne revient jamais — le dashboard, seule surface qui la signalait
// jusqu'ici, reste fermé des jours chez un utilisateur en tray (constaté chez
// Etienne, resté sur une version périmée sans le savoir).
//
// `install.phase` (downloading | installing | error) prime sur `dismissed` :
// une fois le téléchargement lancé on ne masque plus la ligne, elle sert de
// jauge puis annonce le redémarrage.
function updateNotice(info) {
  const u = info || {};
  const phase = (u.install && u.install.phase) || null;
  const pct = u.install && typeof u.install.percent === 'number' ? u.install.percent : 0;
  const available = !!u.latest && !u.dismissed;
  return {
    current: u.current || null,
    latest: u.latest || null,
    phase,
    percent: Math.max(0, Math.min(100, Math.round(pct))),
    // Bannière : dispo non écartée, ou installation déjà en route.
    showBanner: available || !!phase,
    // Action possible : DMG publié pour cette architecture. Sinon la ligne
    // reste informative et renvoie vers la release GitHub.
    canInstall: !!u.canInstall,
    url: u.url || null,
    // Pendant download/install, plus rien n'est cliquable (le clic relancerait
    // un second téléchargement par-dessus le premier) — mais après un échec si :
    // la ligne devient un bouton « réessayer ».
    clickable: phase !== 'downloading' && phase !== 'installing',
  };
}

// Same ordering as the main window / popover: user-defined sessionOrder
// first, then newest first. Stable → LEDs never jump on state changes.
function sortSessions(sessions, sessionOrder) {
  return sessions.slice().sort((a, b) => {
    const ai = sessionOrder.indexOf(a.sessionId);
    const bi = sessionOrder.indexOf(b.sessionId);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return new Date(b.startedAt) - new Date(a.startedAt);
  });
}

// Pilule binaire (décision Paul/Etienne, révise « une LED par état ») : au repos
// la pilule ne dit plus QUEL état, mais « ça bosse » vs « ça attend » — coup
// d'œil : l'agent taffe ou reste les bras croisés. DROITE = busy, GAUCHE = idle.
// Tout ce qui n'est pas explicitement busy compte comme idle (un état inconnu
// ne doit jamais passer pour « au travail »). Le détail par état survit dans le
// panneau déplié (rows), pas ici.
// `delegating` (sous-agents/workflow au travail) : ça tourne et ça reprendra
// seul → aile busy. Le compter côté idle appellerait une action inutile, alors
// que personne n'attend l'utilisateur. (Une session en waiting avec des bg
// process ouverts compte idle : la conversation, elle, est bien disponible.)
const BUSY_STATES = ['running', 'thinking', 'delegating'];

// Durée d'état des rangées du volet : minutes entières depuis stateSince,
// null sous la minute (pas de « 0 min »). Champ `minutes` réintroduit —
// retiré lors du compactage des rangées, il revient porté par stateSince.
// Fiches de tâches de fond (serializeSession.bgTasks) → groupes par famille,
// dans l'ordre serveur puis tâche : [{ kind, count, title }]. `title` = les
// descriptions (ou commandes) jointes par « · », pour le tooltip de la
// sous-ligne. Sans fiche mais avec un compte (présence CLI `shell` seule) :
// une tâche anonyme. Pur, testé.
function bgGroups(list, count) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return count > 0 ? [{ kind: 'task', count, title: '' }] : [];
  const out = [];
  for (const kind of ['server', 'waiter', 'task']) {
    const of = items.filter((b) => (b.kind === 'server' || b.kind === 'waiter' ? b.kind : 'task') === kind);
    if (!of.length) continue;
    out.push({
      kind,
      count: of.length,
      title: of.map((b) => b.description || b.command || '').filter(Boolean).join(' · '),
    });
  }
  return out;
}

function minutesSince(sinceMs, now) {
  if (typeof sinceMs !== 'number' || !isFinite(sinceMs)) return null;
  const m = Math.floor((now - sinceMs) / 60000);
  return m >= 1 ? m : null;
}

function buildIsland(sessions, config, now) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const order = (config && config.sessionOrder) || [];
  const sorted = sortSessions(sessions || [], order);
  const interactive = sorted.filter((s) => !s.isBackground);
  // Réglage par-personne : masquer les headless dans l'île (ailes + volet).
  // Défaut on → comportement historique. Off → les headless ne comptent nulle
  // part (ni ailes ni panneau). Cf. garde bannière côté main.
  const showHeadless = !config || config.islandShowHeadless !== false;
  const background = showHeadless ? sorted.filter((s) => s.isBackground) : [];

  // Les ailes agrègent SUR L'ENSEMBLE des sessions visibles (interactives +
  // headless si affichés) : un agent headless qui tourne, ça bosse aussi. Une
  // seule pastille + compteur par aile ; aile vide (0 session) → repliée.
  const visible = interactive.concat(background);
  const busyN = visible.filter((s) => BUSY_STATES.includes(s.state.name)).length;
  const idleN = visible.length - busyN;
  const wing = (state, count) => ({ leds: count ? [{ state, count }] : [] });

  const row = (s) => ({
    sessionId: s.sessionId,
    name: s.customName || s.sessionName || s.projectName,
    state: s.state.name,
    minutes: minutesSince(s.stateSince, nowMs),
    isBackground: !!s.isBackground,
    // Tâches Bash de fond encore ouvertes (JSONL, ou 1 si la présence CLI dit
    // `shell`) → sous-ligne « en fond » avec spinner, même gabarit que les
    // agents : on voit que ça bosse encore là-dessous (demande Paul 2026-09-07).
    bgTaskCount: s.bgTaskCount || 0,
    // Regroupées par famille pour une sous-ligne par famille : serveur (site /
    // watcher laissé tourner, glyphe terminal statique) et tâche (spinner).
    // Sans fiche (présence CLI seule) : une tâche anonyme, comme le chip.
    bgGroups: bgGroups(s.bgTasks, s.bgTaskCount || 0),
    // Sous-lignes : subagents actifs + runs de workflow (déjà filtrés
    // « running » par serializeSession).
    subagents: (s.subagents || []).slice(0, ISLAND_MAX_SUBROWS).map((sa) => ({
      label: sa.description || sa.agentType || 'subagent',
    })),
    // Nombre d'agents masqués par le plafond (0 = tout est affiché).
    subagentsMore: Math.max(0, (s.subagents || []).length - ISLAND_MAX_SUBROWS),
    workflows: (s.workflows || []).map((wf) => ({
      name: wf.name, started: wf.started, done: wf.done, running: wf.running,
    })),
  });

  return {
    left: wing('idle', idleN),  // ça attend (waiting/pending/error/…)
    right: wing('busy', busyN), // ça bosse (running/thinking)
    rows: interactive.map(row),
    backgroundRows: background.map(row),
  };
}

const api = { buildIsland, islandLayout, bannerPayload, updateNotice, ISLAND_MAX_SUBROWS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.islandModel = api;
