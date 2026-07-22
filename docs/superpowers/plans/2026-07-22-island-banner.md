# Bannière d'île + suppression notifs Apple — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les notifications système macOS par une bannière transitoire qui descend de l'île (4 s, clic = focus), sans aucun fallback.

**Architecture:** `bannerPayload` (pur, `island-model.js`), `sendBanner` (`island.js`, auto-gardé), bannière renderer (`ui/island/`), et dans `main.js` le remplacement in-situ des 2 appels `emitNativeNotification` — les gardes existantes (prefs, cooldown, defer 5 s, Focus) sont conservées telles quelles. Spec : `docs/superpowers/specs/2026-07-22-island-banner-design.md`.

**Tech Stack:** identique au projet (Electron vanilla, tests node purs).

## Global Constraints

- Commits signés Paul uniquement — AUCUN trailer `Co-Authored-By` ; jamais de push.
- `npm test` doit rester verte après chaque tâche ; aucun nouveau fichier racine (build.files inchangé).
- La bannière hérite du gating EXISTANT : elle ne s'émet qu'aux 2 points où partait la notif Apple (chemin pending différé 5 s + chemin waiting immédiat), donc uniquement si `prefs.sound` est activé pour la session, hors Focus macOS. Ne PAS élargir.
- **Note assumée (constatée dans le code, à relayer à Paul)** : l'état `error` n'a AUCUN chemin de notification aujourd'hui (Apple comprise) — la bannière couvre donc pending/waiting, à l'identique de ce qu'elle remplace. Ajouter un chemin error serait un nouveau scope, hors plan.
- Le panneau ne s'auto-déplie toujours pas : la bannière est le seul mouvement autonome ajouté.
- Textes via i18n (`state_*` existants) ; interpolations DOM en `textContent` (pas d'innerHTML pour la bannière).

---

### Task 1: `bannerPayload` (modèle pur, TDD)

**Files:**
- Modify: `island-model.js`, `test/island-model.test.js`

**Interfaces:**
- Consumes: session watcher `{ sessionId, projectName, state: { name } }` + customName (string|null).
- Produces: `bannerPayload(session, customName) → { sessionId, name, state }` exporté dans l'API du module (node + `window.islandModel`).

- [ ] **Step 1 : Tests (RED)** — ajouter avant le footer `console.log(\`\n${passed}...\`)` de `test/island-model.test.js` :

```js
console.log('\nbannerPayload:');
test('customName prioritaire, puis projectName, puis fallback', () => {
  const s = { sessionId: 'x', projectName: 'proj', state: { name: 'waiting' } };
  assertEq(bannerPayload(s, 'mon-nom'), { sessionId: 'x', name: 'mon-nom', state: 'waiting' });
  assertEq(bannerPayload(s, null).name, 'proj');
  assertEq(bannerPayload({ sessionId: 'y', state: { name: 'pending' } }, null).name, 'Claude Code');
});
test('state extrait du nom d\'état ; null si absent', () => {
  assertEq(bannerPayload({ sessionId: 'z', projectName: 'p', state: { name: 'pending' } }, null).state, 'pending');
  assertEq(bannerPayload({ sessionId: 'z', projectName: 'p' }, null).state, null);
});
```
Et ajouter `bannerPayload` à la ligne de require en tête du fichier de test.

Run : `node test/island-model.test.js` — Attendu : FAIL `bannerPayload is not a function`.

- [ ] **Step 2 : Implémentation** — dans `island-model.js`, après `islandLayout` :

```js
// Payload de la bannière needs-you — construit depuis une session watcher
// fraîche (main.js re-lit par id avant d'appeler : jamais d'objet périmé).
function bannerPayload(session, customName) {
  return {
    sessionId: session.sessionId,
    name: customName || session.projectName || 'Claude Code',
    state: (session.state && session.state.name) || null,
  };
}
```
Et l'ajouter à `const api = { ... }`.

Run : `node test/island-model.test.js` — Attendu : `18 passed, 0 failed`.

- [ ] **Step 3 : Suite + commit**

Run : `npm test` — Attendu : vert.
```bash
git add island-model.js test/island-model.test.js
git commit -m "feat(island): bannerPayload — payload pur de la bannière needs-you"
```

---

### Task 2: Câblage main + suppression des notifs Apple

**Files:**
- Modify: `island.js`, `preload-island.js`, `main.js`, `i18n.js`

**Interfaces:**
- Consumes: `bannerPayload` (Task 1), `island.sendBanner` (créé ici).
- Produces: canal IPC `island-banner` ; `window.islandApi.onBanner(cb)` ; plus AUCUNE notification macOS dans l'app.

- [ ] **Step 1 : `island.js`** — ajouter après `sendUpdate()` et exporter :

```js
// Bannière needs-you — auto-gardée : sans île visible, silence (aucun fallback).
function sendBanner(payload) {
  if (win && !win.isDestroyed() && win._loaded && win.isVisible()) {
    win.webContents.send('island-banner', payload);
  }
}
```
`module.exports = { refresh, destroy, sendUpdate, sendBanner, setHover, window: () => win };`

- [ ] **Step 2 : `preload-island.js`** — ajouter au pont :

```js
onBanner: (cb) => ipcRenderer.on('island-banner', (_, b) => cb(b)),
```

- [ ] **Step 3 : `main.js` — remplacer la fonction et ses 2 appels**

1. Ajouter `bannerPayload` au require existant d'island-model… il n'y en a pas dans main.js : ajouter en tête, à côté de `const island = require('./island');` :
```js
const { bannerPayload } = require('./island-model');
```
2. Remplacer INTÉGRALEMENT la fonction `emitNativeNotification` (~lignes 92-109, commentaire compris) par :
```js
// Bannière d'île — remplace l'ex-notification macOS (supprimée sans fallback,
// décision Paul 2026-07-22) : mêmes points d'appel, donc mêmes gardes
// (prefs.sound, defer 5s du pending, Focus). Re-lit la session par id pour
// ne jamais émettre depuis un objet périmé. Clic-bannière = focus, côté renderer.
function emitIslandBanner(sessionId) {
  const s = watcher.getSessions().find(x => x.sessionId === sessionId);
  if (!s) return;
  island.sendBanner(bannerPayload(s, config.getCustomName(sessionId)));
}
```
3. Remplacer les 2 appels `emitNativeNotification(sessionId);` (~ligne 84) et `emitNativeNotification(session.sessionId);` (~ligne 352) par `emitIslandBanner(sessionId);` / `emitIslandBanner(session.sessionId);`.
4. Retirer `Notification` du destructuring d'electron ligne 1 (seul usage : la fonction supprimée — vérifier par `grep -n "Notification" main.js` qu'il ne reste que `notifEnabled`/`NotificationPrefs`, qui n'ont rien à voir).
5. `i18n.js` : retirer `notif_body_pending` et `notif_body_waiting` des DEUX blocs fr et en (seul usage : la fonction supprimée — vérifier par `grep -rn "notif_body" main.js ui/` → vide après l'édit).

- [ ] **Step 4 : Vérifications**

Run : `grep -n "new Notification\|emitNativeNotification" main.js` — Attendu : vide.
Run : `node --check main.js && node --check island.js && node --check preload-island.js` — clean.
Run : `npm test` — vert.

- [ ] **Step 5 : Commit**

```bash
git add island.js preload-island.js main.js i18n.js
git commit -m "feat(island): bannière needs-you via island-banner, suppression des notifs macOS"
```

---

### Task 3: Bannière côté renderer

**Files:**
- Modify: `ui/island/island.html`, `ui/island/island.css`, `ui/island/island.js`

**Interfaces:**
- Consumes: `window.islandApi.onBanner`, `focusSession`, `setHover` ; clés i18n `state_*` ; classes `.led[data-state]` existantes.
- Produces: bannière visuelle 4 s, clic = focus, intégrée au hit-test du click-through.

- [ ] **Step 1 : `island.html`** — insérer entre la `div.pill` et la `div.panel` :

```html
    <div class="banner" id="banner">
      <span class="led" id="bannerLed"></span>
      <span class="banner-text" id="bannerText"></span>
    </div>
```

- [ ] **Step 2 : `island.css`** — ajouter après le bloc `.more` :

```css
/* Bannière needs-you — glisse de sous la pilule, 4 s, une seule à la fois.
   Seul mouvement autonome de l'île (le panneau reste hover-only). */
.banner {
  display: flex; align-items: center; gap: 8px;
  width: 250px;
  background: #000; border-radius: 0 0 12px 12px;
  padding: 0 14px;
  font-size: 12px; color: #e8eaf0;
  max-height: 0; overflow: hidden;
  transition: max-height .22s ease;
  cursor: pointer;
}
.banner.visible { max-height: 32px; padding-bottom: 8px; padding-top: 4px; }
/* Panneau ouvert → la bannière s'efface (le JS la masque aussi). */
body.expanded .banner { max-height: 0; padding-top: 0; padding-bottom: 0; }
.banner-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 3 : `island.js`** — deux modifications.

1. REMPLACER le bloc hover existant (de `let hovering = false;` jusqu'au listener `blur` inclus) par :

```js
// ── Hover machinery ──
// hovering pilote le click-through (IPC) ; l'expansion du panneau est
// distincte : pilule/panneau seulement — survoler la bannière rend les clics
// possibles SANS déplier le panneau.
let hovering = false;
function inRect(el, x, y, pad = 0) {
  const r = el.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
function setMouse(next) {
  if (next === hovering) return;
  hovering = next;
  window.islandApi.setHover(hovering);
}
function setExpanded(next) {
  if (next === document.body.classList.contains('expanded')) return;
  document.body.classList.toggle('expanded', next);
  if (next) hideBanner(); // le panneau prend le dessus
}
document.addEventListener('mousemove', (e) => {
  const overPill = inRect(document.getElementById('pill'), e.clientX, e.clientY, 4);
  const expanded = document.body.classList.contains('expanded');
  const overPanel = expanded && inRect(document.getElementById('panel'), e.clientX, e.clientY, 4);
  const $banner = document.getElementById('banner');
  const overBanner = $banner.classList.contains('visible') && inRect($banner, e.clientX, e.clientY, 4);
  setMouse(overPill || overPanel || overBanner);
  setExpanded(overPill || overPanel);
});
document.addEventListener('mouseleave', () => { setMouse(false); setExpanded(false); });
window.addEventListener('blur', () => { setMouse(false); setExpanded(false); });
```

2. AJOUTER, juste au-dessus de `window.islandApi.onUpdate(scheduleRefresh);` :

```js
// ── Bannière needs-you ──
const BANNER_MS = 4000;
let bannerTimer = null;
let bannerSessionId = null;
function hideBanner() {
  if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
  bannerSessionId = null;
  document.getElementById('banner').classList.remove('visible');
}
window.islandApi.onBanner((b) => {
  if (document.body.classList.contains('expanded')) return; // panneau ouvert
  bannerSessionId = b.sessionId;
  document.getElementById('bannerLed').dataset.state = b.state || '';
  // textContent : pas d'injection possible, pas d'échappement nécessaire.
  document.getElementById('bannerText').textContent =
    `${b.name} — ${window.i18n.t('state_' + b.state)}`;
  document.getElementById('banner').classList.add('visible');
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, BANNER_MS);
});
document.getElementById('banner').addEventListener('click', () => {
  if (bannerSessionId) window.islandApi.focusSession(bannerSessionId);
  hideBanner();
});
```

(NB : `hideBanner` est référencée par `setExpanded` défini plus haut — le hoisting des déclarations `function` couvre l'ordre.)

- [ ] **Step 4 : Vérifications + commit**

Run : `node --check ui/island/island.js` — clean. `npm test` — vert.
```bash
git add ui/island/
git commit -m "feat(island): rendu bannière — slide 4s, clic focus, hit-test click-through"
```

---

### Task 4: Vérification e2e (contrôleur, CDP + app réelle)

- [ ] Relancer la dev (`pkill` + `npx electron . --dev --remote-debugging-port=9222`).
- [ ] Activer la cloche (prefs sound) d'une session de test si nécessaire (la bannière hérite du gating `prefs.sound`).
- [ ] Via CDP sur la page île : simuler `island-banner` n'est pas possible côté renderer sans main — passer par un VRAI événement (fin de tour d'une session → waiting) OU `Runtime.evaluate` du main (port --inspect) appelant `island.sendBanner({...})` de test.
- [ ] Vérifier : descente sous la pilule, ~4 s, remontée ; remplacement si 2e événement ; survol pilule → panneau + bannière masquée ; clic bannière → focus terminal ; AUCUNE notification dans le Centre de notifications macOS.
- [ ] `npm test` + captures pour Paul.
