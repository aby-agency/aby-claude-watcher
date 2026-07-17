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
  desk:         `${SINGLES_DIR}/Modern_Office_Singles_284.png`,
  deskSetup:    `${SINGLES_DIR}/Modern_Office_Singles_227.png`,
  chairBack:    `${SINGLES_DIR}/Modern_Office_Singles_106.png`,
  chairFront:   `${SINGLES_DIR}/Modern_Office_Singles_196.png`,
  plant:        `${SINGLES_DIR}/Modern_Office_Singles_98.png`,
  waterCooler:  `${SINGLES_DIR}/Modern_Office_Singles_173.png`,
  vending:      `${SINGLES_DIR}/Modern_Office_Singles_175.png`,
  meetingTable: `${SINGLES_DIR}/Modern_Office_Singles_191.png`,
  sideDesk:     `${SINGLES_DIR}/Modern_Office_Singles_246.png`,
  poster:       `${SINGLES_DIR}/Modern_Office_Singles_96.png`,
  laptop:       `${SINGLES_DIR}/Modern_Office_Singles_136.png`, // laptop ouvert, écran visible (top-down)
  // v2.4 — mobilier de densité cubicle (choisi au preview parmi 141-146 / 170-172 / 113-115).
  deskLamp:     `${SINGLES_DIR}/Modern_Office_Singles_141.png`, // lampe articulée argentée
  whiteboard:   `${SINGLES_DIR}/Modern_Office_Singles_171.png`, // tableau blanc + petit graphe (moins chargé que 172)
  papersDesk:   `${SINGLES_DIR}/Modern_Office_Singles_113.png`, // pile de documents, liseré bleu
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
// compositing pour TOOL_EMOTES et MAIL_EMOTE.
const EMOTE_BUBBLE_EMPTY = { src: EMOTE_SHEET, frames: [{ x: 96, y: 64 }, { x: 112, y: 64 }] };

// Émotes natives : extraction directe de 2 frames (médaillon rangées 4-9), pas de
// compositing. Rouge = urgence (angry/error), doré = neutre (alert/pending).
// NB « think » : pas d'entrée ici — vérifié à l'œil (dump pixel direct, cf. rapport
// task-1) qu'aucune des 2 sheets n'a de picto « … » ellipsis propre (rangée y=144
// col4-5 qu'on croyait « points » au premier coup d'œil sur le contact-sheet est en
// fait un pansement rose). Synthétisé au bake sur EMOTE_BUBBLE_EMPTY via
// THINK_DOTS_INK ci-dessous, pour rester dans le même style médaillon.
const EMOTES = {
  alert: { src: EMOTE_SHEET, frames: [{ x: 0, y: 64 }, { x: 16, y: 64 }] },    // "!" doré
  angry: { src: EMOTE_SHEET, frames: [{ x: 0, y: 80 }, { x: 16, y: 80 }] },   // "!" rouge
  zzz:   { src: EMOTE_SHEET, frames: [{ x: 96, y: 80 }, { x: 112, y: 80 }] }, // "Z" bleu
};

// Encre des 3 points « … » de emote.think, synthétisés au bake (compositeThinkDots
// dans bake-assets.js) — même teinte que le contour bleu-nuit des médaillons, pour
// que la bulle reste cohérente avec alert/angry/zzz/mail malgré l'absence de
// picto source.
const THINK_DOTS_INK = [58, 62, 96, 255];

// Icônes composées dans EMOTE_BUBBLE_EMPTY (bake-assets.js centre l'icône
// bbox-trimmée sur chacune des 2 frames de bulle). `agents` fait exception :
// aucune icône Modern UI ne rendait mieux qu'un médaillon déjà présent dans le
// sheet émotes (petit visage/casque robotique, rangée 7) → frames natives
// directement, comme EMOTES (cf. rapport task-1, § agents).
const TOOL_EMOTES = {
  terminal: { icon: { src: UI_ICONS_SHEET, x: 304, y: 48, w: 16, h: 16 } },  // écran/moniteur (Bash)
  search:   { icon: { src: UI_ICONS_SHEET, x: 224, y: 144, w: 16, h: 16 } }, // loupe (Read/Grep/Glob)
  write:    { icon: { src: UI_ICONS_SHEET, x: 448, y: 160, w: 16, h: 16 } }, // crayon (Edit/Write/NotebookEdit)
  web:      { icon: { src: UI_ICONS_SHEET, x: 384, y: 128, w: 16, h: 16 } }, // flèches de rechargement circulaires (pas de globe dans le pack — WebFetch/WebSearch) ; distinct de MAIL_EMOTE (v24.1 : était pixel-identique à l'enveloppe, confondu avec le signal needs-you)
  gear:     { icon: { src: UI_ICONS_SHEET, x: 240, y: 0, w: 16, h: 16 } },   // engrenage (mcp__*/inconnu)
  agents:   { src: EMOTE_SHEET, frames: [{ x: 0, y: 112 }, { x: 16, y: 112 }] }, // médaillon natif (Task)
};

// Enveloppe compositée dans EMOTE_BUBBLE_EMPTY — notif (bell active), priorité
// maximale dans emoteFor (Task 2). Icône dédiée (ne PAS réutiliser pour un autre
// TOOL_EMOTE) : c'est LE signal needs-you de la vue office, aucune bulle outil ne
// doit lui ressembler (v24.1 : était pixel-identique à TOOL_EMOTES.web, confusion
// WebFetch / notif).
const MAIL_EMOTE = { icon: { src: UI_ICONS_SHEET, x: 432, y: 128, w: 16, h: 16 } };

module.exports = {
  CHAR_ROWS, DIRS, charFrameRect, FURNITURE, TILES, COFFEE, premadePath,
  EMOTE_SHEET, UI_ICONS_SHEET, EMOTE_BUBBLE_EMPTY, EMOTES, TOOL_EMOTES, MAIL_EMOTE,
  THINK_DOTS_INK,
};
