// Libellé de modèle (« claude-opus-5 » → « Opus 5 ») — logique pure node/window.
// IIFE obligatoire : les <script src> du renderer partagent le même scope
// lexical global, un const racine ici casserait le script suivant en
// silence (cf. PIÈGE scope global, CLAUDE.md).
(function () {
  // Familles connues. L'ordre n'importe pas, l'alternance est ancrée en tête.
  const FAMILIES = 'opus|sonnet|haiku|fable';

  // `(\d{1,2})(?!\d)` : un numéro de version fait 1 ou 2 chiffres. Le garde
  // empêche une DATE de suffixe (« claude-opus-5-20260101 ») de se faire lire
  // comme une révision → « Opus 5.20260101 ». Elle est simplement ignorée,
  // comme pour « claude-haiku-4-5-20251001 » → « Haiku 4.5 ».
  const RE = new RegExp(`^(${FAMILIES})(?:-(\\d{1,2})(?!\\d))?(?:-(\\d{1,2})(?!\\d))?`, 'i');

  // Slug de modèle → libellé court, ou null quand il n'y a rien à afficher
  // (l'appelant décide alors entre « — » et masquer la ligne).
  // Un slug non reconnu est rendu tel quel : mieux vaut un slug brut qu'un
  // modèle avalé si Anthropic change encore de format de nom.
  function formatModel(model) {
    if (typeof model !== 'string') return null;
    const raw = model.trim();
    // `<synthetic>` : pseudo-modèle des events d'erreur API, jamais un modèle.
    if (!raw || raw.startsWith('<')) return null;

    // Suffixe de variante entre crochets : « claude-opus-5[1m] » → « Opus 5 ».
    const base = raw.replace(/\[.*$/, '').replace(/^claude-/i, '');
    const m = base.match(RE);
    if (!m) return raw;

    const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    if (!m[2]) return name;                      // alias nu : « opus » → « Opus »
    if (!m[3]) return `${name} ${m[2]}`;         // génération 5 : « Opus 5 »
    return `${name} ${m[2]}.${m[3]}`;            // « Opus 4.8 »
  }

  const api = { formatModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.modelLabel = api;
})();
