# LRN - aby-claude-watcher

Patterns récurrents capitalisés au close-out. Format : `~/Aby/doctrine/registres.md` § 3 ; 80 entrées actives au plus, les plus anciennes partent dans `archives/` (`node scripts/registres.mjs rotate`).

## Sommaire thématique (entrées actives)

<!-- une ligne par entrée : - LRN-NNN : pattern en une phrase -->
- LRN-001 : une animation CSS infinie et fluide recompose sa fenêtre à chaque rafraîchissement d'écran ; sur l'île toujours affichée, c'est 24 % de GPU en permanence
- LRN-002 : `[skip ci]` sur le DERNIER commit poussé d'une branche saute la CI de toute la PR, code compris

<!--
## LRN-NNN - AAAA-MM-JJ - [Pattern en une phrase]
- Investigué : [contexte concret]
- Appris : [le fait brut + preuve]
- Suite : [comment ça change la prochaine session]
-->

## LRN-001 - 2026-11-04 - Une animation CSS infinie et fluide coûte du GPU en continu
- Investigué : le processus GPU d'Electron tenait 45-50 % de CPU depuis des jours (#1).
- Appris : mesuré au CDP sur l'app installée en coupant les animations fenêtre par fenêtre : île 24 %, dashboard ouvert 33 % (caché : 0 %), popover jamais montré 6 % (une fenêtre `show: false` est peinte tant que `paintWhenInitiallyHidden` vaut true). Mettre en pause les seuls spinners invisibles du panneau replié ne change rien : tant qu'une animation tourne dans la fenêtre, elle est recomposée à chaque image. En `steps(8)` : 3,2 % dashboard caché, 7-8 % ouvert.
- Suite : toute nouvelle animation `infinite` s'écrit en `steps()` ; vérifier avec `grep -rn infinite ui/ | grep -v steps`. Mesurer le GPU par `top -l 5 -s 2 -stats pid,cpu -pid <gpu-process>`, pas `ps` (moyenne lissée).

## LRN-002 - 2026-11-20 - `[skip ci]` sur le dernier commit saute la CI de toute la PR
- Investigué : PR #4 (fix + test + journal), `gh pr checks 4` → « no checks reported ».
- Appris : GitHub lit `[skip ci]` sur le commit de tête du push ; le commit de journal posé en dernier a fait sauter les tests des deux commits de code. Même effet sur le push de `main` après fusion par rebase.
- Suite : sur une branche qui porte du code, le commit `docs: … [skip ci]` ne va jamais en dernier (le mettre avant le code, ou sans la mention). Si c'est déjà fait : rejouer `npm test` en local sous Node 20 (version de la CI) avant de fusionner.
