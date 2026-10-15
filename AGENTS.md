# AGENTS.md - aby-claude-watcher

Ce dépôt n'a qu'une constitution : [`CLAUDE.md`](CLAUDE.md), à la racine. Elle vaut pour tout agent de code, quel que soit l'outil qui lit ce fichier (Codex, Claude Code, autre). Lis-la en entier avant d'écrire une ligne.

Les règles qui se vérifient par une commande :

1. **Un worktree par ticket**, créé depuis `origin/main` dans `~/Aby/.worktrees/aby-claude-watcher/<ticket>`, jamais ailleurs. Vérifier : `git worktree list`.
2. **Rien ne reste non commité en fin de session.** Vérifier : `git status --short` vide.
3. **Historique linéaire** : rebase sur `origin/main`, jamais de merge de `main` dans une branche. Vérifier : `git rev-list --merges origin/main..HEAD` vide.
4. **« Terminé » se prouve** : on donne les codes de sortie et les compteurs des vérifications locales, pas « testé en local ».
5. **Un ticket, une issue, des commits à son numéro** (`feat(#N): ...`), une PR qui porte `Closes #N`.
6. **Une demande d'Etienne s'écrit dans l'issue avant d'être codée**, citée mot pour mot et datée ; rien ne se « rétablit » sans vérifier d'où ça vient (`gh search issues`, `registres/journal.md`).

## Ce que Codex fait à la main

Les hooks de `.claude/settings.json` ne tournent que dans Claude Code. Sous Codex, les mêmes gardes se tiennent à la main :

- **Démarrage** : `node scripts/registres.mjs check` ; s'il dit « consolidation due », `node scripts/registres.mjs rotate` puis commit `docs: rotation des registres`. Lire le sommaire d'ADR, le sommaire de LRN et l'ouvert de TASKS.
- **Interdits** (deny list de Claude) : suppression récursive forcée, `git push --force` / `-f`, `git reset --hard`, écrire dans un `.env` (sauf `.env.example`), écrire dans `.git/`. Action destructive, envoi externe ou écriture en prod : validation d'Etienne d'abord.
- **Avant de pousser** : les vérifications locales du projet passent (codes de sortie lus), une poussée par lot, pas de tag sans raison (minutes d'intégration continue comptées).
- **Fin de session** : rien de non commité dans `registres/` ; décidé (ADR), appris (LRN), coincé (TASKS), une entrée de journal.

Aucune mention d'un outil d'IA dans le code, les commits ou les PR (ni `Co-Authored-By`).
