# Île : polish géométrie + mode docké — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Largeurs pilule/drop unifiées, LED plus jamais sous l'encoche, bannière fluide (translateY GPU), île sur l'écran principal même sans encoche (mode docké).

**Architecture:** Règles de layout dans `island-model.js` (pur, TDD), ciblage écran principal dans `island.js`, géométrie/animation dans `ui/island/`. Spec : `docs/superpowers/specs/2026-07-22-island-polish-docked-design.md`.

## Global Constraints

- Commits signés Paul uniquement — AUCUN trailer `Co-Authored-By` ; jamais de push.
- `npm test` vert après chaque tâche ; aucun nouveau fichier (build.files inchangé).
- Comportements bannière INCHANGÉS (4 s, une seule, clic = focus + `setMouse(false)`, garde `!b.state`, hit-test) — seule l'ANIMATION change.
- Le panneau garde son pli `max-height` ; seule la bannière passe en translateY.
- Critère d'encoche : `internal && menuBar ≥ 30` — les écrans externes de Paul ont une barre de 31 px, le `internal` est indispensable.

---

### Task 1: Règles de layout (modèle pur, TDD)

**Files:** Modify: `island-model.js`, `test/island-model.test.js`

**Interfaces:**
- Produces: `isNotchedDisplay(display)` exporté ; `islandLayout` : marge 24, gap 0 si display sans encoche, fallback 180 si encoche sans mesure. `notchedInternalDisplay` réutilise `isNotchedDisplay`.

- [ ] **Step 1 (RED)** : dans `test/island-model.test.js` —
1. Ajouter `isNotchedDisplay` au require.
2. Dans le bloc `islandLayout:`, les deux tests « measured » attendent désormais `gapPx: 209` (185 + 24) au lieu de 197.
3. Le test « no measurement → … default gap 180 » : remplacer son display par un display À ENCOCHE `{ internal: true, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 34, width: 1728, height: 1083 } }` (même attendu : `{ x: 634, gapPx: 180 }`).
4. Le test « invalid measurement » : même display à encoche que ci-dessus (mêmes attendus 180).
5. Ajouter :
```js
test('display sans encoche (docké) → centré, gap 0', () => {
  const d = { internal: false, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, workArea: { x: 0, y: 31, width: 3440, height: 1409 } };
  assertEq(islandLayout(d, null, 460), { x: 1490, gapPx: 0 });
});
test('isNotchedDisplay : externe à barre 31px → false, interne encoché → true', () => {
  const ext = { internal: false, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, workArea: { x: 0, y: 31, width: 3440, height: 1409 } };
  const mbp = { internal: true, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 34, width: 1728, height: 1083 } };
  assertEq(isNotchedDisplay(ext), false);
  assertEq(isNotchedDisplay(mbp), true);
});
```
Run : `node test/island-model.test.js` — Attendu : FAIL (gap 197 ≠ 209, `isNotchedDisplay` absent, gap 180 ≠ 0).

- [ ] **Step 2 (GREEN)** : dans `island-model.js` —
1. Extraire le prédicat et le réutiliser :
```js
function isNotchedDisplay(d) {
  return !!d.internal && menuBarHeight(d) >= NOTCH_MENUBAR_MIN;
}

function notchedInternalDisplay(displays) {
  return (displays || []).find(isNotchedDisplay) || null;
}
```
2. `NOTCH_GAP_MARGIN = 24` (au lieu de 12) et branche sans-encoche :
```js
function islandLayout(display, notch, winW) {
  const valid = notch && notch.width > 0 && notch.left >= 0;
  if (valid) {
    const notchCenter = display.bounds.x + notch.left + notch.width / 2;
    return {
      x: Math.round(notchCenter - winW / 2),
      gapPx: Math.round(notch.width + NOTCH_GAP_MARGIN),
    };
  }
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - winW) / 2),
    // Display à encoche mais mesure indisponible → largeur prudente ;
    // display sans encoche (mode docké) → pilule compacte.
    gapPx: isNotchedDisplay(display) ? NOTCH_GAP_FALLBACK : 0,
  };
}
```
3. Ajouter `isNotchedDisplay` à `const api = { ... }`.
Run : `node test/island-model.test.js` — Attendu : `20 passed, 0 failed`.

- [ ] **Step 3** : `npm test` vert, puis :
```bash
git add island-model.js test/island-model.test.js
git commit -m "feat(island): layout docké — gap 0 sans encoche, marge pulse 24, isNotchedDisplay"
```

---

### Task 2: `island.js` — cibler l'écran principal

**Files:** Modify: `island.js`

**Interfaces:**
- Consumes: `isNotchedDisplay` (Task 1). `notchedInternalDisplay` n'est plus importé ici.
- Produces: île présente dès qu'`enabled` et qu'un écran principal existe.

- [ ] **Step 1** : remplacer l'import :
```js
const { isNotchedDisplay, islandLayout } = require('./island-model');
```
- [ ] **Step 2** : remplacer INTÉGRALEMENT la fonction `refresh` (commentaire compris) par :
```js
// (Re)create, reposition or drop the island. Called at startup, on every
// screen event, and when the setting toggles. L'île suit l'écran PRINCIPAL
// (barre de menu), encoche ou non — mode docké compris. La mesure est async :
// on re-lit le primary après coup.
function refresh(enabled) {
  if (!enabled) return destroy();
  const display = screen.getPrimaryDisplay();
  if (!display) return destroy();
  const measure = isNotchedDisplay(display) ? measureNotch(display) : Promise.resolve(null);
  measure.then((notch) => {
    const still = screen.getPrimaryDisplay();
    if (!still) return destroy();
    lastLayout = islandLayout(still, notch, WIN_W);
    if (!win || win.isDestroyed()) return create(still);
    applyBounds(still);
    sendGeometry();
  });
}
```
- [ ] **Step 3** : `node --check island.js` clean ; `npm test` vert ; commit :
```bash
git add island.js
git commit -m "feat(island): île sur l'écran principal — mode docké, mesure seulement si encoche"
```

---

### Task 3: Renderer — largeurs unifiées + bannière translateY

**Files:** Modify: `ui/island/island.css`, `ui/island/island.js`

**Interfaces:**
- Consumes: vars `--pill-w`/`--pill-h` (créées ici), `--notch-gap` (existant).
- Produces: bannière/panneau à la largeur de la pilule, coins 12px, slide GPU.

- [ ] **Step 1 : `island.css`** —
1. `.island` : ajouter `position: relative;` à sa règle.
2. `.pill` : ajouter `position: relative; z-index: 2;` à sa règle.
3. REMPLACER intégralement le bloc `.banner` / `.banner.visible` / `body.expanded .banner` / `.banner-text` par :
```css
/* Bannière needs-you — absolute sous la pilule, glisse de derrière elle
   (translateY GPU : le max-height re-layoutait à chaque frame, saccadé).
   Largeur = pilule (var --pill-w, poussée par ResizeObserver). */
.banner {
  position: absolute;
  z-index: 1;
  left: 50%;
  top: var(--pill-h, 34px);
  transform: translate(-50%, -100%);
  opacity: 0;
  pointer-events: none;
  display: flex; align-items: center; gap: 8px;
  width: var(--pill-w, 250px);
  box-sizing: border-box;
  background: #000; border-radius: 0 0 12px 12px;
  padding: 4px 14px 8px;
  font-size: 12px; color: #e8eaf0;
  transition: transform .28s cubic-bezier(.32, .72, .28, 1), opacity .2s ease;
  cursor: pointer;
}
.banner.visible { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
/* Panneau ouvert → bannière escamotée (le JS la masque aussi). */
body.expanded .banner { transform: translate(-50%, -100%); opacity: 0; pointer-events: none; }
.banner-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```
4. `.panel` : `width: var(--pill-w, 340px); box-sizing: border-box;` (remplace `width: 340px;`) et `border-radius: 0 0 12px 12px;` (remplace 16px).
- [ ] **Step 2 : `island.js`** — ajouter juste après la déclaration du listener `onGeometry` existant :
```js
// Largeur/hauteur réelles de la pilule → le drop (bannière, panneau) s'aligne.
const $pill = document.getElementById('pill');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--pill-w', `${$pill.offsetWidth}px`);
  document.documentElement.style.setProperty('--pill-h', `${$pill.offsetHeight}px`);
}).observe($pill);
```
Et dans le handler `onGeometry`, remplacer la ligne `setProperty` par :
```js
  // max(gap, 10) : en pilule compacte (docké, gap 0) on garde une respiration
  // entre les deux ailes.
  document.documentElement.style.setProperty('--notch-gap', `${Math.max(g.gapPx, 10)}px`);
```
- [ ] **Step 3** : `node --check ui/island/island.js` clean ; `npm test` vert ; commit :
```bash
git add ui/island/
git commit -m "feat(island): drop à largeur de pilule, coins 12, bannière translateY fluide"
```

---

### Task 4: Vérification live sur le setup docké (contrôleur)

- [ ] Relancer la dev ; vérifier : pilule compacte centrée en haut de l'écran PRINCIPAL (ultrawide), LEDs avec respiration 10px entre ailes.
- [ ] Bannière de test via inspector main (`island.sendBanner`) : slide fluide, largeur = pilule, remontée 4 s.
- [ ] Survol : panneau à la largeur de la pilule, coins alignés.
- [ ] Screenshots pour Paul ; il teste lui-même ensuite (branche non mergée tant qu'il n'a pas validé le rendu).
