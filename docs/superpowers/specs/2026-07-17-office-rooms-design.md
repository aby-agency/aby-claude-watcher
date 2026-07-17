# Vue « Office » v2 — pièces-cartes (pivot) — design

Date : 2026-07-17
Statut : validé (brainstorming avec Paul, sections 1-3 approuvées)
Remplace le rendu open-space de la spec [2026-07-16-office-view-design.md] (le socle — atlas, machine d'activité, moteur canvas — est conservé).

## Motivation

L'open-space unique livré en v1 rend un petit carré fortement dézoomé, illisible
dans une fenêtre haute et étroite (cas réel de Paul). Plutôt qu'un fit
fenêtre complexe, pivot : **une mini-pièce par session, présentée comme les
cartes de la vue grid**. Objectif premier : compréhensible en un coup d'œil.

## Décisions de cadrage (validées)

- **Remplace** l'open-space (pas de 5e vue). Le viewMode `office` garde son
  bouton ; seul le rendu pivote.
- **La pièce entière raconte l'état** : perso (anims existantes) + props
  (écran, machine à café, papiers) + **teinte d'éclairage** couleur d'état à
  ~12 % d'opacité sur toute la pièce (lisible en vision périphérique).
- **Nom du projet sous la vignette** (label texte style cartes actuelles,
  renommable au clic comme aujourd'hui) + cloche de notif ; le reste des
  détails (branche, modèle, durée) reste au tooltip de survol.

## Structure

- Grille de vignettes calquée sur la vue grid : wrap selon la largeur de
  fenêtre, section « Background » repliable (headless), drag pour réordonner,
  clic = focus terminal (headless : pas de click-focus).
- Vignette = `.office-card` : canvas de pièce **~10×8 tiles** + nom + cloche.
  Zoom = plus grand entier tel que la pièce tient dans la largeur de la
  carte, clampé à [1..4], pixelated (recalculé au resize, debouncé).
- **Un canvas par vignette, un seul timer 8 fps** qui redessine les canvases
  dont une frame a changé. Vue inactive = timer stoppé (inchangé).

## La pièce, état par état

Décor de base : bureau + écran + chaise + plante + porte + mini machine à
café dans un coin.

| État | Perso | Pièce |
|---|---|---|
| running | assis, tape | teinte bleue `#3b82f6`, écran bleu clignotant |
| thinking | assis immobile, bulle « … » | teinte violette `#a78bfa` |
| waiting | se lève, se fait un café dans sa pièce, le sirote | pénombre verte `#22c55e` douce, écran en veille |
| pending | debout, anim téléphone, « ! » | teinte ambre `#f59e0b` |
| error | affalé sur le bureau | teinte rouge `#ef4444`, écran rouge, papiers au sol |
| purgée | sort par la porte, puis la vignette se retire | — |
| nouvelle | entre par la porte, s'assoit | — |

- **Subagents** : 1-2 petits persos à une table d'appoint dans la pièce,
  « +N » au-delà.
- **Workflow actif** (dédup par runId, sessions interactives ET background) :
  coin réunion dans la pièce du projet — table + jusqu'à 4 persos le temps du
  run.
- **Headless** : vignettes en section Background, décor assombri, pas de
  teinte vive.
- Perso stable par projet (hash → index premade, inchangé).

## Architecture

- `ui/office-layout.js` : API par pièce `roomFor(session) → {cols, rows,
  statics, actors}`. Disparaissent : slots globaux, croissance de pièce,
  overflow, meeting global, point café partagé. Restent (transposés) :
  machine d'activité, `animFor`, `charIndexFor`, chemins en L dans la pièce,
  retarget propre (y compris changement d'état en route), leave→done,
  dédup workflows par runId, flip isBackground. Tests purs réécrits en
  transposant ces invariants.
- `ui/office.js` : rendu multi-canvas ; la vue office rend des cartes dans
  son container, gérées comme les cartes grid (fullRender / patch ciblé par
  session). Teinte = fillRect couleur 12 % ; papiers d'erreur = pixels
  programmatiques (pas de nouvel asset requis).
- Atlas/bake : inchangés (le mobilier nécessaire y est déjà).
- `renderer.js` : la branche office s'aligne sur le flux des autres vues
  (fullRender crée les vignettes ; updateSession patche la vignette).

## Dettes réglées par le pivot

- Empilement des waiters sur l'unique point café → disparaît (café par pièce).
- Slots réassignés sous filtre de recherche → disparaît (plus de slots).

## Hors périmètre

- Personnalisation des pièces, sons, caméra/pan/zoom interactif.
- Le label sous la vignette réutilise le rename inline existant — pas de
  nouveau système de nommage.

## Tests & vérification

- `test/office-layout.test.js` réécrit (mêmes conventions node pures).
- Vérification visuelle CDP + sessions forgées (flow existant), incluant le
  cas fenêtre étroite (~400 px) et le redimensionnement (re-wrap + rescale).
