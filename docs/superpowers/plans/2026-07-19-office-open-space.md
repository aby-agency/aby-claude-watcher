# Vue Office v4 — open-space zoné — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une seule salle zonée en quadrants (lounge/agents/deep-research/headless), slots à la demande, déplacements visibles, d'après le mockup de Paul.

**Architecture:** `office-layout.js` v4 : `roomFor(snapshot, state)` (UNE salle, zones en quadrants, slots par zone, la hauteur suit la zone la plus peuplée, couloir central), migration = simple `retarget` (même pièce, marche réelle). `office.js` : retour à UN canvas ; tout le reste (bulles, étiquettes anti-collision, LED, hit-test par perso, tooltip, timer) se transpose. Bake : unités du mockup (poste console+fauteuil orange / variante noire, canapé d'angle, table basse, setup latéral, TV) identifiées dans les packs par comparaison visuelle avec `.superpowers/sdd/mockup-v4.png`.

**Tech Stack:** inchangé. Mockup de référence : `/Users/invictorius/Project/aby-claude-watcher/.superpowers/sdd/mockup-v4.png` (fourni par Paul — c'est LA cible visuelle).

## Global Constraints

- Spec : docs/superpowers/specs/2026-07-19-office-open-space-design.md (fait foi).
- Mêmes contraintes v2/v3 (zéro dépendance, assets jamais commités, timer unique, zoom [1..4], commits sans trailer, jamais de push).
- Acquis à CONSERVER tels quels : bulles émotes + priorités (enveloppe/bell > état > marteau) ; « waiting à cloche active reste au poste » ; étiquettes pixel anti-collision (bulles prioritaires, pixel-check) ; slots stables par zone ; dimensionnement jamais sous les occupants réels (famille C1/C2/C3 — transposer les tests) ; assise demi-tile ; fauteuil overlay conditionnel ; LED par poste occupé ; clic par perso (headless exclu) ; tooltip ; lastKnown + prune ; purge kind-mismatch (flip isBackground → l'acteur change de zone, plus de kind différent : en v4 headless = kind 'session' zone headless ? — NON : garder kind distinct pour l'exclusion du focus, documenter).
- Zones (quadrants, largeur salle fixe ~16 tuiles, couloir central ≥ 2 colonnes libre sur toute la hauteur) : lounge haut-gauche (waiting sans cloche, places canapé + debout) ; agents bas-gauche (rangées de 3 postes, fauteuils ORANGE) ; deep-research haut-droite (postes latéraux empilables, agents de workflows, cap + « +N ») ; headless bas-droite (postes fauteuil NOIR, cap + « +N », pas de focus). Subagents : portable à droite du poste parent (1 colonne réservée par rangée de postes, jusqu'à 2 portables par parent, « +N » au-delà — géométrie fine à l'implémentation, invariants testés).
- Sièges : ORANGE par défaut (chairOver passe sur la famille 107-112), NOIR pour headless (famille 101-106 actuelle).

---

### Task 1: Assets du mockup (bake) — identification visuelle + préview validé par Paul

- Lis le mockup (`.superpowers/sdd/mockup-v4.png`) et identifie chaque élément dans les packs (contact-sheets zoomés, comparaison pixel) : unité poste console+fauteuil (probablement une composition de singles — décompose-la : console/écran, fauteuil orange ~107-112, fauteuil noir ~101-106), canapé d'angle (fragments 201-204), table basse (+ machine à café posée dessus), setup latéral 90° (écrans latéraux ~131-134 + bureau), TV murale (~170-172 ou autre), tout autre détail du mockup (climatiseur/fenêtre haut-gauche ?).
- Étends le manifest (`chairOrange`, `chairBlack` (rename de l'existant si besoin), `stationConsole`, `sofaCorner*`, `coffeeTable`, `sideDesk90`, `tv`, …) + bake + smoke test + `--preview`.
- REGARDE le preview et compare côte à côte avec le mockup ; si un élément est introuvable dans les packs, note-le précisément (élément, où tu as cherché) et continue — le contrôleur demandera à Paul.
- Livrable : atlas mis à jour + un montage comparatif mockup-vs-frames pour validation, chemin donné au report. Commit `feat(office): bake v4 — assets du mockup open-space`.

### Task 2: Layout v4 — salle unique zonée (pur + tests)

- `roomFor(snapshot, state)` → `{cols, rows, statics, zones}` unique ; slots par zone (stables, jamais sous les occupants réels — transpose les tests C1/C2/C3 et le fuzz) ; subagents adjacents au parent ; migration intra-salle par `retarget` (couloir central, non-traversée des meubles testée par zone) ; `emoteFor`/`labelFor`/`animFor`/règle cloche inchangés ; `actorsIn(state)` (plus de roomKey) ou équivalent — signature ARRÊTÉE dans ton report pour Task 3.
- TDD strict, invariants transposés + nouveaux (zones, adjacence subagents, couloir). Commit `feat(office): layout v4 — open-space zoné, slots par zone, marche intra-salle`.

### Task 3: Rendu 1 canvas + intégration + CDP

- `office.js` : un canvas (retour au modèle v2 simple), footer(s), tout l'acquis transposé ; `renderer.js` quasi inchangé (renderRooms → renderRoom). Vérif CDP complète (états, migration visible lounge↔poste, subagents adjacents, headless noirs sans focus, cloche au poste, étiquettes, fenêtre étroite, purge propre) avec screenshots REGARDÉS + comparaison au mockup. Commit `feat(office): v4 — rendu open-space zoné`.

## Hors plan
- Pas de release ici. Dette v3 parkée reportée. CLAUDE.md mis à jour en fin de Task 3 (bullet v4).
