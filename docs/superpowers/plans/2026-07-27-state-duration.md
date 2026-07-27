# Durée d'état (« Inactif · 12 min ») — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher depuis combien de temps chaque session est dans son état courant — badge « Inactif · 12 min » sur les cartes (grid + compact), « · 12 min » sur les rangées de l'île, tooltip avec l'horodatage absolu.

**Architecture:** `setState` (watcher.js) horodate `session.stateSince` à chaque vraie transition, persisté dans `config.sessions` ; au redémarrage, le timestamp persisté survit si l'état n'a pas changé, sinon fallback mtime du JSONL (et `pendingMark.at` pour un pending restauré). Le formatage vit dans un module pur partagé `ui/state-duration.js` (node + window). Spec : `docs/superpowers/specs/2026-07-27-state-duration-design.md`.

**Tech Stack:** Electron (main + renderers vanilla JS), tests node purs (`node test/*.js`), vérification visuelle CDP.

## Global Constraints

- **Jamais de `git push`** — commits locaux uniquement, signés Paul, **SANS trailer `Co-Authored-By`**.
- Jamais de « 0 min » affiché : sous 60 s ou sans donnée → rien (spec).
- Les overrides de présentation (`delegating`, `running`-sur-pending-bloqué) ne touchent PAS `stateSince` : le compteur ne repart pas à zéro quand le libellé bascule.
- **PIÈGE scope global renderer** : les `<script src>` partagent le même scope lexical — tout nouveau module renderer est une IIFE, aucun `const` racine (cf. CLAUDE.md).
- `ui/state-duration.js` est couvert par `ui/**/*` dans `build.files` — ne PAS toucher cette liste ; en revanche le nouveau test DOIT être chaîné dans `scripts.test`.
- Commentaires de code en français, style du fichier hôte.
- Vue micro : hors périmètre.

---

### Task 1: Module pur `ui/state-duration.js`

**Files:**
- Create: `ui/state-duration.js`
- Create: `test/state-duration.test.js`
- Modify: `package.json` (chaîne `scripts.test` uniquement)
- Modify: `ui/index.html:343` (charger le script avant renderer.js)
- Modify: `ui/island/island.html:36` (charger le script avant island.js)

**Interfaces:**
- Produces: `formatMinutes(m: number) → string|null` — `'12 min'` si < 60 min, `'1h05'` sinon, `null` si < 1 ou invalide. `formatStateDuration(sinceMs: number, nowMs?: number) → string|null` — `null` si < 60 s ou invalide. Exposés en node via `module.exports` et en renderer via `window.stateDuration`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/state-duration.test.js` sur le pattern de `test/island-model.test.js` :

```js
// Tests for ui/state-duration.js. Run: node test/state-duration.test.js
const { formatMinutes, formatStateDuration } = require('../ui/state-duration.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const NOW = 1_000_000_000_000;

console.log('\nformatMinutes:');
test('< 1 min → null (jamais de « 0 min »)', () => assertEq(formatMinutes(0), null));
test('12 → « 12 min »', () => assertEq(formatMinutes(12), '12 min'));
test('59 → « 59 min »', () => assertEq(formatMinutes(59), '59 min'));
test('60 → « 1h00 »', () => assertEq(formatMinutes(60), '1h00'));
test('92 → « 1h32 »', () => assertEq(formatMinutes(92), '1h32'));
test('65.9 flooré → « 1h05 »', () => assertEq(formatMinutes(65.9), '1h05'));
test('invalide (null/NaN/négatif) → null', () => {
  assertEq(formatMinutes(null), null);
  assertEq(formatMinutes(NaN), null);
  assertEq(formatMinutes(-5), null);
});

console.log('\nformatStateDuration:');
test('< 60 s → null', () => assertEq(formatStateDuration(NOW - 59_000, NOW), null));
test('12 min → « 12 min »', () => assertEq(formatStateDuration(NOW - 12 * 60_000, NOW), '12 min'));
test('92 min → « 1h32 »', () => assertEq(formatStateDuration(NOW - 92 * 60_000, NOW), '1h32'));
test('sinceMs absent/invalide → null', () => {
  assertEq(formatStateDuration(null, NOW), null);
  assertEq(formatStateDuration(undefined, NOW), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `node test/state-duration.test.js`
Expected: FAIL — `Cannot find module '../ui/state-duration.js'`

- [ ] **Step 3: Implémenter le module**

Créer `ui/state-duration.js` :

```js
// Durée d'état (« Inactif · 12 min ») — logique pure partagée node/window.
// IIFE obligatoire : les <script src> du renderer partagent le même scope
// lexical global, un const racine ici casserait le script suivant en
// silence (cf. PIÈGE scope global, CLAUDE.md).
(function () {
  // Minutes entières → libellé compact : « 12 min » puis « 1h05 ».
  // null sous la minute — l'appelant n'affiche alors rien.
  function formatMinutes(m) {
    if (typeof m !== 'number' || !isFinite(m) || m < 1) return null;
    const mm = Math.floor(m);
    if (mm < 60) return `${mm} min`;
    const h = Math.floor(mm / 60);
    return `${h}h${String(mm % 60).padStart(2, '0')}`;
  }

  // Epoch ms → libellé, null sous 60 s (jamais de « 0 min » fabriqué).
  function formatStateDuration(sinceMs, nowMs) {
    if (typeof sinceMs !== 'number' || !isFinite(sinceMs)) return null;
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    return formatMinutes((now - sinceMs) / 60000);
  }

  const api = { formatMinutes, formatStateDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.stateDuration = api;
})();
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `node test/state-duration.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Charger le script dans les deux HTML + chaîner le test**

Dans `ui/index.html`, avant `<script src="renderer.js">` :

```html
  <script src="state-duration.js"></script>
```

Dans `ui/island/island.html`, avant `<script src="island.js">` :

```html
  <script src="../state-duration.js"></script>
```

Dans `package.json`, ajouter à la fin de `scripts.test` :

```
&& node test/state-duration.test.js
```

- [ ] **Step 6: Commit**

```bash
git add ui/state-duration.js test/state-duration.test.js ui/index.html ui/island/island.html package.json
git commit -m "feat: module pur state-duration (formatage « 12 min »/« 1h32 »)"
```

---

### Task 2: `stateSince` dans le watcher

**Files:**
- Modify: `watcher.js` (`setState` ~985, `persistSession` ~1048, restore `start()` ~117, découverte ~276, `fastInitialLoad` ~696 et ~705)
- Test: `test/watcher.test.js` (section ajoutée)

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `session.stateSince: number|null` (epoch ms de la dernière vraie transition) ; `setState(sessionId, newState, isInitial, trigger, at?)` — `at` epoch ms optionnel, défaut `Date.now()` ; champ `stateSince` persisté dans `config.sessions[id]`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `test/watcher.test.js`, ajouter une section sur le pattern existant du fichier (runner à queue : réutiliser ses helpers `test`/`section` et les factories `makeMockConfig`/`makeSession` déjà présents) :

```js
section('stateSince');

test('setState pose stateSince à la transition (at explicite) et le persiste', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('a', makeSession('a', { state: STATES.RUNNING }));
  w.setState('a', STATES.WAITING, false, 'test', 12345);
  assert(w.sessions.get('a').stateSince === 12345, 'stateSince doit valoir le at explicite');
  assert(config._data.sessions['a'].stateSince === 12345, 'stateSince doit être persisté');
});

test('setState sans at → Date.now() approx', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('a', makeSession('a', { state: STATES.RUNNING }));
  const before = Date.now();
  w.setState('a', STATES.WAITING, false, 'test');
  const since = w.sessions.get('a').stateSince;
  assert(since >= before && since <= Date.now(), 'stateSince doit dater de maintenant');
});

test('setState même état = no-op, stateSince conservé', () => {
  const config = makeMockConfig();
  const w = new SessionWatcher(config);
  w.sessions.set('a', makeSession('a', { state: STATES.WAITING, stateSince: 777 }));
  w.setState('a', STATES.WAITING, false, 'test', 99999);
  assert(w.sessions.get('a').stateSince === 777, 'un no-op ne doit pas retoucher stateSince');
});
```

(Si le fichier n'a pas de helper `assert`, utiliser la forme d'assertion des tests voisins — `if (...) throw new Error(...)`.)

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `node test/watcher.test.js`
Expected: FAIL sur les deux premiers tests (`stateSince` undefined) ; le troisième passe par accident (no-op) — c'est attendu.

- [ ] **Step 3: Implémenter dans watcher.js**

1. **`setState`** — signature et branche `stateChanged` :

```js
  setState(sessionId, newState, isInitial, trigger, at) {
```

et dans `if (stateChanged) { ... }`, juste après `session.state = newState;` :

```js
      // Horodate la transition — la durée d'état affichée (« Inactif · 12 min »)
      // part d'ici. `at` explicite = restauration (mtime JSONL, pendingMark.at) ;
      // un no-op ne passe jamais ici, le compteur ne repart donc pas à zéro.
      session.stateSince = typeof at === 'number' ? at : Date.now();
```

2. **`persistSession`** — ajouter dans l'objet sauvé :

```js
      stateSince: session.stateSince || null,
```

3. **Restauration `start()`** (bloc `this.sessions.set(id, {...})` ligne ~117) — ajouter :

```js
          stateSince: typeof data.stateSince === 'number' ? data.stateSince : null,
```

(l'état restauré est exactement celui persisté → le timestamp persisté reste valide ; `null` pour une config d'une version antérieure = pas d'affichage, dégradation gracieuse).

4. **Découverte d'une session** (bloc `this.sessions.set(effectiveId, {...})` ligne ~276) — ajouter :

```js
              stateSince: Date.now(),
```

5. **`fastInitialLoad`**, les deux seuls appels `isInitial=true` du code :

Ligne ~696 (`pending-restored`) — le `pendingMark` date exactement la question, plus précis que le mtime :

```js
        } else {
          const mark = this.config.getPendingMark(sessionId);
          this.setState(sessionId, STATES.PENDING, true, 'pending-restored',
            (mark && typeof mark.at === 'number') ? mark.at : stat.mtimeMs);
        }
```

Ligne ~705 (`initial-scan`) — si l'état déduit == l'état restauré, `setState` est un no-op et le `stateSince` persisté survit ; sinon la transition a eu lieu app éteinte, le mtime est la meilleure approximation :

```js
        this.setState(sessionId, computedState, true, 'initial-scan', stat.mtimeMs);
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node test/watcher.test.js`
Expected: PASS (toute la suite, pas seulement la nouvelle section)

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher.test.js
git commit -m "feat: stateSince — horodatage des transitions d'état, persisté et restauré (fallback mtime)"
```

---

### Task 3: Cartes grid + compact — badge « Inactif · 12 min » + tooltip

**Files:**
- Modify: `main.js` (`serializeSession`, ~ligne 801)
- Modify: `i18n.js` (clé `state_since_abs`, blocs fr et en)
- Modify: `ui/renderer.js` (`cardHTML` ~992, `compactItemHTML` ~1098, `updateDurations` ~1120, deux helpers)
- Modify: `ui/styles.css` (`.state-duration`)

**Interfaces:**
- Consumes: `session.stateSince` (Task 2), `window.stateDuration.formatStateDuration` (Task 1).
- Produces: `stateSince: number|null` dans le payload sérialisé des sessions (consommé aussi par Task 4) ; span `.state-duration[data-since]` mis à jour par le ticker 1 s.

- [ ] **Step 1: Sérialiser stateSince**

Dans `main.js`, `serializeSession`, après la ligne `lastEventTime: session.lastEventTime ?? null,` :

```js
    // Durée d'état : timestamp de l'état MACHINE, volontairement non retouché
    // par les overrides de présentation ci-dessus (delegating/running) — le
    // libellé peut basculer sans que le compteur reparte à zéro.
    stateSince: session.stateSince ?? null,
```

- [ ] **Step 2: Clé i18n du tooltip**

Dans `i18n.js`, près de `state_waiting_idle` de chaque langue :

```js
      state_since_abs: 'depuis {t}',
```

```js
      state_since_abs: 'since {t}',
```

- [ ] **Step 3: Helpers + badge grid + badge compact dans renderer.js**

Ajouter près de `getStateLabel` :

```js
// Durée d'état dans le badge (« Inactif · 12 min ») : le span est toujours
// présent, le ticker 1 s (updateDurations) le remplit en place — pas de
// re-render de carte. Vide sous 60 s (jamais de « 0 min »).
function stateDurationHTML(s) {
  const txt = typeof s.stateSince === 'number'
    ? window.stateDuration.formatStateDuration(s.stateSince) : null;
  return `<span class="state-duration" data-since="${s.stateSince ?? ''}">${txt ? ' · ' + txt : ''}</span>`;
}

// Tooltip : horodatage absolu du passage dans l'état (« depuis 14:32 »,
// date incluse au-delà de 24 h). Un timestamp absolu ne périme pas — posé
// au render, pas de ticker.
function stateSinceTitle(s) {
  if (typeof s.stateSince !== 'number') return '';
  const d = new Date(s.stateSince);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const abs = (Date.now() - s.stateSince > 86_400_000)
    ? `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${time}`
    : time;
  return ` title="${escAttr(t('state_since_abs', { t: abs }))}"`;
}
```

Dans `cardHTML`, le badge devient :

```js
      <div class="state-badge ${stateName}"${stateSinceTitle(s)}>
        ${isActiveState(stateName) ? '<span class="spinner"></span>' : '<span class="dot"></span>'}
        ${stateLabel}${stateDurationHTML(s)}
      </div>${bgChip}
```

Dans `compactItemHTML`, la ligne d'état devient :

```js
        <span class="compact-card-state"${stateSinceTitle(s)}>
          ${stateIndicator}<span class="compact-card-state-label">${stateLabel}</span>${stateDurationHTML(s)}
        </span>
```

- [ ] **Step 4: Ticker + CSS**

`updateDurations` (déjà appelée toutes les 1 s) :

```js
function updateDurations() {
  document.querySelectorAll('.duration-value').forEach(el => {
    const started = el.dataset.started;
    if (started) el.textContent = formatDuration(started);
  });
  // Durée d'état des badges — écrit seulement si la valeur change (pas de
  // churn DOM à chaque tick).
  document.querySelectorAll('.state-duration[data-since]').forEach(el => {
    const since = Number(el.dataset.since);
    if (!since) return;
    const txt = window.stateDuration.formatStateDuration(since);
    const next = txt ? ' · ' + txt : '';
    if (el.textContent !== next) el.textContent = next;
  });
}
```

Dans `ui/styles.css`, près des règles `.state-badge` :

```css
/* Durée d'état dans le badge — discrète, l'état reste l'info principale */
.state-duration { opacity: .7; }
```

- [ ] **Step 5: Vérification rapide**

Run: `npm test`
Expected: PASS (aucune régression — le renderer n'est pas couvert par les tests node, la vérif visuelle vient en Task 5)

- [ ] **Step 6: Commit**

```bash
git add main.js i18n.js ui/renderer.js ui/styles.css
git commit -m "feat: badge « Inactif · 12 min » sur les cartes grid/compact + tooltip horodaté"
```

---

### Task 4: Île — champ `minutes` de retour sur les rangées

**Files:**
- Modify: `island-model.js` (`buildIsland` ~114, `row` ~132)
- Modify: `ui/island/island.js` (`rowHtml` ~48)
- Test: `test/island-model.test.js`

**Interfaces:**
- Consumes: `stateSince` du payload sérialisé (Task 3), `window.stateDuration.formatMinutes` (Task 1, chargé dans island.html en Task 1).
- Produces: `row.minutes: number|null` dans le modèle de `buildIsland` ; `buildIsland(sessions, config, now?)` — `now` epoch ms injecté pour les tests, défaut `Date.now()`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `test/island-model.test.js`, la factory `sess` gagne le passage d'un `stateSince` : ajouter dans l'objet retourné :

```js
    stateSince: opts.stateSince !== undefined ? opts.stateSince : null,
```

Puis ajouter les tests (le `NOW` du fichier existe déjà) :

```js
console.log('\nrow minutes (durée d\'état):');
test('minutes = minutes entières depuis stateSince, now injecté', () => {
  const m = buildIsland([sess('waiting', { stateSince: NOW - 12 * 60000 })], {}, NOW);
  assertEq(m.rows[0].minutes, 12);
});
test('minutes null sous 60 s (jamais de « 0 min »)', () => {
  const m = buildIsland([sess('waiting', { stateSince: NOW - 59000 })], {}, NOW);
  assertEq(m.rows[0].minutes, null);
});
test('minutes null sans stateSince (config antérieure)', () => {
  const m = buildIsland([sess('waiting')], {}, NOW);
  assertEq(m.rows[0].minutes, null);
});
test('minutes aussi sur les rangées headless', () => {
  const m = buildIsland([sess('running', { bg: true, stateSince: NOW - 5 * 60000 })], {}, NOW);
  assertEq(m.backgroundRows[0].minutes, 5);
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `node test/island-model.test.js`
Expected: FAIL — `minutes` undefined sur les 2 tests non-null (les cas `null` peuvent passer par accident, attendu).

- [ ] **Step 3: Implémenter dans island-model.js**

Au-dessus de `buildIsland` :

```js
// Durée d'état des rangées du volet : minutes entières depuis stateSince,
// null sous la minute (pas de « 0 min »). Champ `minutes` réintroduit —
// retiré lors du compactage des rangées, il revient porté par stateSince.
function minutesSince(sinceMs, now) {
  if (typeof sinceMs !== 'number' || !isFinite(sinceMs)) return null;
  const m = Math.floor((now - sinceMs) / 60000);
  return m >= 1 ? m : null;
}
```

`buildIsland` gagne le `now` injecté (pureté/testabilité) :

```js
function buildIsland(sessions, config, now) {
  const nowMs = typeof now === 'number' ? now : Date.now();
```

et `row` porte les minutes :

```js
  const row = (s) => ({
    sessionId: s.sessionId,
    name: s.customName || s.sessionName || s.projectName,
    state: s.state.name,
    minutes: minutesSince(s.stateSince, nowMs),
    isBackground: !!s.isBackground,
```

(le reste de `row` inchangé ; les appels `interactive.map(row)` / `background.map(row)` restent tels quels).

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node test/island-model.test.js`
Expected: PASS (toute la suite)

- [ ] **Step 5: Rendu dans island.js**

Dans `rowHtml` (`ui/island/island.js`), la ligne `.r-state` devient — même taille 10px que le libellé, pas de nouveau CSS ; les rangées sont réassignées en bloc à chaque refresh (tick 30 s + refreshs événementiels), granularité minute suffisante, pas de ticker seconde :

```js
      <span class="r-state">${esc(window.i18n.t('state_' + row.state))}${row.minutes != null ? esc(' · ' + window.stateDuration.formatMinutes(row.minutes)) : ''}</span>
```

- [ ] **Step 6: Suite complète + commit**

Run: `npm test`
Expected: PASS

```bash
git add island-model.js ui/island/island.js test/island-model.test.js
git commit -m "feat: durée d'état « · 12 min » sur les rangées de l'île (champ minutes réintroduit)"
```

---

### Task 5: Vérification visuelle CDP

**Files:**
- Aucune création attendue — corrections éventuelles dans les fichiers des tasks 3-4.

**Interfaces:**
- Consumes: tout ce qui précède, app lancée en dev.

- [ ] **Step 1: Lancer l'app instrumentée**

Tuer toute instance Electron d'abord (single-instance lock, cf. mémoire `feedback_dev_relaunch`) :

```bash
pkill -f "[Ee]lectron.*aby-claude-watcher" ; sleep 1
cd /Users/invictorius/Project/aby-claude-watcher && npx electron . --dev --remote-debugging-port=9222 &
```

Il faut au moins une session Claude Code vivante pour avoir des cartes ; à défaut, forger une session headless (mémoire `reference_cdp_verification` : `sleep` + `session.json` sdk-cli).

- [ ] **Step 2: Vérifier les 3 surfaces au CDP**

Via CDP (`http://localhost:9222/json` puis WebSocket, pattern `node --experimental-websocket` de la mémoire `reference_cdp_verification`) :

1. **Grid** : screenshot À LA VRAIE largeur de fenêtre ; le badge affiche « Inactif · N min » (ou rien si < 60 s) ; mesurer `scrollWidth === clientWidth` sur `.state-badge` (pas de débordement).
2. **Compact** : idem sur `.compact-card-state` ; la durée ne pousse pas le nom hors carte.
3. **Île** : panneau déplié, `.r-state` montre « Inactif · N min » ; vérifier que la rangée ne wrappe pas.
4. **Tooltip** : lire l'attribut `title` du badge — format « depuis HH:MM ».
5. **Ticker** : attendre ~70 s sur une session fraîchement transitionnée, confirmer que le badge passe de vide à « · 1 min » sans re-render (le nœud `.state-duration` est le même, `document.querySelector` avant/après).

Expected: les 5 checks passent ; sinon corriger (CSS/format) et re-vérifier.

- [ ] **Step 3: Restart-survival (le point central du design)**

Avec une session en waiting depuis > 2 min : quitter l'app (`pkill` idem Step 1), relancer, vérifier que le badge affiche toujours ≥ 2 min (pas de compteur remis à zéro). Contrôler dans `~/Library/Logs/aby-claude-watcher/main.log` que l'état restauré est `waiting` (no-op `initial-scan`).

Expected: la durée survit au redémarrage.

- [ ] **Step 4: Commit final si corrections**

```bash
git add -A && git commit -m "fix: ajustements visuels durée d'état (vérif CDP)"
```

(uniquement s'il y a eu des corrections ; sinon rien à committer).
