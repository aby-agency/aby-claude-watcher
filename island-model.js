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

function islandLayout(display, notch, winW) {
  const valid = notch && notch.width > 0 && notch.left >= 0;
  if (valid) {
    const notchCenter = display.bounds.x + notch.left + notch.width / 2;
    return {
      x: Math.round(notchCenter - winW / 2),
      gapPx: Math.round(notch.width + NOTCH_GAP_MARGIN),
    };
  }
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - winW) / 2),
    // Sans mesure, même gap partout : display à encoche → largeur prudente ;
    // display sans encoche (docké) → FAUSSE encoche aux dimensions de la
    // vraie (pilule compacte essayée puis écartée : « tout petit » sur 34").
    gapPx: NOTCH_GAP_FALLBACK,
  };
}

// Payload de la bannière needs-you — construit depuis une session watcher
// fraîche (main.js re-lit par id avant d'appeler : jamais d'objet périmé).
function bannerPayload(session, customName) {
  return {
    sessionId: session.sessionId,
    name: customName || session.projectName || 'Claude Code',
    state: (session.state && session.state.name) || null,
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
const BUSY_STATES = ['running', 'thinking'];

function buildIsland(sessions, config) {
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
    name: s.customName || s.projectName,
    state: s.state.name,
    isBackground: !!s.isBackground,
    // Sous-lignes : subagents actifs + runs de workflow (déjà filtrés
    // « running » par serializeSession).
    subagents: (s.subagents || []).map((sa) => ({
      label: sa.description || sa.agentType || 'subagent',
    })),
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

const api = { buildIsland, islandLayout, bannerPayload };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.islandModel = api;
