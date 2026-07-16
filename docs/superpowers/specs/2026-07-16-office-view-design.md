# Vue « Office » — design

Date : 2026-07-16
Statut : validé (brainstorming avec Paul, sections 1-4 approuvées)

## Objectif

Un 4e mode de vue ludique : un open-space pixel-art (assets LimeZu) où chaque
session Claude Code est un bureau avec un personnage animé. On voit d'un coup
d'œil qui bosse, qui attend, qui a besoin de toi — et on garde toutes les
interactions du système existant (clic = focus terminal, tooltip, purge).

## Décisions de cadrage (validées)

- **Emplacement** : viewMode `office`, 4e mode à côté de `grid`/`compact`/`micro`,
  bouton dans la toolbar, persisté en config.
- **Scène** : open-space unique. Un bureau par session interactive ; subagents =
  petits persos à des mini-bureaux accolés au bureau parent.
- **Périmètre v1** : sessions interactives + subagents, sessions headless
  (rangée « back-office » sombre au fond), workflows multi-agents (salle de
  réunion), décor vivant (machine à café animée, plantes, distributeur).
- **Identification** : aucun texte dans la scène. Tooltip DOM au survol
  (slug, branche, modèle, état, durée). Repérage par position stable +
  apparence stable du perso.
- **Rendu** : canvas 2D maison + atlas de sprites pré-cuit. Pas de dépendance,
  pas de framework — dans l'esprit vanilla du projet.

## Contrainte licence (structurante)

Le repo est **public** ; la licence LimeZu interdit de redistribuer les assets,
même édités. Donc :

- Les assets bruts vivent hors repo (`~/Project/Games/Assets/`, chemin
  configurable via `BAKE_ASSETS_SRC` ou argument du script).
- `scripts/bake-assets.js` extrait uniquement les frames/tiles utiles et génère
  `ui/office-assets/atlas.png` + `atlas.json` — **gitignorés**.
- `ui/office-assets/` est ajouté à `package.json` `build.files` (piège
  whitelist connu) : embarqué dans le DMG (usage « projet » autorisé), jamais
  dans le repo source.
- Crédit LimeZu ajouté au README (apprécié par la licence).

### Contenu de l'atlas

- Tiles : sol, murs, porte, bureaux (desk + chaise + écran), machine à café
  (animée), plantes, distributeur, table de réunion, éléments back-office.
- Personnages : ~10 premade LimeZu avec anims `idle`, `walk` (4 directions),
  `sit`, `sit-type` (frames sit alternées), `phone`, `hurt`.
- Manifest JSON : pour chaque sprite, frames `{x, y, w, h}` + durées.

## Scène & mapping visuel

- Tiles 16×16 upscalées ×3 (`image-rendering: pixelated`), pièce dimensionnée
  selon le nombre de sessions, rangées de bureaux.
- **Identité stable** : hash(nom de projet) → index de perso premade. Même
  projet = même tête, toujours.
- **Places stables** : une session garde son bureau toute sa vie (repérage
  spatial). Nouvelle session → perso entre par la porte ; purge → perso sort,
  bureau libéré.

| État watcher | Perso | Écran du PC |
|---|---|---|
| thinking | assis immobile, bulle « … » pixel | allumé, violet `#a78bfa` |
| running | assis, anim frappe clavier | clignote, bleu `#3b82f6` |
| waiting | se lève, va à la machine à café, idle là-bas | veille |
| pending | debout près du bureau, anim téléphone + « ! » ambre | allumé, ambre `#f59e0b` |
| error | anim hurt puis affalé sur le bureau | rouge `#ef4444` |
| subagent actif | petit perso à un mini-bureau accolé | — |
| completed/purgé | perso sort par la porte, bureau disparaît | éteint |

- **Headless/background** : rangée au fond, ambiance plus sombre, pas de
  click-focus (règle existante conservée).
- **Workflows `wf_*`** : salle de réunion sur un côté ; pendant un run, un
  perso par agent actif autour de la table (plafond ~6). Fin de run → salle
  se vide.
- **Décor vivant** : machine à café animée en continu, plantes, distributeur.

## Architecture

- `ui/office.js` — moteur de rendu + orchestration de la vue (chargement
  atlas, boucle, hit-testing, tooltip, branchement sur le flux sessions).
- `ui/office-layout.js` — **logique pure testable** : assignation/stabilité
  des bureaux, croissance de la pièce, diff sessions→entités, machine d'anim
  (état watcher → anim cible + transitions).
- `scripts/bake-assets.js` — extraction/packing de l'atlas depuis les packs
  LimeZu locaux.
- `index.html` — canvas + conteneur tooltip ; `renderer.js` — enregistrement
  du 4e viewMode (activation/désactivation de la boucle au switch).

Aucun changement dans `watcher.js` : la vue consomme le même flux de données
que le renderer actuel (sessions, états, subagents, workflows).

## Moteur de rendu

- Scene graph plat : entités `{type, x, y, anim, frame, sessionId}`, tri par
  `y` pour le z-order.
- Tick anim **8 fps** (`setInterval` 125 ms) ; **redraw à la demande**
  uniquement (frame avancée, état changé, souris bougée). Vue inactive =
  boucle stoppée, zéro coût.
- Déplacements (café, sortie, entrée) : interpolation case par case avec anim
  walk, chemin en L (pas d'A*, allées sans obstacles). Changement d'état en
  cours de route → demi-tour propre, jamais de téléportation.

## Interactions

- Hit-testing : chaque entité cliquable garde son rect écran ; `mousemove` →
  recherche en z-order inverse ; survol → tooltip DOM + curseur pointer.
- Clic sur bureau **ou** perso (où qu'il soit, même au café) → même handler
  focus/resume que la vue grid.
- Back-office : pas de click-focus (headless), tooltip seulement.

## Erreurs & fallbacks

- Atlas absent/corrompu → bouton office masqué + hint « assets non générés »,
  log `[office]` dans main.log, try/catch au premier switch. L'app reste
  100 % fonctionnelle sans les assets.
- \> ~12 sessions → la pièce s'agrandit d'une rangée ; au-delà de **16 bureaux**
  (plafond dur), excédent en back-office avec compteur « +N » pixel-art.

## Tests

- `office-layout.js` testé pur, sans Electron (comme `ring-gauge.js`) :
  assignation, stabilité des places, croissance, diff, machine d'anim.
- Smoke test du bake script : atlas généré ↔ manifest cohérent.
- Vérification visuelle via CDP + sessions forgées (flow existant).

## Hors périmètre v1

- Personnalisation des persos par l'utilisateur.
- Sons/effets liés à la scène (le système de notifs existant reste inchangé).
- Jauge de conso dans la scène (reste dans le tray).
