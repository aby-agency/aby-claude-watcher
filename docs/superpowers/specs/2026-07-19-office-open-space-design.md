# Vue « Office » v4 — open-space zoné (pivot) — design

Date : 2026-07-19
Statut : validé (échange avec Paul, mockup fourni par Paul : `.superpowers/sdd/mockup-v4.png`, hors git)
Remplace les 3 salles v3. Socle conservé : atlas/bake, machine d'activité,
bulles émotes + priorités (dont « waiting à cloche active reste au poste »),
étiquettes anti-collision (bulles prioritaires), slots stables,
dimensionnement jamais sous les occupants réels, hit-test/clic par perso,
tooltip, timer 8 fps unique.

## Concept

**UNE seule salle** (un canvas), zonée en quadrants, slots créés à la demande.
Les persos se déplacent VISIBLEMENT d'une zone à l'autre (plus de téléport
porte-à-porte : même pièce, vraie marche par le couloir central).

| Zone | Position | Occupants | Décor (réf mockup Paul) |
|---|---|---|---|
| Lounge (inactifs) | haut-gauche | sessions waiting (sans cloche active) | canapé d'angle, table basse + machine à café, zzz |
| Agents | bas-gauche | sessions running/thinking/pending/error — un poste par session | grille de postes « console écran bleu + fauteuil ORANGE » (dos caméra), rangées de 3 qui poussent à la demande |
| Deep research | haut-droite | agents de workflows (wf_*) | poste(s) latéral(aux) (setup tourné 90°, chaise orange), s'empilent à la demande |
| Headless | bas-droite | sessions isBackground | postes comme les agents mais **siège NOIR** (les noirs actuels passent orange partout ailleurs), pas de click-focus |

- **Subagents : à côté de leur parent** — un perso par subagent actif, sur un
  ordi **portable** posé à droite du poste de la session parente (grille
  localement irrégulière, assumé). Étiquette = projet parent.
- Waiting + cloche active → reste au poste avec la bulle « ! » (règle
  2026-07-19 conservée) ; part au lounge à l'expiration/traitement.
- Décor mural : TV/tableau, plante(s), à recomposer depuis le mockup.
- La salle grandit en hauteur selon la zone la plus peuplée ; largeur fixe
  (celle du mockup, ~15-16 tuiles) ; couloir central toujours libre.
- Interactions inchangées : clic perso = focus (headless exclus), tooltip,
  étiquettes pixel, footer unique « Office · N actifs » (ou compteurs par
  zone — au goût de l'implémentation, validé au visuel).

## Assets

Le mockup de Paul est composé de sprites des packs locaux (Modern Office /
Interiors) — identification par comparaison visuelle (contact-sheets),
demander à Paul uniquement si introuvable. Attendus : unité poste
console+fauteuil orange, variante fauteuil noir (headless), canapé d'angle,
table basse, setup latéral 90°, TV murale, portable (laptop, déjà baké).

## Hors périmètre v4.0

- Couloirs/portes visibles, sons, personnalisation. La recherche
  (searchQuery) ne filtre toujours pas la vue office.
