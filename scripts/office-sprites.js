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

module.exports = { CHAR_ROWS, DIRS, charFrameRect, FURNITURE, TILES, COFFEE, premadePath };
