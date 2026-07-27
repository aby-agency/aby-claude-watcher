# Durée d'état — « Inactif · 12 min » (design)

**Date** : 2026-07-27
**Demande** : Paul veut voir depuis quand une session est dans son état courant — au départ « depuis quand la fenêtre est inactive », élargi à TOUS les états pendant le cadrage.

## Décisions de cadrage (validées)

- **Surfaces** : cartes du dashboard (grid + compact), panneau déplié de l'île, et tooltip (horodatage absolu au survol du badge).
- **États** : tous (« Inactif · 12 min », « En exécution · 2 min », « Réflexion · 5 min », « Délégation · 15 min », « En attente · 3 min », « Erreur · 1h02 »).
- **Format carte** : la durée vit DANS le badge d'état (« Inactif · 12 min »), pas de ligne de détail supplémentaire.

## Approche retenue

`stateSince` posé dans `setState` à chaque vraie transition, persisté avec la session, fallback mtime du JSONL à la restauration. (Alternatives écartées : dériver de `lastEventTime` — faux pour les états actifs, le compteur serait remis à ~0 par chaque event ; reparser le JSONL pour dater la transition — coûteux pour quelques secondes de précision de plus que le mtime.)

## Design

### Watcher (`watcher.js`) — source de vérité

- `setState` gagne un paramètre optionnel `at` (epoch ms, défaut `Date.now()`). Dans la branche `stateChanged`, il pose `session.stateSince = at` avant emit/persist.
- `persistSession` embarque `stateSince`.
- **Restauration au démarrage** (`start()`, relecture de `config.sessions`) : `stateSince: data.stateSince || null` — l'état restauré est exactement celui persisté, le timestamp persisté reste valide.
- **`fastInitialLoad`** : les appels `setState(..., isInitial=true, ...)` passent `at = stat.mtimeMs` (le mtime du JSONL déjà staté). Deux cas :
  - état déduit == état restauré → `stateChanged` est faux, `setState` no-op, le `stateSince` persisté survit (la durée survit au restart) ;
  - état différent → la transition a eu lieu app éteinte, le mtime est la meilleure approximation honnête (dernier event écrit).
- **Pending restauré** (`restorePending` → `setState('pending-restored')`) : passe `at = mark.at` — le `pendingMark` persiste déjà l'instant exact de la question, plus précis que le mtime.
- Sessions découvertes en cours de vie : chemin normal, `Date.now()` par défaut.
- `stateSince` absent (config d'une version antérieure, jamais re-transitionnée) → reste `null`, aucune durée affichée. **Jamais de « 0 min » fabriqué** : absence de donnée = absence d'affichage, pas de compteur qui ment.

### Sérialisation (`main.js`)

- `serializeSession` expose `stateSince: session.stateSince ?? null`.
- Les **overrides de présentation ne touchent pas `stateSince`** : quand `delegating` se substitue à `waiting` (ou `running` à un `pending` bloqué), la durée affichée reste celle de l'état machine sous-jacent. Conséquence assumée : le libellé peut basculer « Inactif » ↔ « Délégation » sans que le compteur reparte à zéro — c'est le même tour fini, la continuité est la bonne sémantique.

### Cartes (`ui/renderer.js`) — grid + compact

- Le badge d'état gagne un span `.state-duration` avec `data-since` (epoch ms). Le **ticker 1 s existant** (`updateDurations`) met à jour ces spans en place — pas de re-render de carte.
- Format compact, même esprit que `formatRemaining` : rien sous 60 s (une durée qui apparaît à chaque transition est du bruit), puis `12 min`, puis `1h32`. Formateur en **fonction pure exportée** (module partagé node/window, comme `usage-ring.js`) pour être testable et réutilisé par l'île.
- **Tooltip** : `title` sur le badge — horodatage absolu localisé (« Inactif depuis 14:32 » ; jour inclus si > 24 h). Libellés via i18n.js (fr/en).
- La vue micro est exclue (pas de place, hors périmètre).

### Île (`island-model.js` + renderer île)

- `row()` retrouve son champ `minutes` (retiré lors du compactage v2.x) : calculé depuis `s.stateSince`, arrondi à la minute, `null` sous 60 s. `buildIsland` gagne un paramètre `now` (défaut `Date.now()`) pour rester pur et testable.
- Rendu : « · 12 min » à droite du libellé dans `.r-state`, même taille 10px — on ré-introduit l'info sans regonfler ce qui avait été compacté.
- Granularité minute, rafraîchie par le cycle de refresh existant de l'île — **pas de ticker seconde** côté île. Le renderer ne réassigne pas le HTML si la valeur affichée n'a pas changé (même précaution que `setWing` : ne pas rejouer les anims).

### Tests

- Formateur de durée (module pur) : bornes < 60 s, minutes, heures.
- `island-model` : `minutes` présent/absent selon `stateSince`, calcul avec `now` injecté.
- Watcher : `stateSince` posé sur transition, conservé sur no-op, fallback mtime en initial, `mark.at` sur pending restauré, `null` toléré.
- Vérification visuelle CDP à la vraie largeur de fenêtre (grid, compact, île) — un check à une largeur arbitraire ne prouve rien.

## Hors périmètre

- Vue micro.
- Historique des transitions (seul l'état courant est daté).
- Toute notification basée sur la durée (« inactif depuis > X » qui alerte) — non demandé.
