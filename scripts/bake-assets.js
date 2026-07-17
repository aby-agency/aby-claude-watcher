#!/usr/bin/env node
// bake-assets.js — génère ui/office-assets/{atlas.png,atlas.json} depuis les
// packs LimeZu locaux. Dev-only, tourne uniquement sur une machine qui a les
// packs (licence LimeZu : les assets ne sont JAMAIS commités, le dossier de
// sortie est gitignoré ; ils ne voyagent que dans le DMG).
//
// Usage: node scripts/bake-assets.js [--preview]
//   BAKE_ASSETS_SRC=/chemin/vers/Assets  (défaut: ~/Project/Games/Assets)
//   --preview : écrit aussi ui/office-assets/preview.png (contact sheet
//               étiqueté pour vérifier visuellement les coordonnées).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { decodePNG, encodePNG } = require('./png-codec.js');
const { CHAR_ROWS, charFrameRect, FURNITURE, TILES, COFFEE, premadePath } = require('./office-sprites.js');

const SRC = process.env.BAKE_ASSETS_SRC || path.join(os.homedir(), 'Project', 'Games', 'Assets');
const OUT = path.join(__dirname, '..', 'ui', 'office-assets');
const N_CHARS = 10;

function load(rel) {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) { console.error(`source manquante: ${p}`); process.exit(1); }
  return decodePNG(fs.readFileSync(p));
}

// Copie un rect (sx,sy,w,h) de src vers dst en (dx,dy).
function blit(src, sx, sy, w, h, dst, dstW, dx, dy) {
  for (let y = 0; y < h; y++) {
    const from = ((sy + y) * src.width + sx) * 4;
    const to = ((dy + y) * dstW + dx) * 4;
    src.data.copy(dst, to, from, from + w * 4);
  }
}

// Bbox non transparente d'une image entière (pour rogner les singles 32×48).
function bbox(img) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
  if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ─── Collecte des sprites à packer ───
// Chaque entrée : { name, img, sx, sy, w, h }
const items = [];

// Personnages
const anims = {};
for (let n = 0; n < N_CHARS; n++) {
  const sheet = load(premadePath(n));
  for (const [animName, spec] of Object.entries(CHAR_ROWS)) {
    for (let d = 0; d < spec.dirNames.length; d++) {
      const dirName = spec.dirNames[d];
      const frames = [];
      for (let i = 0; i < spec.perDir; i++) {
        const r = charFrameRect(spec.row, d * spec.perDir + i);
        const key = dirName ? `char${n}.${animName}.${dirName}.${i}` : `char${n}.${animName}.${i}`;
        items.push({ name: key, img: sheet, sx: r.x, sy: r.y, w: r.w, h: r.h });
        frames.push(key);
      }
      const animKey = dirName ? `char${n}.${animName}.${dirName}` : `char${n}.${animName}`;
      anims[animKey] = { frames, loop: spec.loop !== false };
    }
  }
}

// Mobilier (rogné à la bbox)
for (const [name, rel] of Object.entries(FURNITURE)) {
  const img = load(rel);
  const b = bbox(img);
  items.push({ name, img, sx: b.x, sy: b.y, w: b.w, h: b.h });
}

// Tiles sol/mur (16×16 fixes)
for (const [name, t] of Object.entries(TILES)) {
  const img = load(t.src);
  items.push({ name, img, sx: t.x, sy: t.y, w: 16, h: 16 });
}

// Machine à café (6 frames)
{
  const img = load(COFFEE.src);
  const frames = [];
  for (let i = 0; i < COFFEE.frames; i++) {
    items.push({ name: `coffee.${i}`, img, sx: i * COFFEE.w, sy: 0, w: COFFEE.w, h: COFFEE.h });
    frames.push(`coffee.${i}`);
  }
  anims['coffee'] = { frames, loop: true };
}

// ─── Packing shelf (rangées de hauteur fixe, atlas 1024 de large) ───
const ATLAS_W = 1024;
let cx = 0, cy = 0, rowH = 0;
const frames = {};
for (const it of items) {
  if (cx + it.w > ATLAS_W) { cx = 0; cy += rowH; rowH = 0; }
  frames[it.name] = { x: cx, y: cy, w: it.w, h: it.h };
  it.dx = cx; it.dy = cy;
  cx += it.w;
  if (it.h > rowH) rowH = it.h;
}
const ATLAS_H = cy + rowH;

const atlas = Buffer.alloc(ATLAS_W * ATLAS_H * 4);
for (const it of items) blit(it.img, it.sx, it.sy, it.w, it.h, atlas, ATLAS_W, it.dx, it.dy);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'atlas.png'), encodePNG(ATLAS_W, ATLAS_H, atlas));
fs.writeFileSync(path.join(OUT, 'atlas.json'),
  JSON.stringify({ tile: 16, frames, anims }, null, 1));
console.log(`atlas: ${ATLAS_W}x${ATLAS_H}, ${items.length} frames, ${Object.keys(anims).length} anims → ${OUT}`);

// ─── Preview (vérif visuelle des coordonnées) ───
if (process.argv.includes('--preview')) {
  // Grille 4× de quelques frames représentatives, sans lib : on assemble un
  // PNG où chaque frame est upscalée par duplication de pixels.
  const picks = ['char0.idle.down.0', 'char0.idle.right.0', 'char0.idle.up.0', 'char0.idle.left.0',
                 'char0.walk.down.2', 'char0.phone.right.3', 'char0.hurt.7', 'char3.idle.down.0',
                 'desk', 'deskSetup', 'chairBack', 'plant', 'coffee.0', 'coffee.3',
                 'floor', 'floorDark', 'floorWood', 'wall', 'meetingTable', 'sideDesk', 'vending', 'waterCooler'];
  const SCALE = 4, CELL_W = 40 * SCALE, CELL_H = 48 * SCALE, COLS = 6;
  const rows = Math.ceil(picks.length / COLS);
  const pw = COLS * CELL_W, ph = rows * CELL_H;
  const pv = Buffer.alloc(pw * ph * 4);
  // fond gris pour voir la transparence
  for (let i = 0; i < pw * ph; i++) { pv[i * 4] = 60; pv[i * 4 + 1] = 60; pv[i * 4 + 2] = 64; pv[i * 4 + 3] = 255; }
  picks.forEach((name, idx) => {
    const f = frames[name];
    if (!f) { console.warn(`preview: frame absente ${name}`); return; }
    const ox = (idx % COLS) * CELL_W + 8, oy = Math.floor(idx / COLS) * CELL_H + 8;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const s = ((f.y + y) * ATLAS_W + f.x + x) * 4;
      if (atlas[s + 3] === 0) continue;
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
        const d = ((oy + y * SCALE + dy) * pw + ox + x * SCALE + dx) * 4;
        atlas.copy(pv, d, s, s + 4);
      }
    }
  });
  fs.writeFileSync(path.join(OUT, 'preview.png'), encodePNG(pw, ph, pv));
  console.log(`preview → ${path.join(OUT, 'preview.png')} (ordre: ${picks.join(', ')})`);
}
