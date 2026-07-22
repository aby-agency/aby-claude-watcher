# Dynamic Island — spec de design

Date : 2026-07-22 · Validée par Paul

## Contexte

La vue office pixel (v4) est abandonnée — rendu jugé raté. Elle est remplacée par une
nouvelle surface : une « île » ancrée à l'encoche du MacBook, qui devient le coup d'œil
principal sur la flotte de sessions. L'île **remplace le popover du tray** ; le tray
garde sa jauge 5h ; la fenêtre principale (grid) est inchangée.

Le concept est validé par un écosystème existant (claude-island, MioIsland, xisland,
Vibe Island) et la faisabilité Electron pure par la lib `electron-dynamic-island` (MIT),
dont on reprend la technique — pas le code (elle ne fait que des notifications
éphémères).

## Décisions produit (validées une à une)

| Sujet | Décision |
|---|---|
| Forme | Île déployable style NotchNook : pilule discrète repliée, panneau au survol |
| Style | LEDs, pas de personnages (exit définitif du pixel-art office) |
| Déplié | Liste de sessions (LED + slug + état en clair + durée) + jauge 5h en pied |
| Événements | LED pulse seulement (ambre/rouge) — l'île ne se déplie JAMAIS toute seule |
| Coexistence | Remplace le popover ; clic tray = fenêtre principale ; tray garde la jauge |
| LEDs repliées | Toutes les sessions : interactives (aile gauche) + headless (aile droite, plus petites/ternes) |
| Sans encoche | Île sur écran intégré à encoche uniquement ; clamshell/externe = pas d'île, le tray suffit |

## Architecture

### `island.js` (main process)

- `BrowserWindow` frameless, `transparent: true`, `alwaysOnTop` niveau `screen-saver`,
  `focusable: false`, `skipTaskbar`, `visibleOnAllWorkspaces({ visibleOnFullScreen: true })`,
  `hasShadow: false`. L'encoche physique reste visible en fullscreen → l'île reste.
- Création conditionnelle : écran intégré à encoche détecté par heuristique
  `display.internal && display.workArea.y >= 30` (barre de menu ~37 px sur Mac à
  encoche vs ~25 sinon ; aucune API publique n'expose l'encoche). Réévaluée sur les
  événements `screen` (display-added/removed/metrics-changed) : ouverture/fermeture du
  capot crée/détruit l'île. Repositionnement sur changement de résolution.
- Fenêtre dimensionnée **en permanence à la taille du panneau déplié**, centrée sur
  l'encoche, `y = 0`. Click-through par défaut : `setIgnoreMouseEvents(true,
  { forward: true })`. Le renderer suit les `mousemove` forwardés ; souris entrant dans
  la zone pilule → IPC `island-hover(true)` → main désactive le click-through, le
  renderer déplie (CSS). Sortie → replie + réactive le click-through. On ne
  redimensionne jamais la fenêtre au survol (flickers connus des fenêtres
  transparentes).

### `ui/island/` (renderer)

- **Repliée** : pilule noire fusionnée visuellement avec l'encoche (même noir, coins
  bas arrondis). Aile gauche : une LED par session interactive, couleurs des états du
  watcher ; pending/error pulsent (CSS). Aile droite : LEDs headless plus petites et
  ternes. Cap 4 par aile puis « +N ». Largeur de pilule adaptée au nombre de LEDs.
  Ordre stable par ancienneté (comme la fenêtre principale) — pas de réordonnancement
  au changement d'état, c'est le pulse qui attire l'œil.
- **Dépliée** : panneau noir sous l'encoche (coins bas arrondis) : liste des sessions
  interactives (LED, slug, état en clair via `i18n.js`, durée dans l'état), section
  headless compacte dessous, jauge 5h en pied (mêmes données `usage.js` que le tray).
  Clic sur une ligne interactive = focus terminal (IPC → `focus.js`) ; headless : pas
  de click-focus (règle existante). Dépli/repli en transitions CSS. La fenêtre étant à
  taille fixe, le panneau est borné (~10 lignes) avec défilement au-delà.

### `island-model.js` (module pur, testé)

Toute la logique sans Electron, comme `tray-glance.js` :
- mapping sessions → LEDs (tri, séparation interactives/headless, caps, « +N ») ;
- textes d'état + durées pour la liste dépliée ;
- `hasNotch(displays)` : l'heuristique de détection sur structures display mockées.

### Flux de données

L'île reprend le canal du popover à l'identique : watcher/usage → main →
`webContents.send('island-update', snapshot)`. `preload-island.js` expose le pont
(contextIsolation, comme `preload.js`).

## Suppressions

- `popoverWindow` dans `main.js`, `preload-popover.js`, `ui/popover*` : supprimés.
- Clic sur l'icône tray : ouvre la fenêtre principale (au lieu du popover).
- Les IPC `popover-*` (`hide`, `open-main`, `quit`, `resize`) disparaissent avec.

## Config

- Toggle « Île » on/off dans les réglages, persisté via `config.js`, **activé par
  défaut** (sur les Macs sans encoche il est sans effet : pas d'île).

## Hors scope (décisions séparées, ne pas traiter ici)

- Suppression du code office (`ui/office*`, assets, bake) et sort des 4 commits v4
  locaux non poussés.
- Approbation des permissions depuis l'île (idée vue chez xisland/Vibe Island — notre
  watcher ne voit les permissions que via le hook ping ; à explorer plus tard).
- Île sur écrans sans encoche (« fausse île ») : écarté pour la v1.

## Tests & vérification

- Unit : `island-model.js` (tri, caps, +N, headless, textes, heuristique encoche) —
  même style que les tests de `tray-glance.js` et `ring-gauge.js`.
- Visuel : vérification live au CDP (`--remote-debugging-port`, sessions forgées —
  cf. workflow existant), y compris l'état replié, le survol, le pulse pending.
- Build : ajouter `island.js`, `preload-island.js`, `ui/island/` à `build.files` dans
  package.json (piège whitelist connu — crash DMG sinon, invisible en dev).
