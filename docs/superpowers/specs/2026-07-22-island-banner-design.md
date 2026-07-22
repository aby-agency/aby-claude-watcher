# Bannière d'île + suppression des notifs Apple — spec de design

Date : 2026-07-22 · Validée par Paul · Suite de `2026-07-22-dynamic-island-design.md`

## Contexte

L'île (livrée) porte les LEDs et le panneau au survol. Paul veut : (1) une
notification transitoire qui descend de l'île sur les événements needs-you,
et (2) la **suppression complète des notifications système macOS** de l'app,
qui le dérangent. Décisions produit validées une à une :

| Sujet | Décision |
|---|---|
| Déclencheurs bannière | Needs-you uniquement : waiting (« a fini »), pending, error — PAS thinking/running |
| Vs notifs Apple | La bannière REMPLACE la notif macOS ; `emitNativeNotification()` supprimée |
| Fallback sans île | AUCUN (clamshell / toggle off / pas d'encoche → badge Dock + jauge tray + sons seulement) |
| LEDs | Inchangées (cap 4 + « +N » conservé — décision re-validée) |

Révision assumée d'une décision v1 : « l'île ne bouge jamais toute seule »
devient « …sauf la bannière needs-you » (le panneau, lui, ne s'auto-déplie
toujours pas).

## Comportement

### Suppression des notifs Apple (`main.js`)

- `emitNativeNotification()` et ses points d'appel disparaissent (2 connus :
  le chemin pending différé ~ligne 84 et le chemin notif principal ~ligne 352 —
  vérifier par grep qu'il n'y en a pas d'autres).
- L'import `Notification` d'electron est retiré s'il n'a plus d'usage.
- Le clic-notification (focus session) est repris par le clic-bannière.
- **Rien d'autre ne bouge** : sons à thème (`play-sound`, défèrement 5 s du
  pending, re-check à l'échéance), badge Dock, jauge tray, logs `[notif]`.

### Émission de la bannière (`main.js` → île)

Aux mêmes points de décision où partait la notif Apple — donc en héritant
telles quelles des gardes existantes :

- prefs par session (`modal`/`sound` — la bannière suit le gating de l'ex-notif),
- cooldown 30 s par session,
- suppression si Focus macOS actif,
- headless muettes sauf cloche activée,
- pas de needs-you si bloquée sur un subagent foreground.

Si toutes les gardes passent : `island.sendBanner({ sessionId, name, state })`
(name = customName || projectName ; state = nom d'état watcher). `sendBanner`
se garde toute seule (fenêtre absente, détruite, pas chargée ou cachée →
no-op) : main.js appelle sans condition, l'absence d'île = silence.

### Rendu (renderer île)

- Bande qui glisse de sous la pilule (translateY, même esprit que le panneau),
  contenu « {name} — {état i18n} » avec la LED de couleur de l'état.
- Visible 4 s puis remonte. Une seule bannière à la fois : un nouvel événement
  remplace l'actuelle (pas de file).
- Le survol de l'île (panneau) masque immédiatement la bannière.
- Clic sur la bannière = focus terminal (pipeline existant `focus-terminal`) +
  masquage. La zone bannière s'ajoute au hit-test des mousemove forwardés
  (click-through intact autour).
- Données interpolées échappées (`esc`/`escAttr`, pattern en place).

## Architecture

- `island.js` : + `sendBanner(payload)` (gardes `_loaded`/`isDestroyed`/
  `isVisible` intégrées — pas d'API de test côté main.js).
- `preload-island.js` : + `onBanner(cb)`.
- `ui/island/` : élément bannière + CSS animation + timer 4 s + intégration
  hit-test/clic.
- `island-model.js` : + `bannerPayload(session)` (pure : name/state depuis une
  session sérialisée) — testée.
- `main.js` : remplacement des appels `emitNativeNotification(...)` par le
  chemin bannière ; suppression de la fonction.

## Hors scope

- Toute file/pile de bannières, bannière pour workflow-done, historique.
- Changement des sons, du badge Dock, des toasts in-app éventuels.
- Fallback notif Apple (décision : supprimé sans filet).

## Tests & vérification

- Unit : `bannerPayload` dans `test/island-model.test.js`.
- Grep : plus AUCUNE occurrence de `new Notification` / `emitNativeNotification`
  dans main.js.
- CDP : forcer un needs-you (vraie session ou état forgé) → bannière descend,
  reste ~4 s, remonte ; clic = focus ; survol la masque ; aucun centre de
  notifications macOS sollicité.
- `npm test` vert ; `build.files` inchangé (aucun nouveau fichier racine).
