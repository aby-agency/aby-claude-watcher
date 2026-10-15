# ADR - aby-claude-watcher

Décisions structurantes (engagement > 1 h). Format : `~/Aby/doctrine/registres.md` § 4.

Lecture en début de session : le sommaire suffit ; ouvrir une ADR par son numéro (`grep -rn "## ADR-0xx" registres/`).

## Sommaire

- ADR-001 - 2026-10-15 - Alignement sur la doctrine Aby 1.2.0 et template-aby 1.4.0 (Cercla référence) - Active

---

## ADR-001 - 2026-10-15 - Alignement sur la doctrine Aby 1.2.0 et template-aby 1.4.0 (Cercla référence)
- Statut : Active

### Contexte
Demande d'Etienne du 2026-10-15 05:42 : « fais le tour des projets et aligne, cercla est notre referentiel, c'est le meilleur projet ». Et du 05:48 : « fais en sorte que codex aussi applique toutes les regles dans les autres projets ». Le projet n'avait ni registres ni ticket en issues ; les décisions techniques vivent dans la section « Key decisions » de CLAUDE.md, conservée telle quelle.

### Décision
Réglages Claude Code du template (mode bypassPermissions, deny minimum, hooks block-destructive, env-guard, inject-date-commits, stop-closeout-guard, SessionStart registres.mjs), scripts/registres.mjs et son test, registres/ (ADR, LRN, TASKS, journal, experiments, archives), gabarit de ticket GitHub, labels fermés, AGENTS.md avec la section Codex, sections Tickets et worktrees, Règles non-négociables, Registres et Sources externes ajoutées au CLAUDE.md sans toucher au contenu technique existant.

### Conséquences
`node scripts/registres.mjs check` tourne à chaque démarrage de session Claude ; Codex tient les mêmes gardes à la main (`AGENTS.md`). Les titres de registres suivent le format daté, c'est la date du titre qui déclenche la rotation vers `registres/archives/`.

### Alternatives considérées
- Ne rien changer : rejetée, le projet divergerait de la doctrine et de Cercla.
- Copier la configuration de Cercla telle quelle : rejetée, on part du template-aby 1.4.0 et on garde ce qui est propre au projet.
