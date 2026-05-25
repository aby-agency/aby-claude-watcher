# Opacité de fenêtre — design

Date : 2026-05-25

## Objectif

Permettre de rendre la fenêtre translucide, derrière un **paramètre activable/désactivable**.
Pensé pour une fenêtre de monitoring gardée en coin (souvent `alwaysOnTop`).

## Décisions

- **Type** : opacité globale via `BrowserWindow.setOpacity()` (toute la fenêtre, texte compris).
  Pas de mode « verre » (`transparent:true` + vibrancy) — non togglable à chaud, incompatible
  avec `backgroundColor` + `titleBarStyle: hiddenInset` actuels.
- **Comportement** : translucide au repos, **opaque au focus OU au survol**.
- **Maître** : un toggle `windowTransparencyEnabled`. OFF (défaut) → `setOpacity(1)` permanent,
  aucune logique focus/hover, curseur grisé. Opt-in : zéro changement pour l'existant.
- **Plancher** : opacité réglable de **30 % à 100 %** (en-dessous on risque de perdre la fenêtre).
- **Défaut du curseur** : 85 % (visible mais lisible) quand le toggle est activé.
- **Portée** : niveau fenêtre → s'applique pareil en grid / compact / micro.

## Modèle

Opacité effective :

```
si !windowTransparencyEnabled        → 1.0
sinon si (focused || hovered)        → 1.0
sinon                                → windowOpacity   (0.3 – 1.0)
```

## Fichiers touchés

### `config.js`
- Champs : `windowTransparencyEnabled: false`, `windowOpacity: 0.85`
- `setWindowTransparencyEnabled(bool)` → coercition booléenne + `save()`
- `setWindowOpacity(value)` → clamp `[0.3, 1.0]` + `save()` (calqué sur `setVolume`)
- Exports des deux

### `main.js`
- État module : `windowFocused`, `windowHovered`
- `applyWindowOpacity()` applique le modèle ci-dessus
- Handler `focus` (existant) → `windowFocused = true` + apply ; nouveau handler `blur` → false + apply
- IPC `set-window-transparency-enabled` → persiste + apply
- IPC `set-window-opacity` → persiste + **applique la valeur brute directement** (preview live
  pendant le drag, car la modale Réglages a le focus → sinon on verrait 100 %). La logique
  focus/hover reprend au prochain `blur`/hover.
- IPC `window-hover` (bool depuis le renderer) → `windowHovered` + apply

### `preload.js`
- Expose `setWindowTransparencyEnabled(bool)`, `setWindowOpacity(value)`, `notifyHover(bool)`

### `ui/index.html`
- Onglet **Général** : nouvelle `settings-section` avec
  - une `settings-toggle-row` (toggle `#transparencyToggle`, comme *Always on top*)
  - une `settings-row` avec slider `#opacitySlider` (min=30 max=100) + readout `#opacityValue`

### `ui/renderer.js`
- État : `windowTransparencyEnabled`, `windowOpacity`
- Init : lit la config, met à jour toggle + slider + état grisé
- Toggle → `toggleTransparency()` (persiste + maj UI grisé)
- Slider `input` → maj readout + `setWindowOpacity` (preview live ; save debounced côté config)
- Survol : `mouseenter` / `mouseleave` sur `document.documentElement` → `notifyHover()`

### `ui/styles.css`
- État grisé du curseur quand le toggle est OFF (`.settings-row.disabled`, `.slider:disabled`)
- Couleur de l'icône d'opacité

### `i18n.js`
- `transparency_label` / `transparency_hint` (FR + EN), section *general*

### `test/config.test.js`
- Clamp `setWindowOpacity` (haut/bas) + coercition booléenne `setWindowTransparencyEnabled`

## Point à vérifier à l'implémentation

Sur macOS, une fenêtre `alwaysOnTop` non-focus reçoit-elle bien les events souris DOM
(`mouseenter`/`mouseleave`) ? Si non, le survol-pour-opaque ne déclenchera pas — le focus
reste de toute façon fonctionnel comme repli.
