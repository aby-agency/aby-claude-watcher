# Design — Retour du popover du tray (avec jauges conso)

Date : 2026-07-24. Demandeur : Paul (Etienne l'aimait bien).

## Contexte

Le popover du tray a été supprimé en v2.0.0 (`83e7a43`) au profit de la dynamic
island. Décision de le remettre. L'île **reste** — les deux coexistent : île =
survol à l'encoche, popover = clic sur l'item de la barre de menus.

## Objectif

Un mini-panneau opaque sous l'item tray, ouvert au clic, montrant les sessions
actives + la conso, sans toucher au comportement de l'île.

## Décisions (validées)

- **Déclencheur** : `tray.on('click'|'right-click')` → `popover.toggle()`
  (remplace l'actuel `showMainWindow`). Le dashboard reste accessible via le
  bouton « Ouvrir » du popover et le clic sur l'icône du Dock.
- **Contenu** : en-tête « N sessions » · liste sessions (spinner si actif /
  point sinon, nom, état ; clic = focus terminal) · **jauges 5H / 7J / Fable**
  en pied (rendu générique lu depuis `getUsage()`, mêmes seuils que l'île :
  warn ≥50, hot >80) · boutons « Ouvrir » / « Quitter ». Auto-dimensionné.

## Architecture

Mirroir du module `island.js` (main process) + renderer séparé :

- **`popover.js`** (nouveau, main process) : `create()` (fenêtre 320px cachée
  au boot), `toggle(trayBounds)` (positionne centré sous le tray, show/hide,
  toggle-lock 200ms, blur→hide), `sendUpdate()` (envoie `popover-update` si
  visible), `hide()`, `resize(h)`, `destroy()`, `window()`.
- **`ui/popover.html`** (revive) : structure d'origine + section jauges avant
  le pied + styles jauges inline + `--glow` redéfini localement (retiré de
  styles.css avec le popover en v2.0.0 ; seul consommateur).
- **`ui/popover.js`** (revive) : rendu liste (inchangé) + rendu jauges
  (générique, réutilise la logique scopedLimits de l'île) + auto-resize incluant
  les jauges. `onUpdate` → refresh.
- **`preload-popover.js`** (revive) : ajoute `getUsage` aux méthodes d'origine.

## Câblage main.js

- `const popover = require('./popover')`.
- Boot : `popover.create()` après `island.refresh(...)`.
- `setupTray` : `tray.on('click'|'right-click', () => popover.toggle(tray.getBounds()))`.
- Fan-out : `popover.sendUpdate()` accolé à chaque `island.sendUpdate()` (usage,
  session-order, tick debouncé watcher, langue, setupTray tick).
- IPC (setupIPC) : `popover-hide`, `popover-open-main`, `popover-quit`,
  `popover-resize`. `get-sessions`/`get-config`/`get-usage` réutilisés.

## Pièges gérés

- **`build.files`** : ajouter `popover.js` + `preload-popover.js` (les fichiers
  `ui/*` sont déjà couverts par `ui/**/*`). Sinon crash DMG (piège connu).
- **i18n** : restaurer `popover_header/empty/open/quit/quit_title` (fr+en).
- **`--glow`** absent de styles.css → redéfini dans le `<style>` du popover.

## Vérification

- `node --check` sur les nouveaux modules.
- Suite de tests (aucun test popover : renderer DOM-couplé, comme island.js).
- CDP : le popover est créé caché au boot → lire son DOM (liste + jauge Fable),
  confirmer boot sans erreur.

## Hors périmètre (YAGNI)

- Pas de refonte de l'île. Pas de recherche/tri dans le popover. Pas de montants
  en dollars (écarté plus tôt).
