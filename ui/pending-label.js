// Libellé de la demande en attente : ce que Claude demande quand la carte passe
// à « Action requise ». La donnée vient du hook PermissionRequest (tool_name +
// tool_input), pas du JSONL — rien n'y est écrit tant que l'utilisateur n'a pas
// répondu. Module pur, double export node/window comme ui/model-label.js.
(function () {
  // Largeur d'affichage de la cible. Le tooltip, lui, porte toujours la valeur
  // entière : on tronque ce qu'on montre, jamais ce qu'on sait.
  const PENDING_LABEL_MAX = 48;

  // « mcp__qonto-official__create_client_invoice » → « qonto-official · create_client_invoice ».
  // Un nom hors format est rendu TEL QUEL (même règle que formatModel) : si le
  // format change un jour, on voit un slug moche plutôt que rien.
  function toolText(tool) {
    const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(tool);
    return m ? `${m[1]} · ${m[2]}` : tool;
  }

  // Une commande peut porter un heredoc ou une suite de lignes : aplatie, sinon
  // elle casserait la ligne de la carte.
  function flatten(value) {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function truncate(value, max) {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  function pendingLabel(req) {
    const tool = req && typeof req.tool === 'string' ? req.tool.trim() : '';
    if (!tool) return null; // pas d'outil = rien à dire, la surface décide
    const head = toolText(tool);
    const target = req.target == null ? '' : flatten(req.target);
    if (!target) return { text: head, title: head };
    return {
      text: `${head} · ${truncate(target, PENDING_LABEL_MAX)}`,
      title: `${head} · ${target}`,
    };
  }

  const api = { pendingLabel, PENDING_LABEL_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.pendingLabel = api;
})();
