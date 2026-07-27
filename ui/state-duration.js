// Durée d'état (« Inactif · 12 min ») — logique pure partagée node/window.
// IIFE obligatoire : les <script src> du renderer partagent le même scope
// lexical global, un const racine ici casserait le script suivant en
// silence (cf. PIÈGE scope global, CLAUDE.md).
(function () {
  // Minutes entières → libellé compact : « 12 min » puis « 1h05 ».
  // null sous la minute — l'appelant n'affiche alors rien.
  function formatMinutes(m) {
    if (typeof m !== 'number' || !isFinite(m) || m < 1) return null;
    const mm = Math.floor(m);
    if (mm < 60) return `${mm} min`;
    const h = Math.floor(mm / 60);
    return `${h}h${String(mm % 60).padStart(2, '0')}`;
  }

  // Epoch ms → libellé, null sous 60 s (jamais de « 0 min » fabriqué).
  function formatStateDuration(sinceMs, nowMs) {
    if (typeof sinceMs !== 'number' || !isFinite(sinceMs)) return null;
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    return formatMinutes((now - sinceMs) / 60000);
  }

  const api = { formatMinutes, formatStateDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.stateDuration = api;
})();
