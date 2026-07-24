// ── ui/usage-ring.js ──
// Composant anneau de conso, réutilisé par les 3 surfaces (barre du bas du
// dashboard, popover, panneau déplié de l'île). Fonction PURE (aucun DOM/i18n)
// → unit-testable. Double export node (tests) + window (renderers via <script>).
// Anneau CSS pur (conic-gradient masqué) : voir .uring dans styles.css.
//
// IIFE OBLIGATOIRE : les <script> classiques partagent le scope lexical global.
// Un `const api` nu entrait en collision avec island-model.js (même `const api`
// global) et i18n.js → « Identifier 'api' has already been declared », le script
// n'exécutait pas, window.usageGauge restait undefined (barre du bas vide).
(function () {
  function usageLevel(pct) {
    // Seuils alignés île/popover/tray : hot > 80, warn ≥ 50, sinon ok.
    return pct > 80 ? 'hot' : pct >= 50 ? 'warn' : 'ok';
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  // label = « 5H » / « 7J » / « 7J FABLE » ; pct = entier (déjà arrondi par
  // l'appelant) ; remaining = temps déjà formaté (« 3h20 ») ou '' si pas de reset.
  // L'arc est borné à [0,100] ; le texte garde le pct réel (peut dépasser 100).
  function usageRing(label, pct, remaining) {
    const arc = Math.max(0, Math.min(100, pct));
    const reste = remaining ? `<span class="uring-reste">${escHtml(remaining)}</span>` : '';
    return `<div class="uring-item">`
      + `<span class="uring" data-lvl="${usageLevel(pct)}" style="--uring-pct:${arc}"></span>`
      + `<span class="uring-text">${escHtml(label)} · ${pct}%</span>`
      + reste
      + `</div>`;
  }

  // Barre de progression horizontale — même données que usageRing, autre forme.
  // Utilisée dans les panneaux étroits (île, popover) où une barre pleine
  // largeur se lit mieux qu'un anneau (retour Paul). Le dashboard garde l'anneau.
  function usageBar(label, pct, remaining) {
    const arc = Math.max(0, Math.min(100, pct));
    const reste = remaining ? `<span class="ubar-reste">${escHtml(remaining)}</span>` : '';
    return `<div class="ubar-item">`
      + `<div class="ubar-track"><div class="ubar-fill" data-lvl="${usageLevel(pct)}" style="--ubar-pct:${arc}"></div></div>`
      + `<div class="ubar-label"><span>${escHtml(label)} · ${pct}%</span>${reste}</div>`
      + `</div>`;
  }

  const gauge = { usageRing, usageBar, usageLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = gauge;
  if (typeof window !== 'undefined') window.usageGauge = gauge;
})();
