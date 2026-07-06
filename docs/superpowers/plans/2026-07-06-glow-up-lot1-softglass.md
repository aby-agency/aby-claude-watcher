# Glow up Lot 1 — Soft Glass + intégration menu bar (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rhabiller l'UI en « Soft Glass + glow-budget » et faire vivre l'app dans le menu bar macOS (glance coloré + compteur, notifs natives actionnables, usage en barre) — sans aucun pari technique.

**Architecture:** Refonte des tokens CSS de `ui/styles.css` (matière opaque à reflets, glow réservé aux états d'action) appliquée aux 3 vues et au popover. Côté `main.js`, un helper pur `trayGlance()` calcule l'agrégat d'état, qui pilote une icône tray colorée + `tray.setTitle`, et les états d'action émettent une `Notification` native avec boutons d'action.

**Tech Stack:** Electron 41, vanilla HTML/CSS/JS (pas de framework), `nativeImage`/`Tray`/`Notification` (Electron), tests `node test/*.test.js` (mini-harness maison, pas de framework).

## Global Constraints

- **Aucun `git push` / tag / release** sans demande explicite de Paul (règle projet). Les commits locaux par tâche sont OK.
- Commits **signés Paul uniquement** — pas de trailer `Co-Authored-By: Claude`.
- **`build.files` :** tout nouveau module `.js` à la racine DOIT être ajouté à `package.json > build.files`, sinon crash du DMG (invisible en dev). Log runtime : `~/Library/Logs/aby-claude-watcher/main.log`.
- **L'app reste dark-committed** (pas de mode clair).
- Garde-fous notifications **inchangés** : cooldown 30s/session, défèrement pending 5s (relecture fraîche au tir), pas de cloche sur fin de workflow, background sessions muettes sauf cloche par-session.
- Nouveau module pur ⇒ l'exporter proprement + test `node test/<nom>.test.js` ajouté à la chaîne `npm test`.
- Vérif visuelle : `npm run dev` (sort si une autre instance tourne — single-instance lock), observation directe. Le `main.log` = état BRUT ; l'UI applique un override présentation (session bloquée sur agent foreground → affichée running) — log et UI peuvent diverger sans bug.
- Glow-budget (règle de design, s'applique à toutes les tâches visuelles) : `thinking`/`running` = **calmes** (sheen + filet + pastille, pas de bloom) ; `pending`/`waiting`/`error` = **glow** (bloom coloré contenu + carte teintée + pastille rayonnante).

---

### Task 1: Fondation Soft Glass — tokens + matière de carte

**Files:**
- Modify: `ui/styles.css` (`:root` ~5-34 ; `.card` 555-563 ; `.card::before` 565-575 ; `.card:hover` 577-579)

**Interfaces:**
- Produces : nouveaux tokens `--card-bg`, `--card-border`, `--card-sheen`, `--card-inset`, `--glow` lus par les tâches 2 et 7 ; ground Soft Glass (`--bg-primary`/`--bg-secondary`/`--bg-tertiary`).

- [ ] **Step 1: Deepen the ground + add Soft Glass tokens in `:root`**

Dans `ui/styles.css`, remplacer les 3 premières valeurs de fond et ajouter les nouveaux tokens juste après `--radius: 8px;` :

```css
  --bg-primary: #090c12;
  --bg-secondary: #0f141c;
  --bg-tertiary: #171d27;
  /* Soft Glass — matière opaque à reflets (aucun backdrop-filter) */
  --card-bg: linear-gradient(165deg, rgba(255,255,255,.075), rgba(255,255,255,.022));
  --card-border: rgba(255,255,255,.10);
  --card-sheen: linear-gradient(158deg, rgba(255,255,255,.10), transparent 44%);
  --card-inset: inset 0 1px 0 rgba(255,255,255,.13);
  --glow: 0.5; /* intensité globale du bloom d'état (0 = éteint) */
```

- [ ] **Step 2: Replace the `.card` material**

Remplacer le bloc `.card { … }` (555-563) par :

```css
.card {
  background: var(--card-bg), var(--bg-secondary);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  padding: 16px;
  transition: all var(--transition);
  position: relative;
  overflow: hidden;
  box-shadow: var(--card-inset), 0 8px 22px -16px rgba(0,0,0,.7);
}
```

- [ ] **Step 3: Turn the 3px accent bar into the specular sheen**

Remplacer `.card::before { … }` (565-575) par le sheen spéculaire (le glow d'état viendra en tâche 2 via `::after`) :

```css
.card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--card-sheen);
  pointer-events: none;
}
```

- [ ] **Step 4: Refine hover**

Remplacer `.card:hover { … }` (577-579) par :

```css
.card:hover {
  border-color: rgba(255,255,255,.18);
  box-shadow: var(--card-inset), 0 10px 26px -14px rgba(0,0,0,.8);
}
```

- [ ] **Step 5: Visual verification**

Run: `npm run dev`
Attendu : la grille de cartes a un fond plus profond, chaque carte montre un léger reflet en haut et une bordure lumineuse fine ; **plus de barre d'accent 3px à gauche**. Aucune régression de layout (titre, badge, actions alignés comme avant).

- [ ] **Step 6: Commit**

```bash
git add ui/styles.css
git commit -m "feat(ui): fondation Soft Glass — tokens + matière de carte opaque à reflets"
```

---

### Task 2: Glow-budget — le glow réservé aux états d'action

**Files:**
- Modify: `ui/styles.css` (`.card[data-state]` 1607-1611 ; `.state-badge` 713-757)

**Interfaces:**
- Consumes : tokens `--glow`, `--card-accent` (déjà posé par `.card[data-state]`).
- Produces : classes d'état visuelles cohérentes réutilisées par le popover (tâche 7).

- [ ] **Step 1: Keep the per-card accent mapping, add a calm state hairline**

Le bloc `.card[data-state] { --card-accent: … }` (1607-1611) reste inchangé. Ajouter juste après ce bloc le **filet d'état calme** (tous états) + le **bloom d'attention** (pending/waiting/error uniquement) :

```css
/* Filet d'état 1px en haut — présent sur tous les états (calme) */
.card::after {
  content: '';
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--card-accent, var(--state-neutral)), transparent);
  opacity: .55;
  pointer-events: none;
}

/* Bloom coloré — SEULEMENT les états qui réclament une action */
.card[data-state="pending"],
.card[data-state="waiting"],
.card[data-state="error"] {
  border-color: color-mix(in srgb, var(--card-accent) 34%, var(--card-border));
}
.card[data-state="pending"] .card-bloom,
.card[data-state="waiting"] .card-bloom,
.card[data-state="error"] .card-bloom {
  content: '';
  position: absolute;
  left: -6%; bottom: -34%;
  width: 50%; height: 115%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--card-accent) 40%, transparent), transparent);
  filter: blur(9px);
  opacity: var(--glow);
  pointer-events: none;
  z-index: 0;
}
```

Note : `.card-bloom` est un `<span>` dédié (ajouté step 2) plutôt qu'un 3ᵉ pseudo-élément (`.card` n'a que `::before`/`::after`, déjà pris par sheen + filet).

- [ ] **Step 2: Inject the bloom element in the card template**

Dans `ui/renderer.js`, repérer la fonction qui construit le HTML d'une carte grid (chercher `class="card"` ou la création du `.card`). Ajouter, en **premier enfant** de la carte, `<span class="card-bloom"></span>`. Le contenu existant (header, badge…) reste inchangé et doit passer au-dessus : ajouter dans `styles.css` `.card-header, .card-details { position: relative; z-index: 1; }` si nécessaire pour garder le texte au-dessus du bloom.

- [ ] **Step 3: Make attention badges glow, keep calm badges quiet**

Après les règles `.state-badge.<state>` (753-757), ajouter :

```css
/* Badges calmes (thinking/running) : inchangés, discrets */
/* Badges d'action : halo + dot rayonnant */
.state-badge.pending,
.state-badge.waiting,
.state-badge.error {
  border: 1px solid color-mix(in srgb, var(--badge-color) 40%, transparent);
  box-shadow: 0 0 16px -4px var(--badge-color);
}
.state-badge.pending .dot,
.state-badge.waiting .dot,
.state-badge.error .dot {
  box-shadow: 0 0 7px 0 currentColor;
}
```

- [ ] **Step 4: Visual verification at density**

Run: `npm run dev` avec plusieurs sessions Claude ouvertes (ou attendre un vrai plateau).
Attendu : les cartes `thinking`/`running` sont **calmes** (reflet + filet + pastille) ; seules `pending`/`waiting`/`error` montrent un **bloom coloré** + carte teintée + badge halo. À 5+ sessions, aucun « sapin de Noël » : au plus les cartes en attente rayonnent. Vérifier aussi que le texte reste au-dessus du bloom (lisible).

- [ ] **Step 5: Commit**

```bash
git add ui/styles.css ui/renderer.js
git commit -m "feat(ui): glow-budget — bloom réservé à pending/waiting/error, calme ailleurs"
```

---

### Task 3: `trayGlance()` — helper pur d'agrégat + test

**Files:**
- Create: `tray-glance.js` (racine)
- Create: `test/tray-glance.test.js`
- Modify: `package.json` (script `test`, `build.files`)

**Interfaces:**
- Produces : `trayGlance(sessions, usage) → { count, color, usageLabel }`
  - `sessions` : tableau d'objets ayant `{ state: 'thinking'|'running'|'waiting'|'pending'|'error'|…, isBackground?: bool }`.
  - `usage` : `{ pct5h: number|null, pct7d: number|null }` (peut être `{}`).
  - Retour : `count` = nb de sessions interactives en `pending`+`waiting`+`error` ; `color` = hex de l'état le plus urgent (`pending` > `error` > `waiting`, sinon `null`) ; `usageLabel` = `"62%"` (le pct le plus haut) ou `null`.
  - Consommé par la tâche 4.

- [ ] **Step 1: Write the failing test**

Créer `test/tray-glance.test.js` :

```js
// Tests for tray-glance.js. Run: node test/tray-glance.test.js
const { trayGlance } = require('../tray-glance.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const C = { pending: '#f59e0b', error: '#ef4444', waiting: '#22c55e' };

console.log('\ntrayGlance:');
test('no attention → count 0, no color', () => {
  const g = trayGlance([{ state: 'running' }, { state: 'thinking' }], {});
  assertEq(g.count, 0); assertEq(g.color, null);
});
test('counts pending+waiting+error', () => {
  const g = trayGlance([{ state: 'pending' }, { state: 'waiting' }, { state: 'error' }, { state: 'running' }], {});
  assertEq(g.count, 3);
});
test('pending wins over error and waiting', () => {
  assertEq(trayGlance([{ state: 'waiting' }, { state: 'error' }, { state: 'pending' }], {}).color, C.pending);
});
test('error wins over waiting', () => {
  assertEq(trayGlance([{ state: 'waiting' }, { state: 'error' }], {}).color, C.error);
});
test('background sessions excluded from count', () => {
  assertEq(trayGlance([{ state: 'pending', isBackground: true }], {}).count, 0);
});
test('usageLabel = highest pct when no attention', () => {
  assertEq(trayGlance([{ state: 'running' }], { pct5h: 62, pct7d: 41 }).usageLabel, '62%');
});
test('usageLabel null when a pct is null on both', () => {
  assertEq(trayGlance([], {}).usageLabel, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/tray-glance.test.js`
Expected: FAIL (`Cannot find module '../tray-glance.js'`)

- [ ] **Step 3: Write minimal implementation**

Créer `tray-glance.js` :

```js
// Pure aggregate for the macOS menu bar glance. No Electron deps → unit-testable.
const STATE_COLOR = {
  pending: '#f59e0b',
  error: '#ef4444',
  waiting: '#22c55e',
};
// Attention priority (most urgent first).
const PRIORITY = ['pending', 'error', 'waiting'];

function trayGlance(sessions, usage) {
  const attention = (sessions || []).filter(
    (s) => !s.isBackground && PRIORITY.includes(s.state)
  );
  const count = attention.length;
  let color = null;
  for (const state of PRIORITY) {
    if (attention.some((s) => s.state === state)) { color = STATE_COLOR[state]; break; }
  }
  let usageLabel = null;
  if (usage && (typeof usage.pct5h === 'number' || typeof usage.pct7d === 'number')) {
    const top = Math.max(
      typeof usage.pct5h === 'number' ? usage.pct5h : -Infinity,
      typeof usage.pct7d === 'number' ? usage.pct7d : -Infinity
    );
    if (Number.isFinite(top)) usageLabel = `${Math.round(top)}%`;
  }
  return { count, color, usageLabel };
}

module.exports = { trayGlance, STATE_COLOR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/tray-glance.test.js`
Expected: `7 passed, 0 failed`

- [ ] **Step 5: Wire into the test chain + build.files**

Dans `package.json`, ajouter `&& node test/tray-glance.test.js` à la fin du script `test`, et ajouter `"tray-glance.js"` au tableau `build.files` (à côté des autres `.js` racine).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: tous les fichiers de test passent, dont `tray-glance`.

- [ ] **Step 7: Commit**

```bash
git add tray-glance.js test/tray-glance.test.js package.json
git commit -m "feat(tray): trayGlance() — helper pur d'agrégat d'état pour le menu bar"
```

---

### Task 4: Menu bar glance — icône colorée + compteur

**Files:**
- Modify: `main.js` (`generateTrayIcon()` 782-787 ; `setupTray()` 789-801 ; la boucle qui appelle `updateTrayMenu()` — refs 471, 522)

**Interfaces:**
- Consumes : `trayGlance(sessions, usage)` (tâche 3).
- Produces : `refreshTrayGlance()` appelée à chaque transition d'état.

- [ ] **Step 1: Colored icon generator**

Dans `main.js`, importer le helper en haut : `const { trayGlance } = require('./tray-glance');`. Remplacer `generateTrayIcon()` (782-787) par une version qui accepte une couleur : quand `color` est fourni, dessine un petit disque plein coloré (image **non-template**, `nativeImage.createFromBuffer` d'un PNG 16×16 ou `createFromDataURL` d'un SVG data-URL) ; sinon retourne l'icône template statique actuelle (`nativeImage.createFromPath(iconPath)`, template). Exemple data-URL coloré :

```js
function generateTrayIcon(color) {
  if (!color) {
    const iconPath = path.join(__dirname, 'assets', 'trayTemplate.png'); // chemin actuel
    const img = nativeImage.createFromPath(iconPath);
    img.setTemplateImage(true);
    return img;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5" fill="${color}"/></svg>`;
  const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  img.setTemplateImage(false); // couleur préservée
  return img;
}
```

(Vérifier le vrai chemin d'icône lu aujourd'hui par `generateTrayIcon` et le réutiliser tel quel pour le fallback.)

- [ ] **Step 2: refreshTrayGlance()**

Ajouter dans `main.js` (près de `updateTrayMenu`) :

```js
function refreshTrayGlance() {
  if (!tray) return;
  const sessions = watcher.getSessions(); // adapter au nom réel de l'accès aux sessions
  const usage = getUsageSnapshot();       // adapter : source des pct 5h/7d déjà affichés en status bar
  const g = trayGlance(sessions, usage);
  try {
    tray.setImage(generateTrayIcon(g.color));
  } catch (e) {
    log.warn('tray icon render failed, fallback', e);
    tray.setImage(generateTrayIcon(null));
  }
  // Priorité d'affichage : compteur d'attente > usage
  if (g.count > 0) tray.setTitle(` ${g.count}`);
  else if (g.usageLabel) tray.setTitle(` ${g.usageLabel}`);
  else tray.setTitle('');
}
```

Adapter `watcher.getSessions()` / `getUsageSnapshot()` aux accès réels (repérer comment le renderer reçoit déjà sessions + usage : chercher l'IPC `sessions-update` / `usage-update` dans `main.js`).

- [ ] **Step 3: Call it on every state transition**

Aux endroits qui appellent déjà `updateTrayMenu()` sur changement d'état (471, 522) et après un scan, ajouter `refreshTrayGlance();`. L'appeler aussi une fois dans `setupTray()` après `updateTrayMenu()` (801).

- [ ] **Step 4: Visual verification**

Run: `npm run dev`, ouvrir/mettre en attente des sessions.
Attendu : sans attente → icône template neutre, titre = usage `62%` (si dispo). Avec 2 sessions en attente → pastille **ambre** + titre ` 2`. Passer une session `error` → couleur bascule selon la priorité (pending > error > waiting). Fallback : si le rendu couleur échoue, l'icône statique revient sans crash (vérifier `main.log`).

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat(tray): glance menu bar — icône colorée + compteur d'attente/usage"
```

---

### Task 5: Notifications natives + boutons d'action

**Files:**
- Modify: `main.js` (émission de notification — chercher `session-waiting` / création `Notification`, refs 280-290, `notifyWorkflowDone` 83)

**Interfaces:**
- Consumes : `focus.js` (résolution du terminal / resume — repérer la fonction publique existante, ex. `focusTerminal(session)` / `resume(session)`).
- Produces : `emitNativeNotification(session, { title, body, actions })`.

- [ ] **Step 1: Native notification helper with actions**

Ajouter dans `main.js` :

```js
function emitNativeNotification(session, { title, body }) {
  const n = new Notification({
    title,
    body,
    silent: false, // le son système ; le son custom reste géré par le renderer
    actions: [{ type: 'button', text: 'Resume' }, { type: 'button', text: 'Focus terminal' }],
  });
  n.on('action', (_e, index) => {
    if (index === 0) focus.resume(session);        // adapter au nom réel
    else focus.focusTerminal(session);             // adapter au nom réel
  });
  n.on('click', () => focus.focusTerminal(session));
  n.show();
}
```

- [ ] **Step 2: Route action states through it**

Au point où la notification « needs-you » est émise pour `pending`/`waiting` (là où vivent le cooldown 30s et le défèrement pending 5s — **ne pas y toucher**), appeler `emitNativeNotification(session, { title: `${session.name} attend ta validation`, body: 'Permission requise' })` en plus (ou à la place) du toast in-app. Le toast visuel (`#notificationOverlay`) reste. Conserver le comportement background-muet et la relecture fraîche au tir du timer.

- [ ] **Step 3: Verification (manual)**

Run: `npm run dev`, déclencher une permission dans une session Claude.
Attendu : après le défèrement 5s (si toujours en attente), une **notif macOS native** apparaît avec **Resume** / **Focus terminal**. Cliquer Resume relance ; cliquer Focus terminal active le terminal d'origine. Le cooldown 30s empêche le spam. Vérifier qu'aucune notif n'apparaît pour les sessions background (sauf cloche par-session).

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat(notif): notifications natives macOS avec actions Resume / Focus terminal"
```

---

### Task 6: Popover — restyle Soft Glass opaque

**Files:**
- Read first: `ui/popover.html`, `ui/popover.js`
- Modify: `ui/popover.html` (styles inline ou `<link>`) pour appliquer Soft Glass + glow-budget compact

**Interfaces:**
- Consumes : tokens Soft Glass (tâche 1) + classes d'état (tâche 2). Popover **opaque** (décision validée) — pas de `backdrop-filter`.

- [ ] **Step 1: Read the popover markup**

Lire `ui/popover.html` et `ui/popover.js` pour identifier la structure des rows (dot + nom + état) et d'où viennent les styles.

- [ ] **Step 2: Apply Soft Glass tokens**

Aligner le fond du popover sur `--bg-primary` (#090c12), les rows sur `.card`-like (fond `--card-bg`, bordure `--card-border`, sheen léger). Reprendre le glow-budget : rows `pending`/`waiting`/`error` teintées + dot rayonnant ; `thinking`/`running` calmes. Réutiliser les couleurs `--state-*` déjà présentes. **Opaque**, aucune translucidité.

- [ ] **Step 3: Verification**

Run: `npm run dev`, ouvrir le popover depuis le menu bar (clic sur le tray).
Attendu : popover cohérent avec la fenêtre principale (fond profond, rows à reflet), seules les sessions en attente rayonnent, lisible sur tout fond. Le canal `popover-update` continue de rafraîchir la liste.

- [ ] **Step 4: Commit**

```bash
git add ui/popover.html ui/popover.js
git commit -m "feat(ui): popover menu bar restylé Soft Glass opaque + glow-budget"
```

---

### Task 7: Passe finale sur compact / micro + non-régression

**Files:**
- Modify: `ui/styles.css` (vues `.compact-view`/`.compact-card`, `.micro-view`/`.micro-item` — cf. 93-233 et sections compact)

**Interfaces:**
- Consumes : tout ce qui précède.

- [ ] **Step 1: Compact/micro glow-budget**

En compact et micro, **pas de bloom** (place réservée à la grille) : seule la pastille d'état porte le signal. Vérifier que les pastilles `pending`/`waiting`/`error` gardent leur halo (`box-shadow` currentColor) et que `thinking`/`running` restent sobres. Aligner les fonds compact/micro sur le nouveau ground Soft Glass.

- [ ] **Step 2: Full visual sweep across the 3 views**

Run: `npm run dev`, basculer grid → compact → micro (segmented control de la toolbar).
Attendu : cohérence Soft Glass sur les 3 densités ; glow-budget respecté ; aucune régression (drag-reorder, rename inline, badges bell/workflow violet, background section). Vérifier le badge workflow violet agrégé et la section background intacts.

- [ ] **Step 3: Run the automated suite**

Run: `npm test`
Expected: tout passe (dont `tray-glance`).

- [ ] **Step 4: Commit**

```bash
git add ui/styles.css
git commit -m "feat(ui): Soft Glass sur compact/micro + passe de non-régression Lot 1"
```

---

## Self-Review

**Spec coverage (Lot 1) :**
- 1.1 Refonte tokens → Task 1 ✅
- 1.2 Glow-budget (pending/waiting/error glow, calme ailleurs) → Task 2 (+ compact/micro Task 7) ✅
- 1.3 Menu bar glance (icône colorée + compteur, fallback) → Task 3 (pur) + Task 4 (Electron) ✅
- 1.4 Popover restylé opaque → Task 6 ✅
- 1.5 Notifs natives + actions (garde-fous conservés) → Task 5 ✅
- 1.6 Usage 5h/7D en barre → Task 3 (`usageLabel`) + Task 4 (priorité attente > usage) ✅
- Dégradations (icône fallback, build.files) → Task 4 step 4, Global Constraints ✅
- Tests CDP/visuels + suite node → étapes de vérif de chaque tâche + Task 7 ✅

**Lot 2 (Focus/DND + vibrancy expérimental) : hors de ce plan** — fera l'objet d'un plan dédié `2026-XX-XX-glow-up-lot2-focus-vibrancy.md`.

**Points à confirmer par l'implémenteur au fil de l'eau (noms réels à repérer, pas des placeholders de design) :** chemin de l'icône tray actuelle (Task 4 step 1) ; accès sessions + snapshot usage côté main (Task 4 step 2) ; fonctions publiques de `focus.js` pour resume/focus (Task 5 step 1) ; structure des rows popover (Task 6 step 1). Chacun est localisé par un `grep` indiqué dans l'étape.
