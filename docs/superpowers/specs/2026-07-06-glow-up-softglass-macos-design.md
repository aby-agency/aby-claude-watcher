# Glow up — Soft Glass + intégration macOS 2026

**Date :** 2026-07-06
**Statut :** design validé par Paul (visuel + périmètre + faisabilité). Spec en revue.

## Problème / intention

L'UI actuelle (thème GitHub-dark, cartes plates, barre d'accent 3px, pastille d'état)
est fonctionnelle mais datée — « dashboard dev 2021 », sans profondeur ni signature, et
surtout **peu intégrée à l'univers macOS de 2026** (menu bar, notifs actionnables,
respect du système). Objectif : un glow-up qui (1) rhabille l'app dans le langage visuel
2026 sans sacrifier la densité/lisibilité, et (2) la fait se fondre dans macOS.

Recherche juillet 2026 qui cadre les choix :
- Apple **Liquid Glass** (WWDC 25 / Tahoe 26) = matière translucide devenue standard —
  mais **instable pour les apps Electron** sur Tahoe (adaptation de fond cassée,
  backlash → refonte annoncée macOS 27). Le plein verre natif est donc un pari, pas un socle.
- Tendance dashboard 2026 : profondeur **par la lumière** (glow + couches fines),
  pas par le blur lourd de 2021. Dark-first, contraste WCAG tenu.
- Le **menu bar** est le vrai hub (iStat Menus, MoniThor, TokenBar). Control Center +
  menu bar accueillent des contrôles tiers.

## Direction visuelle retenue — « Soft Glass + glow-budget »

Deux décisions de design, validées sur maquettes.

### 1. Soft Glass (matière)
On prend **la lumière du verre sans la translucidité** : cartes **opaques** (contraste
plein, aucun `backdrop-filter`, aucune dépendance à une fenêtre vibrancy), mais avec :
- un **sheen spéculaire** en haut de carte (dégradé blanc→transparent) ;
- une **bordure lumineuse 1px** et une ombre inset haute (`inset 0 1px 0 rgba(255,255,255,.13)`) ;
- un fond plus profond (`#090c12`) avec un léger halo ambiant violet/bleu en haut de fenêtre.

Rationale : le plein Liquid Glass dépend du fond derrière la fenêtre (bureau clair =
contraste effondré sur une app always-on-top) **et** du chemin Electron vibrancy instable
sur Tahoe. Soft Glass donne le look 2026 sans ces deux risques.

### 2. Glow-budget (états)
Le glow coloré n'est **pas décoratif, c'est un signal**. Règle :

| État | Traitement visuel |
|------|-------------------|
| `thinking`, `running` | **calme** — sheen + filet d'état 1px + pastille, pas de bloom |
| `pending`, `waiting`, `error` | **glow** — bloom coloré contenu + carte teintée + pastille rayonnante (rouge pour error) |

`error` rejoint le glow-budget : c'est une condition qui réclame ton attention (décision validée).

But : à N sessions, seules celles qui **réclament une action** rayonnent. Un plateau
plein de sessions qui tournent reste serein ; l'urgence saute aux yeux. Intensité pilotée
par un token global `--glow` (réglable, potentiellement atténuable selon le nombre de
sessions visibles).

## Cartographie dans le code existant

| Zone | Fichier / symbole actuel | Impact |
|------|--------------------------|--------|
| Tokens + styles cartes/toolbar/status | `ui/styles.css` (`:root`, `.card`, `.card::before`, `.state-badge`, `.card[data-state]`) | refonte tokens + états |
| Vues grid / compact / micro | `ui/styles.css`, `ui/renderer.js` | appliquer Soft Glass aux 3 densités |
| Popover menu bar | `ui/popover.html`, `ui/popover.js`, `preload-popover.js`, `popoverWindow` (main.js) | **restyle** (existe déjà) |
| Tray | `generateTrayIcon()`, `setupTray()`, `updateTrayMenu()` (main.js) | ajout glance coloré + compteur |
| Notifications | `Notification` (main.js), `notifyWorkflowDone()`, toast overlay (`ui/index.html #notificationOverlay`, renderer) | notifs natives + actions |
| Transparence | `setOpacity()` (main.js), `windowOpacity` (config) | brancher toggle vibrancy expérimental |
| Persistance réglages | `config.js` | nouveaux flags (vibrancy, focus-respect) |

## Lot 1 — L'app dans le système (safe, zéro pari technique)

### 1.1 Refonte des tokens Soft Glass (`ui/styles.css`)
Nouveaux tokens dans `:root` : `--card-bg` (dégradé), `--card-border`, `--card-sheen`,
`--card-inset`, `--glow` (intensité globale), `--bloom-<state>`. Les couleurs d'état
existantes (`--state-*`) sont conservées. Chaque carte lit `--acc` (déjà présent via
`.card[data-state]`). Cible : cartes, toolbar, status bar, popover — cohérence d'un coup.

### 1.2 Glow-budget (états)
- `thinking`/`running` : `.card::after` = filet d'état 1px en haut (dégradé `--acc`),
  badge discret, **pas** de bloom.
- `pending`/`waiting`/`error` : bloom contenu (`radial-gradient` flouté, `opacity`
  pilotée par `--glow`), fond de carte légèrement teinté `--acc`, badge rayonnant + dot
  avec `box-shadow` coloré (l'animation `breathe`/`pending-wiggle` existante est conservée).
- Doit tenir sur les 3 vues. En micro/compact la pastille suffit (bloom réservé au grid).

### 1.3 Menu bar glance (`main.js` — tray)
- `generateTrayIcon()` devient **paramétrable** : génère (via `nativeImage`) une icône
  reflétant l'état agrégé. Pastille **colorée** ⇒ image **non-template** (les template
  images macOS sont noir/transparent only) : on dessine nous-mêmes le petit rond coloré.
- `tray.setTitle(count)` : nombre de sessions en attente (`pending` + `waiting`), masqué
  si 0. Couleur = état le plus urgent (`pending` > `waiting`).
- Recalcul à chaque transition d'état (hook dans la boucle qui appelle déjà
  `updateTrayMenu()`). Dégradation : si le rendu d'icône colorée échoue, fallback sur
  l'icône template statique actuelle.

### 1.4 Popover restylé (`ui/popover.*`)
Applique Soft Glass + glow-budget en version compacte (liste de rows, cf. maquette).
Popover **opaque**, aligné strictement sur la fenêtre principale (décision validée) :
cohérence visuelle et lisibilité garantie sur tout fond. Réutilise le canal
`popover-update` existant.

### 1.5 Notifications natives + actions (`main.js`)
- Pour les états d'action (`pending`/`waiting`), émettre une `Notification` native macOS
  avec `actions` (`[{type:'button', text:'Resume'}, …]`) + éventuellement `hasReply`.
  Boutons : **Resume** (relance la session — réutilise `focus.js`) et **Focus terminal**.
- Le toast in-app (`#notificationOverlay`) reste pour le feedback visuel immédiat dans la
  fenêtre ; la notif native est le canal « hors app ». Les garde-fous existants (cooldown
  30s, défèrement pending 5s, pas de cloche sur fin de workflow) sont **conservés tels quels**.
- `notifyWorkflowDone()` peut adopter le même format natif (sans actions).

### 1.6 Usage 5h/7D en menu bar (`main.js`) — inclus au Lot 1 (décision validée)
Réglage : afficher le pourcentage d'usage le plus proche du reset dans `tray.setTitle`
quand aucune session n'est en attente. Même mécanisme que 1.3. Priorité d'affichage :
compteur attente > usage.

## Lot 2 — Bon citoyen macOS + verre (opt-in)

### 2.1 Respect de Focus / DND (`main.js` + nouveau module)
- Pas d'API Electron directe. Nouveau module `focus-state.js` : lit
  `~/Library/DoNotDisturb/DB/Assertions.json` (+ `ModeConfigurations.json`) pour savoir
  si un Focus/DND est actif (approche `getfocus`/`infocus`). Poll léger (ex. 30s) ou
  lecture au moment d'émettre.
- Quand Focus actif : **couper son + bell needs-you** (le toast visuel peut rester). Corrige
  un vrai trou — les notifs Electron ne respectent pas le DND pour l'audio.
- Réglage on/off (défaut on). Dégradation : fichier illisible / format changé ⇒ considérer
  « pas de Focus » (comportement actuel), jamais planter.

### 2.2 Vibrancy expérimental (`main.js` + config)
- Toggle **expérimental** (défaut off) : recrée/paramètre `mainWindow` avec
  `vibrancy: 'hud'` (ou `'under-window'`) + `visualEffectState: 'active'` + fond
  transparent, faisant basculer Soft Glass → vrai Liquid Glass.
- Relié au curseur transparence existant (`windowOpacity`/`set-window-transparency-enabled`).
- Étiqueté « expérimental » dans les réglages avec avertissement Tahoe. À stabiliser
  quand macOS se stabilise (27).

## Découpage en unités

- **CSS tokens & états** (`styles.css`) — autonome, testable visuellement seul.
- **Glance tray** (`main.js` : `generateTrayIcon` paramétrable + calcul d'agrégat) —
  interface : `(sessions[]) → {color, count}`. Isolable dans un helper pur `trayGlance(sessions)`.
- **Popover restyle** (`popover.*`) — consomme le même flux, style seulement.
- **Notifs natives** (`main.js`) — interface : `emitNativeNotification(session, {actions})`.
- **Focus-state** (`focus-state.js`) — module pur : `isFocusActive() → bool`, sans effet de bord.
- **Vibrancy toggle** (`main.js`) — derrière un flag config, isolé de Soft Glass.

`trayGlance()` et `focus-state.js` sont des fonctions pures ⇒ testables unitairement sans Electron.

## Gestion d'erreurs & dégradations

- Icône tray colorée qui échoue ⇒ fallback icône template statique.
- `Assertions.json` absent/illisible ⇒ « pas de Focus » (comportement actuel).
- Vibrancy instable ⇒ c'est un opt-in expérimental, off par défaut ; jamais sur le chemin nominal.
- **`build.files` :** tout nouveau module (`focus-state.js`) doit être ajouté à
  `package.json > build.files` (sinon crash DMG, invisible en dev — piège connu).

## Tests & vérification

- **Visuel :** vérif live via CDP (`--remote-debugging-port` + spies) sur les 3 vues, avec
  **sessions forgées** (sleep + `session.json`) couvrant chaque état — méthode déjà en place.
  Cas clé : plateau à ~7 sessions, vérifier que seules `pending`/`waiting` rayonnent.
- **Glance :** forcer des agrégats (0 / 1 pending / 2 mixte) et vérifier
  `tray.setTitle` + couleur d'icône.
- **Notifs natives :** déclencher un `pending`, vérifier boutons Resume / Focus terminal.
- **Focus/DND :** simuler un `Assertions.json` actif ⇒ son/bell coupés, toast conservé.
- Non-régression : cooldown 30s, défèrement 5s, background sessions muettes, workflows
  (badge violet, pas de bell) — inchangés.

## Hors périmètre (plus tard)

- **Control Center / Widget bureau / Live Activity native** : nécessitent un compagnon
  natif (WidgetKit/ControlKit) hors Electron. Noté, non planifié ici.
- Refonte du son (thèmes existants conservés).
- Mode clair (l'app reste dark-committed — choix assumé).

## Décisions validées (récap)

1. `error` **rejoint le glow-budget** (glow rouge).
2. **Usage en menu bar** inclus au **Lot 1**.
3. Popover **opaque**, aligné sur Soft Glass (pas de translucidité).
