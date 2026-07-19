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
const {
  CHAR_ROWS, charFrameRect, FURNITURE, TILES, COFFEE, premadePath,
  EMOTE_BUBBLE_EMPTY, EMOTES, TOOL_EMOTES,
} = require('./office-sprites.js');

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

// Bbox non transparente d'un rect (sx,sy,w,h) dans img (pour rogner une icône
// dans sa cellule 16×16 avant compositing — cf. compositeIconCentered).
function bboxRect(img, sx, sy, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (img.data[((sy + y) * img.width + (sx + x)) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
  if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Composite une icône (bbox-trimmée, centrée) sur une copie 16×16 d'une bulle
// vide — alpha-over simple (les sources sont du pixel art à antialiasing léger,
// pas besoin de premultiplied alpha). Retourne un buffer RGBA autonome 16×16.
function compositeIconCentered(bubbleImg, bx, by, iconImg, ix, iy) {
  const b = bboxRect(iconImg, ix, iy, 16, 16);
  const dx = Math.floor((16 - b.w) / 2), dy = Math.floor((16 - b.h) / 2);
  const out = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    const from = ((by + y) * bubbleImg.width + bx) * 4;
    bubbleImg.data.copy(out, y * 16 * 4, from, from + 16 * 4);
  }
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const sIdx = ((iy + b.y + y) * iconImg.width + (ix + b.x + x)) * 4;
    const a = iconImg.data[sIdx + 3];
    if (a === 0) continue;
    const dIdx = ((dy + y) * 16 + (dx + x)) * 4;
    if (a >= 250) { iconImg.data.copy(out, dIdx, sIdx, sIdx + 4); continue; }
    const sa = a / 255;
    for (let c = 0; c < 3; c++) out[dIdx + c] = Math.round(iconImg.data[sIdx + c] * sa + out[dIdx + c] * (1 - sa));
    out[dIdx + 3] = Math.max(out[dIdx + 3], a);
  }
  return { width: 16, height: 16, data: out };
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

// ─── Émotes-bulles (v2.4, natives étendues v26) ───
// Émotes natives : extraction directe de 2 frames (médaillons du sheet émotes).
// think/work/mail sont natifs depuis v26 (cf. office-sprites.js § EMOTES) —
// même traitement générique que alert/angry/zzz, plus de compositing pour eux.
for (const [name, spec] of Object.entries(EMOTES)) {
  const img = load(spec.src);
  const frames = [];
  spec.frames.forEach((f, i) => {
    const key = `emote.${name}.${i}`;
    items.push({ name: key, img, sx: f.x, sy: f.y, w: 16, h: 16 });
    frames.push(key);
  });
  anims[`emote.${name}`] = { frames, loop: true };
}

// Icônes-outils : composées dans la bulle vide (2 frames), sauf entrées déjà
// natives (ex. agents — cf. office-sprites.js) traitées comme EMOTES.
{
  const bubbleImg = load(EMOTE_BUBBLE_EMPTY.src);
  for (const [name, spec] of Object.entries(TOOL_EMOTES)) {
    const animName = `emote.tool.${name}`;
    const frames = [];
    if (spec.frames) {
      // Native : mêmes sheet/coords qu'EMOTES, juste un autre img/sheet possible.
      const img = load(spec.src);
      spec.frames.forEach((f, i) => {
        const key = `${animName}.${i}`;
        items.push({ name: key, img, sx: f.x, sy: f.y, w: 16, h: 16 });
        frames.push(key);
      });
    } else {
      const iconImg = load(spec.icon.src);
      EMOTE_BUBBLE_EMPTY.frames.forEach((bf, i) => {
        const composited = compositeIconCentered(bubbleImg, bf.x, bf.y, iconImg, spec.icon.x, spec.icon.y);
        const key = `${animName}.${i}`;
        items.push({ name: key, img: composited, sx: 0, sy: 0, w: 16, h: 16 });
        frames.push(key);
      });
    }
    anims[animName] = { frames, loop: true };
  }
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
                 'desk', 'deskSetup', 'chairBack', 'chairFront', 'chairOver', 'plant', 'coffee.0', 'coffee.3',
                 'floor', 'floorDark', 'floorWood', 'wall', 'meetingTable', 'sideDesk', 'laptop', 'vending', 'waterCooler',
                 'deskLamp', 'whiteboard', 'wallFrame',
                 // v4 (open-space zoné, mockup-v4.png)
                 'chairOrange', 'chairBlack', 'stationConsole',
                 'sofaCornerA', 'sofaCornerB', 'sofaCornerC', 'sofaCornerD',
                 'coffeeTable', 'sideDesk90', 'sideSetup90', 'tv',
                 'emote.think.0', 'emote.think.1', 'emote.alert.0', 'emote.alert.1',
                 'emote.angry.0', 'emote.angry.1', 'emote.zzz.0', 'emote.zzz.1',
                 'emote.mail.0', 'emote.mail.1', 'emote.work.0', 'emote.work.1',
                 'emote.tool.terminal.0', 'emote.tool.terminal.1',
                 'emote.tool.search.0', 'emote.tool.search.1',
                 'emote.tool.write.0', 'emote.tool.write.1',
                 'emote.tool.web.0', 'emote.tool.web.1',
                 'emote.tool.agents.0', 'emote.tool.agents.1',
                 'emote.tool.gear.0', 'emote.tool.gear.1'];
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
