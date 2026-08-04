// Visibilité du chip « Chrome » : usage de l'extension Claude in Chrome il y a
// moins de CHROME_RECENT_MS. Module pur — l'expiration vit côté renderer (le
// main n'émet aucun event à l'expiration), d'où le `now` injecté.
(function () {
  const CHROME_RECENT_MS = 5 * 60 * 1000;

  function chromeChipVisible(lastUsedAt, now) {
    return typeof lastUsedAt === 'number' && lastUsedAt > 0 && (now - lastUsedAt) < CHROME_RECENT_MS;
  }

  const api = { chromeChipVisible, CHROME_RECENT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.chromeChip = api;
})();
