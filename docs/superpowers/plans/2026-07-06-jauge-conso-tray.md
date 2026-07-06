# Jauge de conso Claude (anneau dans le tray) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher la conso Claude 5 h dans la barre de menu macOS sous forme d'un anneau de progression coloré + le texte `5H 27% · 35m`, en se greffant sur l'infra usage/tray déjà présente.

**Architecture:** La source de données existe déjà (`usage.js` → `UsageMonitor`, snapshot dans `lastUsage`). On ajoute un module pur `ring-gauge.js` (couleur de seuil, compte à rebours, SVG d'anneau, label) puis on branche deux points de `main.js` : `generateTrayIcon` (dessine l'anneau) et `refreshTrayGlance` (titre + priorité). Aucun canal statusline, aucune écriture dans la config utilisateur.

**Tech Stack:** Node.js CommonJS, Electron (`nativeImage.createFromDataURL` avec SVG inline), tests maison `node test/*.test.js`.

## Global Constraints

- **CommonJS** : `require` / `module.exports`, pas d'ESM.
- **Module pur = zéro dépendance Electron** (patron `tray-glance.js`, `focus-state.js`) pour rester testable en `node`.
- **Tests** : fichier `test/<x>.test.js` avec le patron maison (`test()` / `assertEq()`), enregistré dans `package.json` → `scripts.test` (chaîne `&&`).
- **`build.files`** : tout nouveau `.js` doit être ajouté à `package.json` → `build.files`, sinon absent du DMG (crash en prod, invisible en dev).
- **Couleurs de seuil** (système macOS, verbatim) : `#28c451` (< 50 %), `#ff9f0a` (50–80 %), `#ff453a` (> 80 %).
- **Priorité tray (option A)** : une session en attention (`g.count > 0`) garde la priorité ; l'anneau conso ne s'affiche que si `g.count === 0`. Ne pas modifier le comportement d'alerte existant.
- **Icône tray** : SVG `width="16" height="16"`, `nativeImage.createFromDataURL('data:image/svg+xml;base64,...')`, `setTemplateImage(false)` pour garder la couleur réelle.

---

## File Structure

- **Create** `ring-gauge.js` — module pur : `gaugeColor`, `formatCountdown`, `ringSvg`, `trayUsageLabel`.
- **Create** `test/ring-gauge.test.js` — tests du module.
- **Modify** `package.json` — `scripts.test` (+ `ring-gauge.test.js`), `build.files` (+ `ring-gauge.js`).
- **Modify** `main.js` — `require` du module ; `generateTrayIcon(color, pct)` (l.848) ; `refreshTrayGlance()` (l.900-917).

---

### Task 1: Module pur `ring-gauge.js` (TDD)

**Files:**
- Create: `ring-gauge.js`
- Test: `test/ring-gauge.test.js`
- Modify: `package.json` (scripts.test, build.files)

**Interfaces:**
- Consumes: rien.
- Produces:
  - `gaugeColor(pct: number) → '#28c451' | '#ff9f0a' | '#ff453a' | null`
  - `formatCountdown(resetsAt: number|string|null, nowMs: number) → string` (`"35m"`, `"1h12"`, `"reset"`)
  - `ringSvg(pct: number, color: string|null) → string` (SVG 16×16)
  - `trayUsageLabel(usage: {fiveHour?:{utilization?:number, resetsAt?:number|string}}|null, nowMs: number) → string|null` (`"5H 27% · 35m"`)

- [ ] **Step 1: Write the failing test**

Create `test/ring-gauge.test.js`:

```javascript
// Tests for ring-gauge.js. Run: node test/ring-gauge.test.js
const { gaugeColor, formatCountdown, ringSvg, trayUsageLabel } = require('../ring-gauge.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const GREEN = '#28c451', AMBER = '#ff9f0a', RED = '#ff453a';
const NOW = 1783000000000; // ms fixe
const SEC = 1783000000;     // = NOW/1000

console.log('\ngaugeColor:');
test('27% → vert', () => assertEq(gaugeColor(27), GREEN));
test('49% → vert', () => assertEq(gaugeColor(49), GREEN));
test('50% → ambre', () => assertEq(gaugeColor(50), AMBER));
test('80% → ambre', () => assertEq(gaugeColor(80), AMBER));
test('81% → rouge', () => assertEq(gaugeColor(81), RED));
test('100% → rouge', () => assertEq(gaugeColor(100), RED));
test('null → null', () => assertEq(gaugeColor(null), null));
test('NaN → null', () => assertEq(gaugeColor(NaN), null));
test('négatif → null', () => assertEq(gaugeColor(-5), null));

console.log('\nformatCountdown:');
test('secondes, 35 min → "35m"', () => assertEq(formatCountdown(SEC + 2100, NOW), '35m'));
test('secondes, 72 min → "1h12"', () => assertEq(formatCountdown(SEC + 4320, NOW), '1h12'));
test('ms (>1e12) traité comme ms', () => assertEq(formatCountdown((SEC + 2100) * 1000, NOW), '35m'));
test('reset passé → "reset"', () => assertEq(formatCountdown(SEC - 100, NOW), 'reset'));
test('null → "reset"', () => assertEq(formatCountdown(null, NOW), 'reset'));
test('ISO string futur', () => assertEq(formatCountdown('2026-07-06T12:00:00.000Z', Date.parse('2026-07-06T11:25:00.000Z')), '35m'));

console.log('\nringSvg:');
test('anneau coloré contient la couleur + rotation', () => {
  const s = ringSvg(27, GREEN);
  assert(s.includes('<svg'), 'pas de <svg');
  assert(s.includes(GREEN), 'couleur absente');
  assert(s.includes('rotate(-90'), 'arc non pivoté');
});
test('pct 0 → pas d\'arc de progression', () => {
  assert(!ringSvg(0, null).includes('rotate(-90'), 'arc présent à 0%');
});
test('clamp au-delà de 100 sans crash', () => {
  assert(ringSvg(150, RED).includes('<svg'), 'crash sur 150%');
});

console.log('\ntrayUsageLabel:');
test('5h présent → "5H 27% · 35m"', () => {
  assertEq(trayUsageLabel({ fiveHour: { utilization: 27, resetsAt: SEC + 2100 } }, NOW), '5H 27% · 35m');
});
test('arrondi de utilization', () => {
  assertEq(trayUsageLabel({ fiveHour: { utilization: 26.6, resetsAt: SEC + 2100 } }, NOW), '5H 27% · 35m');
});
test('clamp à 100', () => {
  assertEq(trayUsageLabel({ fiveHour: { utilization: 130, resetsAt: SEC + 2100 } }, NOW), '5H 100% · 35m');
});
test('pas de fiveHour → null', () => assertEq(trayUsageLabel({}, NOW), null));
test('usage null → null', () => assertEq(trayUsageLabel(null, NOW), null));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/ring-gauge.test.js`
Expected: FAIL — `Cannot find module '../ring-gauge.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `ring-gauge.js`:

```javascript
// Pure helpers for the macOS menu-bar consumption gauge. No Electron deps → unit-testable.
const RING = { cx: 8, cy: 8, r: 6, sw: 2.6 };
const CIRC = 2 * Math.PI * RING.r;
const TRACK = 'rgba(140,140,140,0.35)';

function gaugeColor(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (pct < 50) return '#28c451';
  if (pct <= 80) return '#ff9f0a';
  return '#ff453a';
}

// Accepts epoch seconds, epoch ms, or an ISO string; returns ms or null.
function toMs(resetsAt) {
  if (resetsAt == null) return null;
  if (typeof resetsAt === 'string') { const t = Date.parse(resetsAt); return Number.isNaN(t) ? null : t; }
  if (typeof resetsAt === 'number' && Number.isFinite(resetsAt)) return resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  return null;
}

function formatCountdown(resetsAt, nowMs) {
  const ms = toMs(resetsAt);
  if (ms == null) return 'reset';
  const diff = ms - nowMs;
  if (diff <= 0) return 'reset';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function ringSvg(pct, color) {
  const p = Math.max(0, Math.min(100, typeof pct === 'number' && Number.isFinite(pct) ? pct : 0)) / 100;
  const { cx, cy, r, sw } = RING;
  const track = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${sw}"/>`;
  const arc = (p > 0 && color)
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${CIRC.toFixed(3)}" stroke-dashoffset="${(CIRC * (1 - p)).toFixed(3)}" transform="rotate(-90 ${cx} ${cy})"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">${track}${arc}</svg>`;
}

function trayUsageLabel(usage, nowMs) {
  const fh = usage && usage.fiveHour;
  if (!fh || typeof fh.utilization !== 'number' || !Number.isFinite(fh.utilization)) return null;
  const pct = Math.round(Math.max(0, Math.min(100, fh.utilization)));
  return `5H ${pct}% · ${formatCountdown(fh.resetsAt, nowMs)}`;
}

module.exports = { gaugeColor, formatCountdown, ringSvg, trayUsageLabel };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/ring-gauge.test.js`
Expected: PASS — `24 passed, 0 failed`.

- [ ] **Step 5: Register in package.json**

In `package.json`, append to `scripts.test` (before the closing quote):
```
 && node test/ring-gauge.test.js
```
And add `"ring-gauge.js",` to the `build.files` array (next to `"tray-glance.js",`).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all suites pass, including `ring-gauge`.

- [ ] **Step 7: Commit**

```bash
git add ring-gauge.js test/ring-gauge.test.js package.json
git commit -m "feat(tray): ring-gauge — couleur seuil, compte à rebours, SVG anneau, label 5h"
```

---

### Task 2: Greffe dans `main.js` (anneau + titre, option A)

**Files:**
- Modify: `main.js` (require en tête ; `generateTrayIcon` l.848 ; `refreshTrayGlance` l.900-917)

**Interfaces:**
- Consumes: `gaugeColor`, `ringSvg`, `trayUsageLabel` de Task 1 ; `lastUsage.fiveHour.{utilization,resetsAt}` (déjà en mémoire) ; `trayGlance()` (existant).
- Produces: rien (feuille d'intégration).

- [ ] **Step 1: Importer le module**

Près des autres `require` en tête de `main.js` (à côté de `const { trayGlance } = require('./tray-glance');`), ajouter :

```javascript
const { gaugeColor, ringSvg, trayUsageLabel } = require('./ring-gauge');
```

- [ ] **Step 2: Étendre `generateTrayIcon` pour dessiner l'anneau**

Remplacer la signature et le bloc « couleur » de `generateTrayIcon` (l.848). Version cible complète :

```javascript
function generateTrayIcon(color, pct) {
  // Anneau de conso : pct fourni → dessine la jauge (image non-template, vraies couleurs).
  if (typeof pct === 'number' && Number.isFinite(pct) && pct >= 0) {
    const svg = ringSvg(pct, gaugeColor(pct));
    const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
    img.setTemplateImage(false);
    return img;
  }
  // No color → the static template icon (macOS tints it automatically for
  // light/dark menu bars). `Template` suffix tells Electron this is a
  // template image; the @2x variant is auto-loaded from the same directory.
  if (!color) {
    const iconPath = path.join(__dirname, 'assets', 'tray-iconTemplate.png');
    const img = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') img.setTemplateImage(true);
    return img;
  }
  // Color requested (attention needed) → a small filled dot, NOT a template
  // image, so macOS renders the actual color instead of tinting it to
  // monochrome.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5" fill="${color}"/></svg>`;
  const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  img.setTemplateImage(false);
  return img;
}
```

- [ ] **Step 3: Câbler `refreshTrayGlance` (option A)**

Remplacer le corps de `refreshTrayGlance` à partir de la ligne `const g = trayGlance(sessions, usage);` (l.907) jusqu'à la fin de la fonction (l.916) par :

```javascript
  const g = trayGlance(sessions, usage);
  const pct5h = lastUsage?.fiveHour?.utilization;
  const showUsage = g.count === 0 && typeof pct5h === 'number' && Number.isFinite(pct5h);
  try {
    tray.setImage(showUsage ? generateTrayIcon(null, pct5h) : generateTrayIcon(g.color));
  } catch (e) {
    log.warn('tray icon render failed, fallback', e);
    tray.setImage(generateTrayIcon(null));
  }
  if (g.count > 0) tray.setTitle(` ${g.count}`);
  else if (showUsage) tray.setTitle(' ' + trayUsageLabel(lastUsage, Date.now()));
  else tray.setTitle('');
```

- [ ] **Step 4: Vérification manuelle (l'app rend l'anneau)**

Quitter une éventuelle instance en cours (single-instance lock), puis :

Run: `npm start`
Expected : dans la barre de menu, quand aucune session ne réclame l'attention, l'icône est un **anneau** (couleur selon le %) et le titre affiche `5H <pct>% · <reset>` (ex. `5H 27% · 35m`). Quand une session passe en `pending`/`error`/`waiting`, on retrouve le point coloré + ` N` (comportement d'alerte inchangé).

Note : `UsageMonitor` poll après ~2 s puis toutes les 5 min ; l'anneau apparaît au premier `update`. Si aucune donnée d'usage (token Keychain absent), l'icône reste le template statique — comportement attendu.

- [ ] **Step 5: Run the test suite (non-régression)**

Run: `npm test`
Expected: toutes les suites passent (aucun test ne dépend de `main.js`, on vérifie juste l'absence de casse d'import).

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat(tray): anneau de conso + titre 5H %/reset dans la barre (option A)"
```

---

## Self-Review

**1. Spec coverage :**
- Anneau qui se remplit + couleur de seuil → `ringSvg` + `gaugeColor` (Task 1), rendu Task 2. ✓
- Temps restant depuis `resets_at` → `formatCountdown` (Task 1). ✓
- Format `5H 27% · 35m` → `trayUsageLabel` (Task 1), câblé Task 2. ✓
- Source = `usage.js`/`lastUsage`, pas de statusline → Task 2 lit `lastUsage`. ✓
- Priorité option A → `showUsage = g.count === 0` (Task 2). ✓
- Cas limites (reset passé, pas d'usage, clamp) → tests Task 1 + fallback Task 2. ✓
- `build.files` + script test → Task 1 Step 5. ✓

**2. Placeholder scan :** aucun TODO/TBD ; tout le code est fourni intégralement.

**3. Type consistency :** `gaugeColor` / `ringSvg` / `trayUsageLabel` / `formatCountdown` — mêmes noms et signatures entre Task 1 (définition + tests) et Task 2 (consommation). `lastUsage.fiveHour.{utilization,resetsAt}` cohérent avec la normalisation de `usage.js`. ✓
