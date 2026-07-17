# Vue « Office » v3 — les salles (pivot) — design

Date : 2026-07-17
Statut : validé (brainstorming avec Paul, 2 sections approuvées)
Remplace le rendu « une pièce par session » des specs office-rooms (v2.x).
Le socle est conservé : atlas/bake, machine d'activité, moteur multi-canvas,
bulles émotes, routage couloir, composition demi-tile, assets choisis par Paul.

## Concept

Trois **salles par fonction**, toujours affichées, dans lesquelles les persos
(stables par projet, hash → premade) **migrent selon l'état** de leur session.
Un coup d'œil à une salle répond à une question : qui bosse ? qui attend ?
qu'est-ce qui tourne en tâche de fond ?

| Salle | Occupants | Décor |
|---|---|---|
| 💼 Travail | sessions running, thinking, pending, error — un poste par session | rangées de cubicles (2 postes/rangée, la salle grandit), bulles émotes + LED + mini-étiquette pixel (nom projet tronqué ~8 car.) sous chaque perso |
| ☕ Pause | sessions waiting | machine à café + comptoir, fontaine, distributeur, canapés (ajout bake), plantes ; persos avec zzz |
| 🔬 Recherche | un perso par subagent actif et par agent de workflow (étiquette = projet parent) ; coin sombre pour les sessions headless | grande table, whiteboard, densité qui monte quand ça fan-out |

- Salle vide = taille minimale, décor visible (info en soi). Ordre fixe :
  Travail, Pause, Recherche. Footer de salle : nom + compteur d'occupants.
- **Migration animée** : le perso quitte sa place, sort par la porte de sa
  salle (marche, routage couloir), disparaît, entre par la porte de la salle
  cible et s'installe à une place **stable par salle** (slots par salle).
- **Interactions** : clic sur un PERSO = focus de sa session (hit-test par
  acteur) ; tooltip au survol (nom, état, branche, modèle, durée) ; les
  affordances par carte-session (cloche, rename, drag) disparaissent de la
  vue office (elles restent dans grid/compact). Les salles ne sont pas
  cliquables hors persos.
- Les acquis v2.x conservés tels quels : bulles émotes (priorité
  enveloppe > état > outil-marteau), composition demi-tile assis (-5px),
  fauteuil #106 overlay conditionnel, LED moniteur secondaire, teintes
  supprimées (voile sombre du coin headless de la salle recherche = seul
  assombrissement), écran éteint en waiting (n'a plus d'objet : le perso
  n'est plus à son poste).

## Architecture

- `ui/office-layout.js` v3 : `roomsFor(snapshot)` → 3 salles
  `{key: 'work'|'break'|'research', cols, rows, statics, slots}` ; acteurs
  globaux `{roomKey, slot, migration}` ; slots stables par salle (plus petit
  slot libre, jamais réassigné tant que l'occupant reste) ; migration =
  leave (porte salle A) → teleport → enter (porte salle B). Machine
  d'activité inchangée en dessous.
- `ui/office.js` : 3 canvases fixes (un par salle), même timer 8 fps, même
  drawRoom généralisé (statics/acteurs/bulles/étiquettes) + hit-test par
  acteur (conversion CSS→pixels natifs conservée).
- `renderer.js` : la vue office ne passe plus par le flux cartes-par-session
  (viewItemHTML/fullRender) — `Office.renderRooms()` possède son container.
  Les hooks updateSession/removeSessionFromDOM → `Office.notifyUpdate()`.
- Bake : ajout `sofa` (Modern Office singles 200-206, choisir au preview).

## Hors périmètre v3.0

- Couloirs visibles entre salles ; personnalisation des salles ; sons.
- La recherche (searchQuery) ne filtre pas la vue office (salles globales).
