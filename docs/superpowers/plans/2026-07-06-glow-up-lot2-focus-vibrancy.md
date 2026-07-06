# Glow up Lot 2 — Bon citoyen macOS (Focus/DND) + verre expérimental (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de l'app un bon citoyen macOS — couper son + bell needs-you quand un Focus/DND est actif — et offrir le vrai Liquid Glass en toggle **expérimental** relié au curseur transparence, plus solder les 4 Minors de polish reportés du Lot 1.

**Architecture:** Un module pur `focus-state.js` lit la base Do Not Disturb macOS et expose `isFocusActive()`. Les deux points d'émission sonore/bannière (déjà co-localisés au Lot 1) se gardent derrière `!isFocusActive()`. Un flag config `vibrancyExperimental` recrée la fenêtre principale avec `vibrancy`/`visualEffectState`, exposé dans les réglages avec avertissement Tahoe.

**Tech Stack:** Electron 41 (`BrowserWindow.vibrancy`, `visualEffectState`), Node `fs` (lecture JSON DND), tests `node test/*.test.js` (mini-harness maison).

## Global Constraints

- **Aucun `git push` / tag / release** sans demande explicite de Paul. Commits locaux par tâche OK.
- Commits **signés Paul uniquement** — pas de trailer `Co-Authored-By: Claude`.
- **`build.files` :** `focus-state.js` (nouveau module racine) DOIT être ajouté à `package.json > build.files`, sinon crash DMG.
- Nouveau module pur ⇒ export propre + test `node test/focus-state.test.js` ajouté à la chaîne `npm test`.
- **Ne pas régresser les garde-fous notif du Lot 1** : cooldown 30s (watcher), défèrement 5s pending + relecture fraîche, suppression background, `blockingForegroundAgent`, bannière native `silent` co-localisée au son.
- L'app reste **dark-committed**. Vibrancy = **opt-in expérimental, défaut off**, jamais sur le chemin nominal.
- Vérif visuelle (vibrancy) déléguée à une passe manuelle / capture offscreen — pas de display en subagent.

---

### Task 1: `focus-state.js` — lecture de l'état Focus/DND (module pur + test)

**Files:**
- Create: `focus-state.js` (racine)
- Create: `test/focus-state.test.js`
- Modify: `package.json` (script `test`, `build.files`)

**Interfaces:**
- Produces :
  - `parseFocusAssertions(jsonString) → boolean` — pur : `true` si le JSON contient au moins une assertion Focus active. Tolérant : JSON invalide / structure inconnue → `false`.
  - `isFocusActive() → boolean` — lit `~/Library/DoNotDisturb/DB/Assertions.json` (via `fs.readFileSync`, try/catch → `false` si absent/illisible) et retourne `parseFocusAssertions(contenu)`.
  - Consommé par la Task 2.

- [ ] **Step 1: Write the failing test**

Créer `test/focus-state.test.js`. La forme du fichier DND macOS : un objet avec une clé `data` (tableau), chaque entrée pouvant contenir `storeAssertionRecords` (tableau non vide quand un Focus est actif). On teste le parseur pur sur des chaînes représentatives :

```js
// Tests for focus-state.js. Run: node test/focus-state.test.js
const { parseFocusAssertions } = require('../focus-state.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const ACTIVE = JSON.stringify({ data: [ { storeAssertionRecords: [ { assertionDetails: { assertionDetailsModeIdentifier: 'com.apple.focus.work' } } ] } ] });
const INACTIVE_EMPTY = JSON.stringify({ data: [ {} ] });
const INACTIVE_NO_RECORDS = JSON.stringify({ data: [ { storeAssertionRecords: [] } ] });

console.log('\nparseFocusAssertions:');
test('active focus assertion → true', () => assertEq(parseFocusAssertions(ACTIVE), true));
test('empty data entry → false', () => assertEq(parseFocusAssertions(INACTIVE_EMPTY), false));
test('empty records array → false', () => assertEq(parseFocusAssertions(INACTIVE_NO_RECORDS), false));
test('no data key → false', () => assertEq(parseFocusAssertions('{}'), false));
test('invalid JSON → false (never throws)', () => assertEq(parseFocusAssertions('not json'), false));
test('empty string → false', () => assertEq(parseFocusAssertions(''), false));
test('null → false', () => assertEq(parseFocusAssertions(null), false));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/focus-state.test.js`
Expected: FAIL (`Cannot find module '../focus-state.js'`)

- [ ] **Step 3: Write minimal implementation**

Créer `focus-state.js` :

```js
// Reads the macOS Do Not Disturb / Focus state. No Electron deps → unit-testable.
// Approach mirrors the `getfocus`/`infocus` CLIs: the DND DB writes an
// Assertions.json whose active-focus entries carry non-empty storeAssertionRecords.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DND_ASSERTIONS = path.join(os.homedir(), 'Library', 'DoNotDisturb', 'DB', 'Assertions.json');

function parseFocusAssertions(jsonString) {
  if (!jsonString || typeof jsonString !== 'string') return false;
  let obj;
  try { obj = JSON.parse(jsonString); } catch { return false; }
  const data = obj && Array.isArray(obj.data) ? obj.data : [];
  return data.some(
    (entry) => entry && Array.isArray(entry.storeAssertionRecords) && entry.storeAssertionRecords.length > 0
  );
}

function isFocusActive() {
  if (process.platform !== 'darwin') return false;
  try {
    return parseFocusAssertions(fs.readFileSync(DND_ASSERTIONS, 'utf-8'));
  } catch {
    return false; // absent/illisible → considérer "pas de Focus" (comportement actuel)
  }
}

module.exports = { parseFocusAssertions, isFocusActive, DND_ASSERTIONS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/focus-state.test.js`
Expected: `7 passed, 0 failed`

- [ ] **Step 5: Wire into the test chain + build.files**

Dans `package.json`, ajouter `&& node test/focus-state.test.js` à la fin du script `test`, et `"focus-state.js"` au tableau `build.files`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: tout passe, dont `focus-state`.

- [ ] **Step 7: Commit**

```bash
git add focus-state.js test/focus-state.test.js package.json
git commit -m "feat(focus): focus-state.js — lecture de l'état Focus/DND macOS (module pur + test)"
```

**Note d'implémentation (à vérifier sur machine réelle) :** le schéma exact d'`Assertions.json` varie selon la version macOS. Le parseur cible « une entrée avec `storeAssertionRecords` non vide ». Si sur Tahoe la clé diffère, ajuster `parseFocusAssertions` ET les fixtures du test ensemble (garder la propriété « tolérant aux formats inconnus → false »).

---

### Task 2: Couper son + bannière quand un Focus est actif

**Files:**
- Modify: `main.js` (handler `session-waiting` ~280-310 ; `schedulePendingSound()` ~62-82)

**Interfaces:**
- Consumes : `isFocusActive()` (Task 1).

- [ ] **Step 1: Import + gate the immediate `waiting` sound/banner**

Dans `main.js`, importer en haut : `const { isFocusActive } = require('./focus-state');`. Dans le handler `session-waiting`, la branche `else` (waiting) émet déjà, sous `if (prefs.sound)`, `sendToRenderer('play-sound', …)` puis (Lot 1) `emitNativeNotification(session.sessionId)`. Envelopper ces deux lignes dans `if (!isFocusActive()) { … }` de sorte qu'un Focus actif coupe **son + bannière** pour waiting. Le toast in-app (`show-notification`) et le log forensique restent **hors** de cette garde (le toast visuel n'est pas intrusif). Ajouter un log : `if focusActive → log.info('[notif] suppressed sound/banner — Focus active')`.

- [ ] **Step 2: Gate the deferred `pending` sound/banner**

Dans `schedulePendingSound()`, le callback du timer émet (après la garde « pending résolu en <5s ») `sendToRenderer('play-sound', { kind: 'pending', sessionId })` puis `emitNativeNotification(sessionId)`. Envelopper ces deux lignes dans `if (!isFocusActive()) { … }` (même log de suppression). La relecture fraîche `watcher.refreshSession` et la garde de résolution restent inchangées, **avant** la vérif Focus.

- [ ] **Step 3: Verification**

Run: `npm test` (non-régression) puis `node --check main.js`.
Auto-relecture : quand `isFocusActive()` renvoie true, ni son ni bannière ne partent (waiting ET pending) ; le toast in-app reste ; toutes les gardes Lot 1 sont intactes avant la vérif Focus. Test manuel réel (Task 4/passe finale) : activer un Focus macOS, déclencher un waiting → pas de ding ni bannière ; désactiver → ding revient.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat(focus): couper son + bannière needs-you quand un Focus macOS est actif"
```

---

### Task 3: Toggle vibrancy expérimental (vrai Liquid Glass)

**Files:**
- Modify: `main.js` (opts `BrowserWindow` ~175 ; IPC handlers de transparence ~430-442)
- Modify: `config.js` (nouveau flag `vibrancyExperimental`)
- Modify: `ui/index.html` (réglage dans l'onglet General) + `ui/renderer.js` (câblage du toggle)

**Interfaces:**
- Consumes : `config.get().vibrancyExperimental` (bool, défaut `false`).
- Produces : IPC `set-vibrancy-experimental` (bool) → recrée/param la fenêtre.

- [ ] **Step 1: Config flag**

Dans `config.js`, ajouter `vibrancyExperimental: false` aux valeurs par défaut (près de `windowOpacity`/`transparency`), avec getter/setter suivant le pattern existant. `saveSync`/restore le prennent en compte comme les autres champs.

- [ ] **Step 2: Apply vibrancy at window creation**

Dans `main.js`, à la création de `mainWindow` (opts ~175, actuellement `backgroundColor: '#0d1117'` — désormais aligné Soft Glass) : si `config.get().vibrancyExperimental` est vrai, poser `vibrancy: 'hud'`, `visualEffectState: 'active'`, `backgroundColor: '#00000000'` (transparent pour laisser passer le verre) et `transparent: true` ; sinon garder l'opaque actuel. Ajouter un helper `windowOptsForVibrancy(base)` pur-ish qui fusionne ces clés selon le flag, pour garder la création lisible.

- [ ] **Step 3: IPC toggle + relaunch note**

Ajouter l'IPC `set-vibrancy-experimental` (`ipcMain.handle`) qui persiste le flag via config. Le changement de matière de fenêtre nécessitant une recréation propre, l'IPC renvoie un statut « redémarrage requis » ; le renderer affiche un hint « Redémarrer l'app pour appliquer ». (Ne PAS détruire/recréer `mainWindow` à chaud dans cette tâche — trop risqué ; recréation au prochain lancement.)

- [ ] **Step 4: Settings UI**

Dans `ui/index.html`, onglet General, ajouter une `settings-section` avec un `settings-toggle` `id="vibrancyToggle"` (même markup que `transparencyToggle`), libellé i18n `vibrancy_label` / hint `vibrancy_hint` (« Verre translucide (expérimental) » / avertissement « Instable sur macOS Tahoe — off par défaut »). Ajouter les clés i18n FR+EN dans `i18n.js`. Dans `ui/renderer.js`, câbler le toggle sur l'IPC `set-vibrancy-experimental` en suivant le pattern de `transparencyToggle`, et afficher le hint « redémarrer » au changement.

- [ ] **Step 5: Verification**

Run: `npm test`, `node --check main.js`, `node --check ui/renderer.js`.
Auto-relecture : flag défaut `false` (chemin nominal = opaque Soft Glass inchangé) ; toggle on → persiste + hint redémarrage ; au relancement avec flag on, la fenêtre est créée avec `vibrancy`. Passe visuelle réelle déléguée (capture offscreen ne montre pas le vibrancy natif — test manuel sur machine requis, documenté comme tel).

- [ ] **Step 6: Commit**

```bash
git add main.js config.js ui/index.html ui/renderer.js i18n.js
git commit -m "feat(window): toggle vibrancy expérimental (Liquid Glass), off par défaut, avertissement Tahoe"
```

---

### Task 4: Solde des 4 Minors de polish (Lot 1)

**Files:**
- Modify: `ui/styles.css` (dead `.state-dot` ; popover `.pop-item` inset)
- Modify: `ui/popover.html` (glow → dial `--glow`)
- Modify: `main.js` (`updateDockBadge()` ~889 alignement compteur)

**Interfaces:**
- Aucune nouvelle ; nettoyage/cohérence.

- [ ] **Step 1: Remove dead `.state-dot` CSS**

Dans `ui/styles.css`, supprimer les règles `.state-dot` mortes (repérées au Lot 1 vers lignes ~796 et ~1674-1696 — le renderer émet `.compact-dot`/`.micro-item-dot`, jamais `.state-dot`). Vérifier par `grep -n "state-dot" ui/renderer.js` (0 hit attendu) avant suppression.

- [ ] **Step 2: Popover glow → suit le dial `--glow`**

Dans `ui/popover.html`, les règles `.pop-item[data-state="pending|waiting|error"]` utilisent un `box-shadow` de glow à intensité fixe. Remplacer l'opacité/intensité par une valeur pilotée par `var(--glow)` (ex. via `color-mix` ou une `opacity` sur un pseudo, comme la grille) pour que le popover suive le réglage global. Garder l'aspect opaque (pas de `backdrop-filter`).

- [ ] **Step 3: `.pop-item` prend `--card-inset`**

Toujours dans `ui/popover.html`, ajouter `var(--card-inset)` au `box-shadow` de `.pop-item` (comme `.card`) pour le léger highlight de bord haut — aligne les rows du popover sur la matière des cartes.

- [ ] **Step 4: Aligner le compteur dock sur le glance tray**

Dans `main.js`, `updateDockBadge()` (~889) compte `pending+waiting` en **incluant** les background et **excluant** `error`, alors que `trayGlance` compte `pending+waiting+error` en **excluant** les background. Faire consommer à `updateDockBadge()` le même agrégat : réutiliser `trayGlance(sessions.map(s => ({ state: effectiveStateName(s), isBackground: s.isBackground })), {}).count` pour le badge dock, afin que dock et tray affichent le **même** nombre. Vérifier que ça n'introduit pas de dépendance circulaire (import déjà présent depuis le Lot 1).

- [ ] **Step 5: Verification**

Run: `npm test`, `node --check main.js`.
Auto-relecture : plus aucune règle `.state-dot` ; popover glow lié à `--glow` et toujours opaque ; `.pop-item` a l'inset ; dock et tray comptent pareil (pending+waiting+error, hors background). Passe visuelle (capture offscreen popover + grille) à la fin.

- [ ] **Step 6: Commit**

```bash
git add ui/styles.css ui/popover.html main.js
git commit -m "chore(ui): solde polish Lot 1 — dead CSS, popover glow/inset, compteur dock=tray"
```

---

## Self-Review

**Spec coverage (Lot 2, section « Lot 2 » du spec 2026-07-06) :**
- 2.1 Respect Focus/DND (module `focus-state.js` lisant `Assertions.json`, suppression son/bell) → Task 1 (module) + Task 2 (câblage) ✅
- 2.2 Vibrancy expérimental (toggle relié à la transparence, avertissement Tahoe, off par défaut) → Task 3 ✅
- 4 Minors reportés du Lot 1 (dead `.state-dot`, popover hors dial `--glow`, `.pop-item` sans `--card-inset`, divergence dock/tray) → Task 4 ✅
- Dégradations (fichier DND illisible → false ; vibrancy off par défaut ; build.files) → Task 1 Step 3 + Global Constraints ✅

**Risque connu / à confirmer sur machine :** schéma exact d'`Assertions.json` sur macOS Tahoe (Task 1 note) ; comportement réel de `vibrancy: 'hud'` sur Tahoe (instable — c'est précisément pourquoi c'est un opt-in expérimental). Ces deux points demandent une validation manuelle sur la machine de Paul, non couvrable en subagent headless.
