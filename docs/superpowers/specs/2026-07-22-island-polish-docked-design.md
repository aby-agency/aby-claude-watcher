# Île : polish géométrie + mode docké — spec de design

Date : 2026-07-22 · Validée par Paul · Suite des specs dynamic-island et island-banner

## Décisions

| Sujet | Décision |
|---|---|
| Largeurs | Bannière ET panneau = largeur RÉELLE de la pilule (dynamique), coins 12px partout |
| LED coupée | Marge du gap 12 → 24 pt (le pulse scale(1.4) + halo 6px débordaient sous l'encoche) |
| Fluidité bannière | `max-height` → `transform: translateY` GPU (absolute sous la pilule, glisse de derrière elle) ; le panneau garde son pli `max-height` |
| Mode docké | L'île vit sur **l'écran principal** (celui de la barre de menu), encoche ou pas. Avec encoche : gap mesuré. Sans : gap 0 (pilule compacte, min 10px d'espace entre ailes). Toggle `islandEnabled` inchangé, défaut on. RÉVISION de « écran intégré uniquement ». |

## Règles de layout (modèle pur)

`isNotchedDisplay(d)` = `d.internal && menuBarHeight(d) ≥ 30` (les externes de Paul
ont une barre de 31 px — le critère `internal` est indispensable).

`islandLayout(display, notch, winW)` :
- mesure valide → x centré sur le centre réel de l'encoche, gap = largeur + 24 ;
- pas de mesure + display à encoche → x centré display, gap 180 (fallback sécurité) ;
- pas de mesure + display SANS encoche → x centré display, **gap 0**.

`island.js` : cible = `screen.getPrimaryDisplay()` (l'île suit la barre de menu
principale) ; mesure AppKit uniquement si `isNotchedDisplay(primary)` ; ne se
détruit plus que sur toggle off. Les bannières marchent donc en docké — le
« sans filet » de la spec bannière ne subsiste que toggle off.

## Renderer

- `ResizeObserver` sur la pilule → vars `--pill-w`/`--pill-h` ; bannière et
  panneau : `width: var(--pill-w)` + `box-sizing: border-box`, rayon 12px.
- Gap affiché = `max(gapPx, 10)` px (respiration entre ailes en pilule compacte).
- Bannière : `position: absolute` sous la pilule (z-index sous elle), animation
  `translate(-50%, -100%) → translate(-50%, 0)` + opacity, easing doux
  (`cubic-bezier(.32,.72,.28,1)`, ~280 ms). Comportements inchangés (4 s, une
  seule, clic = focus, hit-test, `setMouse(false)` en fin de hideBanner).

## Tests & vérification

- Modèle : tests mis à jour (marge 24) + nouveaux cas (externe → gap 0 ;
  encoche sans mesure → 180 ; `isNotchedDisplay` sur externe à barre 31 → false).
- Vérif live sur le setup docké de Paul (ultrawides) : pilule compacte au
  centre-haut de l'écran principal, bannière fluide, largeurs alignées.
