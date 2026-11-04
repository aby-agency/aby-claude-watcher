# Journal - aby-claude-watcher

Une entrée par session significative, mois courant seulement ; les mois passés vont dans `archives/journal-<mois>.md` (`node scripts/registres.mjs rotate`).

<!--
## AAAA-MM-JJ - [ce qui a été fait, en une ligne]
- Issues : #N, #M
- Fait / décidé / reste
-->

## 2026-11-04 - GPU à 45-50 % : animations infinies en steps(), v2.17.1 publiée - FAIT
- Issues : #1 (PR #2)
- Fait : cause mesurée au CDP (animations infinies, île toujours affichée, popover caché peint), correctif en `steps()` + `paintWhenInitiallyHidden: false`, release v2.17.1 avec les deux DMG. App buildée mesurée à 3,2 % de GPU.
- Reste : Paul installe la 2.17.1 (bannière de mise à jour de l'île, ou DMG).
