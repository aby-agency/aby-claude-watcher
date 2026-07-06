# Jauge de consommation Claude dans la barre de menu — Design

**Date** : 2026-07-06
**Statut** : validé (design), plan d'implémentation à suivre
**Origine** : idée d'Etienne — voir le taux de conso Claude « directement dans la barre du haut, comme le wifi et l'heure ».

## Objectif

Transformer l'affichage de conso déjà présent dans le tray (` 27%`) en une **jauge en anneau** : un anneau de progression qui se remplit et change de couleur selon le quota **5 h**, doublé du chiffre exact + temps restant en texte.

Cible : `[anneau coloré] 5H 27% · 35m` dans la barre de menu.

## Ce qui existe déjà (ne pas réinventer)

L'ossature est en place dans le repo :

- **`usage.js` → `UsageMonitor`** : interroge l'endpoint OAuth `/api/oauth/usage` (token du Keychain macOS), poll toutes les 5 min, normalise `{ fiveHour:{utilization, resetsAt}, sevenDay:{...}, ... }`. Démarré par `setupUsageMonitor()` dans `main.js`. **C'est la source de données** — pas besoin d'autre canal.
- **`lastUsage`** : dernier snapshot gardé en mémoire dans `main.js`.
- **`tray-glance.js` → `trayGlance(sessions, usage)`** : module pur → `{ count, color, usageLabel }`. `usageLabel` = `"27%"` (max de `pct5h`/`pct7d`).
- **`generateTrayIcon(color)`** (`main.js`) : génère l'icône du tray **en SVG → `nativeImage.createFromDataURL`, dans le main** (aucun canvas ni IPC requis). Aujourd'hui : template monochrome si pas de couleur, sinon un **point plein** `<circle r=5>`.
- **`updateTray()`** (`main.js`, ~l.898-916) : priorité actuelle = *attention count* > *usageLabel* > vide. Titre = ` N` ou ` 27%` ou `''`.

**Corroboration** : le spike statusline du 2026-07-06 a mesuré `five_hour` = 27 % ; `usage.js` (endpoint OAuth, même donnée serveur unifiée) donne la même valeur. Source validée.

## Canal ABANDONNÉ

Le design initial passait par la **statusline** de Claude Code (payload `rate_limits`). **Abandonné** car redondant avec `usage.js` et plus coûteux : il aurait fallu remplacer la statusline native de l'utilisateur, installer un script avec consentement, gérer un fichier d'état. Rien de tout cela n'est nécessaire. → Pas de hack statusline, pas de fichier d'état, pas d'install réversible.

## Architecture (greffe sur l'existant)

```
UsageMonitor (existe) ──update──▶ lastUsage (existe) ──▶ updateTray() (existe)
  utilization + resetsAt                                    │
                                                            ├─▶ generateTrayIcon(color, pct)   ← ÉTENDU : anneau
                                                            └─▶ setTitle("5H 27% · 35m")        ← format 5h + reset
```

### Composants

1. **`ring-gauge.js`** — *nouveau module pur, sans dépendance Electron → testable* (même patron que `tray-glance.js` / `focus-state.js`).
   - `gaugeColor(pct)` → `'#28c451' | '#ff9f0a' | '#ff453a' | null`. Seuils : < 50 vert, 50–80 ambre, > 80 rouge, `null`/absent → `null`.
   - `formatCountdown(resetsAt, nowMs)` → `"35m"` sous 1 h, `"1h12"` au-delà, `"reset"` si `resetsAt` passé ou absent.
   - `ringSvg(pct, color)` → chaîne SVG d'un anneau (cercle `stroke-dasharray`) rempli à `pct %`, couleur `color`, sur une track grise translucide, dans un viewBox 16×16 (taille tray). `pct<=0`/`null` → anneau vide.
   - `trayUsageLabel(usage, nowMs)` → `"5H 27% · 35m"` depuis `usage.fiveHour` (utilization + resetsAt). `null` si pas de donnée 5 h.

2. **`generateTrayIcon(color, pct)`** (`main.js`, étendu)
   - Signature élargie : 2ᵉ paramètre `pct` optionnel.
   - Si `pct` est un nombre fini ≥ 0 → dessine l'**anneau** via `ringSvg(pct, gaugeColor(pct))` (image **non-template**, couleur réelle).
   - Sinon → comportement actuel inchangé (template monochrome, ou point plein si `color` fourni pour une alerte d'attention).

3. **`updateTray()`** (`main.js`, modifié)
   - Récupère `pct5h = lastUsage?.fiveHour?.utilization`.
   - **Titre** : quand on montre la conso, `setTitle(' ' + trayUsageLabel(usage, Date.now()))` → `5H 27% · 35m`.
   - **Icône** : quand on montre la conso, `setImage(generateTrayIcon(null, pct5h))` → anneau. Quand une session réclame l'attention, comportement d'alerte (voir arbitrage).

### Décisions UX (défauts validés, ajustables)

- **Anneau + texte** ensemble.
- **Seuils couleur** : vert < 50, ambre 50–80, rouge > 80, gris = rechargé. Couleurs système macOS (`#28c451` / `#ff9f0a` / `#ff453a`).
- **Fenêtre 5 h** en principal ; le 7 j reste hors du titre par défaut.
- **Format** : `5H 27% · 35m` ; reset en minutes sous 1 h, en heures au-delà.

### Arbitrage à trancher : priorité attention vs conso

Aujourd'hui, une session qui réclame l'attention (`pending`/`error`/`waiting`) prend le tray (` N` + point coloré) et masque la conso. Trois options :
- **(A)** Garder l'attention prioritaire — l'anneau conso s'affiche seulement quand rien ne réclame (changement minimal). **← défaut proposé.**
- **(B)** Toujours afficher l'anneau conso ; superposer un petit marqueur d'attention.
- **(C)** Combiner dans le titre : `⏺2 · 5H 27%`.

Défaut retenu : **(A)** — l'urgence prime, la conso reprend la main dès que c'est calme. À confirmer à l'implémentation.

## Cas limites

- **`resetsAt` passé** → `formatCountdown` renvoie `"reset"`, anneau selon le dernier `utilization` connu (l'endpoint corrigera au prochain poll).
- **Pas de donnée usage** (`lastUsage` null, endpoint en échec) → `trayUsageLabel` = `null`, icône template statique. Déjà le comportement actuel (dégradation silencieuse).
- **`utilization` hors bornes** → `ringSvg` clampe `pct` dans [0, 100].

## Tests (patron `node test/*.test.js`)

- `test/ring-gauge.test.js` : `gaugeColor` aux seuils (49/50/80/81/0/null) ; `formatCountdown` (< 1 h, > 1 h, passé, absent) ; `trayUsageLabel` (5 h présent/absent, format) ; `ringSvg` (contient un arc, clamp des bornes, anneau vide si null).
- Régression : `test/tray-glance.test.js` continue de passer (module inchangé).
- Vérif manuelle : anneau rendu correct à 0 / 27 / 50 / 80 / 81 / 100 %, couleurs aux bons seuils, lisible sur barre claire et sombre.

## Hors périmètre (v1)

- Graphe historique de consommation.
- Notifications de seuil (80 %/90 %) — infra de notif déjà présente, à brancher en v2 si besoin.
- Jauge répliquée dans la fenêtre principale (focus v1 = tray).
- Affichage du 7 j dans le titre par défaut.

## Points à confirmer pendant l'implémentation

1. **Rendu de l'arc SVG à 16 px** dans la barre (lisibilité de l'anneau à petite taille ; épaisseur du trait).
2. **Lisibilité de l'anneau couleur** sur les deux thèmes de barre (clair/sombre) en non-template.
3. **Arbitrage attention vs conso** (option A par défaut).
4. **Piège `build.files`** : le nouveau module `ring-gauge.js` doit être ajouté à `package.json` → `build.files` et au script `test`, sinon absent du DMG (invisible en dev) / non testé.
