// scripts/office-sprites.js — QUELS sprites extraire des packs LimeZu, et d'où.
// Données pures, pas d'I/O. Coordonnées vérifiées sur les fichiers réels
// (voir docs/superpowers/plans/2026-07-16-office-view.md, § Référence assets).

// Feuilles de personnages : frame 16×32, cellule (col,row) → x=col*16, y=row*32.
const CHAR_ROWS = {
  idle:  { row: 1, perDir: 6, dirNames: ['right', 'up', 'left', 'down'] },
  walk:  { row: 2, perDir: 6, dirNames: ['right', 'up', 'left', 'down'] },
  sit:   { row: 4, perDir: 6, dirNames: ['right', 'left'] }, // 2 directions seulement
  phone: { row: 6, perDir: 6, dirNames: ['right'] },          // 6 premières frames (profil)
  hurt:  { row: 19, perDir: 8, dirNames: [''], loop: false }, // sans direction
};
// Ordre de référence des directions LimeZu (à confirmer via --preview).
const DIRS = ['right', 'up', 'left', 'down'];

function charFrameRect(row, i) {
  return { x: i * 16, y: row * 32, w: 16, h: 32 };
}

// Mobilier : singles Modern Office (canvas 32×48, rogné à la bbox au bake).
const SINGLES_DIR = 'Modern_Office_Revamped_v1.2/4_Modern_Office_singles/16x16';
const FURNITURE = {
  // v26 (swaps Paul 2026-07-17) : bureau principal en blanc, 2 tuiles.
  desk:         `${SINGLES_DIR}/Modern_Office_Singles_263.png`,
  deskSetup:    `${SINGLES_DIR}/Modern_Office_Singles_227.png`,
  chairBack:    `${SINGLES_DIR}/Modern_Office_Singles_106.png`,
  chairFront:   `${SINGLES_DIR}/Modern_Office_Singles_196.png`,
  // Fauteuil de bureau VU DE DOS (dossier plein face caméra) — dessiné en
  // passe `z:'over'` (cf. office.js drawRoom) PAR-DESSUS le perso assis dos
  // au spectateur, pour que le dossier s'intercale visuellement entre lui et
  // la caméra. chairFront/chairBack restent bakés (plus utilisés en room
  // v26, réactivables) mais ne sont plus posés dans roomFor.
  chairOver:    `${SINGLES_DIR}/Modern_Office_Singles_106.png`, // VRAIE vue de dos (dossier plein, pas d'assise visible) — les 101/102 montrent l'assise = siège tourné vers la caméra (retour Paul, 2 itérations)
  plant:        `${SINGLES_DIR}/Modern_Office_Singles_98.png`,
  waterCooler:  `${SINGLES_DIR}/Modern_Office_Singles_173.png`,
  vending:      `${SINGLES_DIR}/Modern_Office_Singles_175.png`,
  meetingTable: `${SINGLES_DIR}/Modern_Office_Singles_191.png`,
  // Table subagent en blanc, façade 1 tuile.
  sideDesk:     `${SINGLES_DIR}/Modern_Office_Singles_75.png`,
  poster:       `${SINGLES_DIR}/Modern_Office_Singles_96.png`,
  laptop:       `${SINGLES_DIR}/Modern_Office_Singles_136.png`, // laptop ouvert, écran visible (top-down)
  // v2.4 — mobilier de densité cubicle (choisi au preview parmi 141-146 / 170-172 / 113-115).
  deskLamp:     `${SINGLES_DIR}/Modern_Office_Singles_141.png`, // lampe articulée argentée
  whiteboard:   `${SINGLES_DIR}/Modern_Office_Singles_171.png`, // tableau blanc + petit graphe (moins chargé que 172)
  wallFrame:    `${SINGLES_DIR}/Modern_Office_Singles_113.png`, // diplôme encadré — accroché au MUR (retour Paul : pas posé sur le bureau)
  // v3 (Task 2, salle Pause) : canapé pour les persos en salle pause. Choisi
  // parmi les singles 200-206 (regardés zoomés, --preview) : 200/205 sont
  // deux 2-places droits (accoudoirs symétriques des deux côtés, bandeau
  // d'assise pleine largeur face caméra sud — l'orientation voulue pour des
  // persos assis face caméra) ; 201/202/203/204 sont des fragments de canapé
  // d'angle (chaise longue en L, un seul accoudoir, coupé à mi-corps) —
  // écartés, ils ne lisent pas comme un canapé autonome posés seuls sur une
  // tuile. 206 est un fauteuil 1 place (trop étroit pour deux persos assis).
  // Retenu : 205 — accoudoirs nets des deux côtés, dossier plus haut/carré
  // que 200 (silhouette plus lisible en miniature 16×16 rogné).
  sofa:         `${SINGLES_DIR}/Modern_Office_Singles_205.png`,

  // ─── v4 (Task 1, open-space zoné) — assets identifiés par comparaison
  // PIXEL avec .superpowers/sdd/mockup-v4.png (contact-sheets étiquetés +
  // zoom magick, cf. rapport task-v4-1-report.md pour le détail méthode).
  // Étalonnage d'échelle : le mockup rend 1 tuile native 16×16 à ~125px
  // (repérage par comptage de cases du sol à damier + espacement des
  // postes), donc les crops mockup sont ~7.8× la taille des singles — les
  // comparaisons ci-dessous sont faites à cette échelle, pas au ratio
  // ~2× supposé dans le plan.

  // chairOrange : même silhouette EXACTE que chairOver/106 (bbox 16×21,
  // même décalage) — famille orange parallèle. 111 a un badge damier
  // blanc/gris cousu au dossier (écarté, absent des chaises du mockup) ;
  // 112 est le dossier plein uni, identique à 106 en orange → retenu.
  chairOrange:  `${SINGLES_DIR}/Modern_Office_Singles_112.png`,
  // chairBlack : nom v4 pour l'usage "poste headless" — MÊME fichier que
  // chairOver/106 (déjà "vue de dos" noire/grise). Alias volontaire, pas
  // un nouvel asset : cf. plan Task 1 ("garde chairOver en alias si plus
  // simple, documente"). Les deux clés pointent le même PNG.
  chairBlack:   `${SINGLES_DIR}/Modern_Office_Singles_106.png`,

  // stationConsole : l'unité écran-bleu+clavier des postes (mockup, bas-
  // gauche). Comparaison pixel exacte du motif d'écran (carré rouge en
  // haut-gauche, jaune dessous, 2 carrés blancs à droite + clavier gris) :
  // c'est LE MÊME single que deskSetup/227 déjà baké — alias v4 pour un nom
  // de frame explicite côté layout, pas un nouvel asset. Les montants
  // orange qui encadrent l'écran dans le mockup (meuble/cloison derrière le
  // poste) n'ont PAS été retrouvés comme single séparé malgré recherche sur
  // l'intégralité des 339 singles (cf. rapport, § introuvables) — non
  // bloquant, l'écran+clavier suffit à identifier le poste.
  stationConsole: `${SINGLES_DIR}/Modern_Office_Singles_227.png`,

  // sofaCornerA-D : canapé d'angle du lounge (mockup, haut-gauche). Les 4
  // fragments 201-204 avaient été écartés en v3 (salle Pause, cf. note
  // ci-dessus) faute de lire comme un canapé autonome seul sur une tuile —
  // mais le mockup v4 compose PRÉCISÉMENT un angle en L avec ces 4
  // fragments empilés/assemblés (match pixel direct, cf. rapport) :
  //  - sofaCornerB (203) : le coin en L complet (bras haut 2×2 damier +
  //    virage + 1 tuile basse + pieds visibles) — pièce d'ancrage.
  //  - sofaCornerA (201) : segment droit 2 places (bras du haut, sans le
  //    virage), à poser à gauche de B pour rallonger le bras horizontal.
  //  - sofaCornerC (202) / sofaCornerD (204) : segments verticaux (bras du
  //    bas, C avec le raccord haut en zigzag, D plus court/sans raccord) —
  //    à empiler sous B pour rallonger le bras vertical à la hauteur du
  //    mockup (~3 tuiles).
  sofaCornerA:  `${SINGLES_DIR}/Modern_Office_Singles_201.png`,
  sofaCornerB:  `${SINGLES_DIR}/Modern_Office_Singles_203.png`,
  sofaCornerC:  `${SINGLES_DIR}/Modern_Office_Singles_202.png`,
  sofaCornerD:  `${SINGLES_DIR}/Modern_Office_Singles_204.png`,

  // coffeeTable : table basse + machine à café + tasses + bouteilles d'eau
  // (mockup, haut-centre-gauche). PAS une composition — 320/321/322 sont un
  // objet déjà assemblé dans le pack (table bois + machine noire écran bleu
  // + mug + bouteilles), match pixel quasi parfait avec le crop mockup.
  // 320/321/322 sont des quasi-doublons (variations infimes d'AA) ; 322
  // retenu (liseré rouge le plus saturé, le plus proche du mockup).
  coffeeTable:  `${SINGLES_DIR}/Modern_Office_Singles_322.png`,

  // sideDesk90 / sideSetup90 : poste latéral haut-droite (deep research),
  // bureau + écran perçus de profil (le perso y travaille "de côté").
  // sideSetup90 = écran incliné/vu de profil, famille 129-134 confirmée par
  // le plan ; 132 a le meilleur rendu (carré rouge net, silhouette entière).
  // sideDesk90 = bureau bois clair même famille de forme que sideDesk/75
  // (bureau blanc existant) mais teinte bois (single 60) — la tour
  // empilée du mockup (écrans + caisson à tiroirs + bureau) est une
  // composition PROPRE À PAUL (plusieurs pièces posées en colonne pour
  // simuler la rotation) : on ne rebake que les 2 pièces utiles (écran +
  // bureau), pas le caisson à tiroirs intermédiaire (détail non requis).
  sideDesk90:   `${SINGLES_DIR}/Modern_Office_Singles_60.png`,
  sideSetup90:  `${SINGLES_DIR}/Modern_Office_Singles_132.png`,

  // tv : écran mural haut-droite. Match pixel exact (cadre gris avec pattes
  // de fixation en haut, écran vide lavande, 3 pastilles de couleur
  // vert/bleu/rouge + petits boutons sur la lisière basse) — trouvé par
  // recherche automatisée (scan couleur des 339 singles) puis confirmé au
  // zoom, PAS dans la plage 170-172 supposée pour whiteboard (172 est le
  // graphe déjà baké) mais 170 lui-même, jusqu'ici non catalogué.
  tv:           `${SINGLES_DIR}/Modern_Office_Singles_170.png`,

  // climatiseur/meuble blanc (mockup, haut-gauche, au-dessus du canapé) :
  // INTROUVABLE — recherche exhaustive sur les 339 singles Modern Office
  // (contact-sheets zoomés 1-339 intégralement) + le tileset Room_Builder
  // Office (sol/murs uniquement, pas de mobilier) sans match. Pas baké,
  // cf. rapport task-v4-1-report.md § introuvables.
};

// Tiles 16×16 découpées dans le Room Builder.
const ROOM_BUILDER = 'Modern_Office_Revamped_v1.2/1_Room_Builder_Office/Room_Builder_Office_16x16.png';
const TILES = {
  floor:     { src: ROOM_BUILDER, x: 160, y: 112 },
  floorDark: { src: ROOM_BUILDER, x: 160, y: 176 },
  floorWood: { src: ROOM_BUILDER, x: 208, y: 112 },
  wall:      { src: ROOM_BUILDER, x: 128, y: 0 },
};

// Machine à café : 96×32 = 6 frames 16×32.
const COFFEE = {
  src: 'moderninteriors-win/3_Animated_objects/16x16/spritesheets/animated_coffee.png',
  frames: 6, w: 16, h: 32,
};

const PREMADE_DIR = 'moderninteriors-win/2_Characters/Character_Generator/0_Premade_Characters/16x16';
function premadePath(n) { // n = 0…9 → Premade_Character_01…10
  return `${PREMADE_DIR}/Premade_Character_${String(n + 1).padStart(2, '0')}.png`;
}

// ─── Bulles émotes (v2.4) ───
// Sheet 160×160, grille 16×16 (10×10 cellules). Cartographié à l'œil via
// contact-sheets --preview (voir docs/superpowers/plans/2026-07-17-office-cubicle-emotes.md
// + rapport task-1) :
//  - Colonnes 0-6 / rangées 0-3 : anim d'« apparition » de la bulle (dot → bulle vide
//    → bulle + contenu, 2 dernières colonnes = les 2 frames de contenu à alterner,
//    d'où la note peinte dans le sheet lui-même « sample animation, just swap the
//    last 2 [frames] », visible cols 7-9/rangées 0-2). On n'utilise QUE la bulle vide
//    (x=96/112, y=64, cf. EMOTE_BUBBLE_EMPTY) comme fond de compositing.
//  - Rangées 4-9 : médaillons ronds bordés (icône figée, 2 frames par médaillon =
//    l'animation à alterner), 5 médaillons par rangée. C'est cette famille qu'on
//    utilise pour les émotes natives (style visuel cohérent, pas de queue de bulle).
const EMOTE_SHEET = 'moderninteriors-win/4_User_Interface_Elements/UI_thinking_emotes_animation_16x16.png';
const UI_ICONS_SHEET = 'modernuserinterface-win/16x16/Modern_UI_Style_1.png';

// Bulle vide (médaillon rond sans contenu), 2 frames quasi identiques (léger
// antialiasing différent sur le contour = wobble naturel) — support de
// compositing pour TOOL_EMOTES (mail/think/work sont natifs depuis v26, plus
// de compositing pour eux).
const EMOTE_BUBBLE_EMPTY = { src: EMOTE_SHEET, frames: [{ x: 96, y: 64 }, { x: 112, y: 64 }] };

// Émotes natives : extraction directe de 2 frames (médaillon rangées 4-9), pas de
// compositing. Rouge = urgence (angry/error), doré = neutre (alert/pending/mail).
// v26 (swaps Paul 2026-07-17) :
//  - think : L9C2+L9C3 (points bleus natifs du sheet) remplace les points
//    synthétisés au bake (stampThinkDots, retiré — plus utilisé).
//  - work  : L4C4+L4C5 (marteau) — nouvelle émote "running", remplace le
//    mapping par-outil dans emoteFor (débranché, pas retiré des bakes).
//  - mail  : L4C0+L4C1, mêmes coordonnées que `alert` ("!" doré) — Paul
//    veut le même picto pour notif et pending ; nom d'anim `emote.mail`
//    conservé (rien à changer côté layout/priorité bell > état > outil).
const EMOTES = {
  alert: { src: EMOTE_SHEET, frames: [{ x: 0, y: 64 }, { x: 16, y: 64 }] },     // "!" doré
  angry: { src: EMOTE_SHEET, frames: [{ x: 0, y: 80 }, { x: 16, y: 80 }] },     // "!" rouge
  zzz:   { src: EMOTE_SHEET, frames: [{ x: 96, y: 80 }, { x: 112, y: 80 }] },   // "Z" bleu
  think: { src: EMOTE_SHEET, frames: [{ x: 32, y: 144 }, { x: 48, y: 144 }] },  // "…" points bleus (natif)
  work:  { src: EMOTE_SHEET, frames: [{ x: 64, y: 64 }, { x: 80, y: 64 }] },    // marteau (running)
  mail:  { src: EMOTE_SHEET, frames: [{ x: 0, y: 64 }, { x: 16, y: 64 }] },     // "!" doré (notif, bell active)
};

// Icônes composées dans EMOTE_BUBBLE_EMPTY (bake-assets.js centre l'icône
// bbox-trimmée sur chacune des 2 frames de bulle). `agents` fait exception :
// aucune icône Modern UI ne rendait mieux qu'un médaillon déjà présent dans le
// sheet émotes (petit visage/casque robotique, rangée 7) → frames natives
// directement, comme EMOTES (cf. rapport task-1, § agents).
// v26 : le mapping par-outil (terminal/search/write/web/gear/agents) est
// débranché dans emoteFor (running → toujours emote.work, choix Paul
// 2026-07-17) mais reste baké ici — réactivable sans retoucher le bake.
const TOOL_EMOTES = {
  terminal: { icon: { src: UI_ICONS_SHEET, x: 304, y: 48, w: 16, h: 16 } },  // écran/moniteur (Bash)
  search:   { icon: { src: UI_ICONS_SHEET, x: 224, y: 144, w: 16, h: 16 } }, // loupe (Read/Grep/Glob)
  write:    { icon: { src: UI_ICONS_SHEET, x: 448, y: 160, w: 16, h: 16 } }, // crayon (Edit/Write/NotebookEdit)
  web:      { icon: { src: UI_ICONS_SHEET, x: 384, y: 128, w: 16, h: 16 } }, // flèches de rechargement circulaires (pas de globe dans le pack — WebFetch/WebSearch)
  gear:     { icon: { src: UI_ICONS_SHEET, x: 240, y: 0, w: 16, h: 16 } },   // engrenage (mcp__*/inconnu)
  agents:   { src: EMOTE_SHEET, frames: [{ x: 0, y: 112 }, { x: 16, y: 112 }] }, // médaillon natif (Task)
};

module.exports = {
  CHAR_ROWS, DIRS, charFrameRect, FURNITURE, TILES, COFFEE, premadePath,
  EMOTE_SHEET, UI_ICONS_SHEET, EMOTE_BUBBLE_EMPTY, EMOTES, TOOL_EMOTES,
};
