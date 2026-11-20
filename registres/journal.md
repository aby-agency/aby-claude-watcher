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

## 2026-11-20 - CPU : cache des fichiers de sous-agents dans le scan - EN COURS
- Issues : #3
- Fait : relevé de la session pilotage (22,6 % de CPU, pics qui suivent l'activité). Cause mesurée : `scanSession` relisait méta + fin de fichier de tous les `agent-*.jsonl` à chaque `serializeSession` (215 agents dans une session : 29,7 ms par passage). Cache par fichier (taille + mtime) dans `SubagentTracker` : 0,9 ms, résultats identiques sur trois sessions réelles. `workflowsForSession` mesuré négligeable (0,01 ms).
- Écarts assumés : la méta d'un agent n'est plus relue une fois lue ; le cache d'une session finie reste en mémoire tant que son dossier existe (quelques centaines d'octets par agent).
- Reste : effet sur le CPU à confirmer après release (fréquence des passages estimée, non mesurée) ; poussée + PR sur go de Paul ; agent tué en plein appel d'outil possiblement affiché `running` à vie (`stop_reason: tool_use` ignore l'âge du fichier), à vérifier.
