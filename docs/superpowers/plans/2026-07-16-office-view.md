# Vue « Office » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un 4e viewMode `office` : open-space pixel-art (assets LimeZu) où chaque session Claude Code est un bureau avec un personnage animé reflétant son état.

**Architecture:** Un pipeline d'assets dev-only (`scripts/bake-assets.js` + codec PNG maison) génère un atlas gitignoré depuis les packs LimeZu locaux. Côté renderer, `ui/office-layout.js` (logique pure testable) calcule la scène depuis les sessions, et `ui/office.js` la dessine sur un canvas pixelated à 8 fps avec redraw à la demande. Intégration = 4e bouton de vue dans la toolbar existante.

**Tech Stack:** Vanilla JS (zéro dépendance, comme le reste du projet), canvas 2D, Node `zlib` pour le codec PNG. Tests = fichiers `node test/x.test.js` (pattern existant).

## Global Constraints

- **Aucune dépendance npm nouvelle** (ni prod ni dev) — le projet est 100 % vanilla.
- **Repo public + licence LimeZu = jamais d'asset commité.** `ui/office-assets/` est gitignoré. Les sources sont lues depuis `~/Project/Games/Assets/` (surchargeable par env `BAKE_ASSETS_SRC`).
- Les assets bruts sont tous **PNG 8-bit colorType 6 (RGBA) non entrelacés** — le codec ne gère que ce cas et refuse le reste avec une erreur claire.
- Échelle scène : tiles **16×16**, upscale entier (3× par défaut), `image-rendering: pixelated`. Frames personnages : **16 large × 32 haut**.
- Couleurs d'état (identiques au reste de l'app) : thinking `#a78bfa`, running `#3b82f6`, waiting `#22c55e`, pending `#f59e0b`, error `#ef4444`.
- Anim tick **8 fps** (125 ms), redraw uniquement si quelque chose a changé. Vue inactive = boucle stoppée.
- Messages de commit : format existant du repo (`feat:`, `chore:`, …), **sans trailer Co-Authored-By** (règle globale de Paul).
- Ne jamais `git push` (règle globale).
- i18n : toute string UI passe par `i18n.js` (fr + en).
- Tout nouveau fichier runtime hors `ui/` doit être ajouté à `package.json` `build.files` (piège whitelist). `ui/**/*` est déjà whitelisté — les fichiers sous `ui/` et l'atlas généré sont donc couverts d'office.

## Référence assets (vérifiée sur les fichiers réels)

Chemins sources (préfixe `SRC` = `$BAKE_ASSETS_SRC` ou `~/Project/Games/Assets`) :

- Personnages : `SRC/moderninteriors-win/2_Characters/Character_Generator/0_Premade_Characters/16x16/Premade_Character_NN.png` (NN = 01…10). Feuille 896×656 : grille régulière **frame = 16 large × 32 haut**, cellule (col, row) → `x = col*16`, `y = row*32`. Rangées utiles (ordre identique au guide LimeZu) :
  - row 1 (y=32) : **idle** — 24 frames = 6 par direction, ordre directions **right, up, left, down**
  - row 2 (y=64) : **walk** — 24 frames (6×4, même ordre)
  - row 4 (y=128) : **sit** — 12 frames (6 right, 6 left)
  - row 6 (y=192) : **phone** — 12 frames (utiliser les 6 premières, profil right)
  - row 19 (y=608) : **hurt** — 8 frames
  - L'ordre des directions est à confirmer visuellement via `--preview` (étape prévue) ; si l'ordre réel diffère, corriger `DIRS` dans `office-sprites.js`.
- Mobilier : `SRC/Modern_Office_Revamped_v1.2/4_Modern_Office_singles/16x16/Modern_Office_Singles_N.png`. Canvas 32×48, objet à rogner sur sa bbox non transparente au bake. IDs retenus (vérifiés sur contact sheet) :
  - `284` bureau large (2 tiles), `227` setup double écran (à poser sur le bureau), `106` chaise dos, `196` chaise face, `98` plante, `173` fontaine à eau, `175` distributeur, `191` table (réunion), `246` petit bureau 1 tile (subagents), `96` poster.
- Sols/murs : `SRC/Modern_Office_Revamped_v1.2/1_Room_Builder_Office/Room_Builder_Office_16x16.png` (256×224). Tiles 16×16 : sol principal gris `(160,112)`, sol sombre back-office `(160,144)`, sol bois coin café `(208,80)`, mur face `(0,176)`. Coordonnées à confirmer via `--preview`.
- Machine à café animée : `SRC/moderninteriors-win/3_Animated_objects/16x16/spritesheets/animated_coffee.png` (96×32 → 6 frames 16×32).
- Les écrans de PC n'ont **pas** de sprite par état : la lueur d'écran est un rect de ~6×4 px dessiné par-dessus le moniteur avec la couleur d'état. Zéro sprite à trouver, couleurs exactes garanties.

## File Structure

- Create: `scripts/png-codec.js` — decode/encode PNG RGBA (dev-only, requis par bake + tests)
- Create: `scripts/office-sprites.js` — manifest déclaratif (quels sprites extraire, d'où) — données pures
- Create: `scripts/bake-assets.js` — CLI : compose `ui/office-assets/atlas.png` + `atlas.json` (+ `--preview`)
- Create: `ui/office-layout.js` — logique pure : slots, croissance pièce, diff sessions→acteurs, machine d'anim, déplacements
- Create: `ui/office.js` — moteur canvas : chargement atlas, rendu, tick, hit-test, tooltip
- Modify: `ui/index.html` — bouton office, conteneur `<canvas>` + tooltip, `<script src="office.js">` (après renderer.js)
- Modify: `ui/renderer.js` — viewMode `office` (init clamp, setView, render, updateSession hook)
- Modify: `ui/styles.css` — `.office-view`, tooltip, bouton
- Modify: `i18n.js` — clés `view_office`, `office_assets_missing`
- Modify: `.gitignore` — `ui/office-assets/`
- Modify: `package.json` — script `bake`, chaîne `test` étendue
- Modify: `README.md` — crédit LimeZu + doc `npm run bake`
- Test: `test/png-codec.test.js`, `test/office-layout.test.js`, `test/bake-smoke.test.js`

Chargé après `renderer.js`, `ui/office.js` partage son scope global : il consomme `sessions` (Map), `formatDuration`, `formatModel`, `getStateLabel`, `handleFocus`, `t` définis dans renderer.js.

---

### Task 1: Codec PNG minimal (`scripts/png-codec.js`)

**Files:**
- Create: `scripts/png-codec.js`
- Test: `test/png-codec.test.js`

**Interfaces:**
- Consumes: rien (Node `zlib` uniquement)
- Produces: `decodePNG(buffer) → {width, height, data}` (`data` = Buffer RGBA, 4 octets/pixel) ; `encodePNG(width, height, data) → Buffer`. Jette `Error` si le PNG n'est pas 8-bit colorType 6 non entrelacé.

- [ ] **Step 1: Write the failing test**

```js
// test/png-codec.test.js — Run: node test/png-codec.test.js
const { decodePNG, encodePNG } = require('../scripts/png-codec.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

console.log('\nround-trip:');
test('encode puis decode restitue pixels et dimensions', () => {
  const w = 5, h = 3;
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 37) % 256;      // R
    data[i * 4 + 1] = (i * 53) % 256;  // G
    data[i * 4 + 2] = (i * 11) % 256;  // B
    data[i * 4 + 3] = i % 2 ? 255 : 0; // A
  }
  const png = encodePNG(w, h, data);
  // signature PNG
  assertEq(png[0], 0x89); assertEq(png[1], 0x50);
  const back = decodePNG(png);
  assertEq(back.width, w); assertEq(back.height, h);
  assert(back.data.equals(data), 'pixels différents après round-trip');
});
test('decode refuse un buffer non-PNG', () => {
  let threw = false;
  try { decodePNG(Buffer.from('pas un png')); } catch (e) { threw = true; }
  assert(threw, 'aurait dû jeter');
});
test('round-trip image 1x1 transparente', () => {
  const data = Buffer.from([0, 0, 0, 0]);
  const back = decodePNG(encodePNG(1, 1, data));
  assertEq(back.width, 1); assert(back.data.equals(data));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/png-codec.test.js`
Expected: FAIL — `Cannot find module '../scripts/png-codec.js'`

- [ ] **Step 3: Write the implementation**

```js
// scripts/png-codec.js — codec PNG minimal, dev-only (bake + tests).
// Ne gère QUE le format des assets LimeZu : 8-bit, colorType 6 (RGBA),
// non entrelacé. Tout autre format = erreur explicite.
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePNG(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('pas un PNG');
  let pos = 8, width = 0, height = 0, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8], colorType = data[9], interlace = data[12];
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`PNG non supporté (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}) — attendu 8/6/0`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len; // len + type + data + crc
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  // Défiltrage (spec PNG §9) : chaque scanline est préfixée d'un octet de filtre.
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;   // left
      const b = prev[x];                    // up
      const c = x >= 4 ? prev[x - 4] : 0;  // up-left
      let v;
      switch (filter) {
        case 0: v = line[x]; break;
        case 1: v = line[x] + a; break;
        case 2: v = line[x] + b; break;
        case 3: v = line[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`filtre PNG inconnu: ${filter}`);
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, data) {
  if (data.length !== width * height * 4) throw new Error('data ≠ width*height*4');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtre 0 (none)
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { decodePNG, encodePNG };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/png-codec.test.js`
Expected: PASS — `3 passed, 0 failed`

- [ ] **Step 5: Sanity check sur un vrai asset LimeZu**

Run: `node -e "const {decodePNG}=require('./scripts/png-codec.js');const os=require('os');const r=decodePNG(require('fs').readFileSync(os.homedir()+'/Project/Games/Assets/moderninteriors-win/2_Characters/Character_Generator/0_Premade_Characters/16x16/Premade_Character_01.png'));console.log(r.width, r.height)"`
Expected: `896 656`

- [ ] **Step 6: Commit**

```bash
git add scripts/png-codec.js test/png-codec.test.js
git commit -m "feat(office): codec PNG minimal (RGBA 8-bit) pour le bake d'assets"
```

---

### Task 2: Manifest de sprites + bake script

**Files:**
- Create: `scripts/office-sprites.js`
- Create: `scripts/bake-assets.js`
- Modify: `.gitignore` (ajouter `ui/office-assets/`)
- Modify: `package.json` (script `"bake": "node scripts/bake-assets.js"`)
- Test: `test/bake-smoke.test.js`

**Interfaces:**
- Consumes: `decodePNG`/`encodePNG` de Task 1.
- Produces: `ui/office-assets/atlas.png` + `ui/office-assets/atlas.json`. Format du JSON :
  ```json
  {
    "tile": 16,
    "frames": { "<name>": { "x": 0, "y": 0, "w": 16, "h": 32 } },
    "anims": { "charN.<anim>.<dir>": { "frames": ["<name>", "…"], "loop": true } }
  }
  ```
  Noms de frames : `charN.idle.right.0` … (N = 0…9), `desk`, `deskSetup`, `chairBack`, `chairFront`, `plant`, `waterCooler`, `vending`, `meetingTable`, `sideDesk`, `poster`, `coffee.0`…`coffee.5`, `floor`, `floorDark`, `floorWood`, `wall`.
  Anims : `charN.idle.{right,up,left,down}`, `charN.walk.{...}`, `charN.sit.{right,left}`, `charN.phone.right`, `charN.hurt` (loop:false).
  `office-sprites.js` exporte `{ CHAR_ROWS, DIRS, FURNITURE, TILES, COFFEE, charFrameRect(row, i), premadePath(n) }`.

- [ ] **Step 1: Write the failing smoke test**

Le smoke test tourne SEULEMENT si l'atlas a été généré (les sources LimeZu n'existent que sur la machine de Paul) — sinon il skippe proprement pour ne pas casser `npm test` sur un clone frais.

```js
// test/bake-smoke.test.js — Run: node test/bake-smoke.test.js
// Vérifie la cohérence atlas.png ↔ atlas.json si l'atlas existe (skip sinon).
const fs = require('fs');
const path = require('path');
const { decodePNG } = require('../scripts/png-codec.js');

const dir = path.join(__dirname, '..', 'ui', 'office-assets');
if (!fs.existsSync(path.join(dir, 'atlas.json'))) {
  console.log('bake-smoke: pas d\'atlas généré, skip (normal hors machine de Paul)');
  process.exit(0);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'atlas.json'), 'utf8'));
const atlas = decodePNG(fs.readFileSync(path.join(dir, 'atlas.png')));

test('tile = 16', () => assert(manifest.tile === 16));
test('toutes les frames sont dans les bornes de l\'atlas', () => {
  for (const [name, f] of Object.entries(manifest.frames)) {
    assert(f.x >= 0 && f.y >= 0 && f.x + f.w <= atlas.width && f.y + f.h <= atlas.height,
      `${name} hors bornes: ${JSON.stringify(f)} vs ${atlas.width}x${atlas.height}`);
  }
});
test('toutes les anims référencent des frames existantes', () => {
  for (const [name, a] of Object.entries(manifest.anims)) {
    assert(a.frames.length > 0, `${name}: anim vide`);
    for (const f of a.frames) assert(manifest.frames[f], `${name}: frame inconnue ${f}`);
  }
});
test('frames obligatoires présentes', () => {
  for (const req of ['floor', 'floorDark', 'floorWood', 'wall', 'desk', 'deskSetup',
                     'chairBack', 'plant', 'coffee.0', 'meetingTable', 'sideDesk']) {
    assert(manifest.frames[req], `frame manquante: ${req}`);
  }
});
test('10 personnages avec anims complètes', () => {
  for (let n = 0; n < 10; n++) {
    for (const anim of ['idle.down', 'idle.right', 'walk.down', 'walk.up', 'phone.right', 'hurt']) {
      assert(manifest.anims[`char${n}.${anim}`], `anim manquante: char${n}.${anim}`);
    }
  }
});
test('au moins un pixel non transparent dans la frame desk', () => {
  const f = manifest.frames.desk;
  let opaque = 0;
  for (let y = f.y; y < f.y + f.h; y++)
    for (let x = f.x; x < f.x + f.w; x++)
      if (atlas.data[(y * atlas.width + x) * 4 + 3] > 0) opaque++;
  assert(opaque > 10, `desk quasi vide (${opaque} px opaques)`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/bake-smoke.test.js`
Expected: exit 0 avec message skip (pas d'atlas) — le test devient significatif après le bake du Step 5.

- [ ] **Step 3: Write `scripts/office-sprites.js` (manifest déclaratif)**

```js
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
  floorDark: { src: ROOM_BUILDER, x: 160, y: 144 },
  floorWood: { src: ROOM_BUILDER, x: 208, y: 80 },
  wall:      { src: ROOM_BUILDER, x: 0,   y: 176 },
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
```

- [ ] **Step 4: Write `scripts/bake-assets.js`**

```js
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
const { CHAR_ROWS, DIRS, charFrameRect, FURNITURE, TILES, COFFEE, premadePath } = require('./office-sprites.js');

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
```

- [ ] **Step 5: Baker et vérifier visuellement**

Run: `node scripts/bake-assets.js --preview`
Expected: `atlas: 1024x<H>, ~750 frames, ~130 anims → …/ui/office-assets`

Puis OUVRIR `ui/office-assets/preview.png` (Read tool) et vérifier, dans l'ordre listé par la sortie console :
1. `char0.idle.down.0` regarde **vers le bas** (visage visible). Si c'est une autre direction, corriger l'ordre `DIRS` dans `office-sprites.js` et re-baker.
2. `desk` est un bureau, `coffee.0` une machine à café, `floor`/`floorDark`/`floorWood`/`wall` sont des tiles pleines cohérentes. Si une tile Room Builder est vide ou moche, ajuster ses coordonnées dans `TILES` (par pas de 16) et re-baker.

- [ ] **Step 6: Run smoke test — significatif maintenant**

Run: `node test/bake-smoke.test.js`
Expected: PASS — `6 passed, 0 failed`

- [ ] **Step 7: gitignore + package.json**

Dans `.gitignore`, ajouter la ligne :
```
ui/office-assets/
```
Dans `package.json` → `"scripts"`, ajouter :
```json
"bake": "node scripts/bake-assets.js",
```
et remplacer la valeur de `"test"` par la chaîne existante suffixée de :
```
 && node test/png-codec.test.js && node test/bake-smoke.test.js && node test/office-layout.test.js
```
(office-layout.test.js arrive en Task 3 — l'ajouter dès maintenant est OK : `npm test` ne sera lancé en entier qu'à partir de là.)

Vérifier que `git status` ne montre PAS `ui/office-assets/` :
Run: `git status --short`
Expected: pas de ligne `ui/office-assets/`

- [ ] **Step 8: Commit**

```bash
git add scripts/office-sprites.js scripts/bake-assets.js test/bake-smoke.test.js .gitignore package.json
git commit -m "feat(office): bake script — atlas LimeZu gitignoré (licence: jamais commité)"
```

---

### Task 3: Layout pur — slots, pièce, acteurs (`ui/office-layout.js`)

**Files:**
- Create: `ui/office-layout.js`
- Test: `test/office-layout.test.js`

**Interfaces:**
- Consumes: rien (module pur, chargé et en `<script>` et en `require` — pattern UMD minimal comme ci-dessous).
- Produces (utilisé par `ui/office.js` en Task 4) :
  - `createOfficeState()` → état opaque (slots, acteurs) à conserver entre frames.
  - `layoutRoom(state, snapshot)` → `{ cols, rows, statics, zones }` où `snapshot = { interactive: [...], background: [...], workflows: [{runId, name, running}] }` (sessions = objets du renderer : `sessionId`, `state.name`, `subagents`, …). `statics` = `[{ frame, tx, ty }]` (tiles & meubles, tx/ty en tiles, ancre = coin bas-gauche pour les meubles plus hauts qu'une tile). `zones` = `{ door: {tx,ty}, coffee: {tx,ty}, desks: Map<sessionId,{tx,ty}>, meeting: [{tx,ty}...], sideDesks: Map<sessionId,[{tx,ty}...]> }`.
  - `syncActors(state, snapshot)` → met à jour `state.actors` (Map<id, actor>) par diff. Actor : `{ id, sessionId, charIdx, kind: 'session'|'subagent'|'meeting', activity, tx, ty, targetTx, targetTy, path: [{tx,ty}...], dir, animFrame, done }`.
  - `activityFor(stateName)` → `'work'|'think'|'coffee'|'call'|'down'` (mapping spec).
  - `charIndexFor(projectName)` → 0…9 stable (hash).
  - `tickActor(actor, zones)` → avance d'une case sur `path` (appelé à chaque tick de 125 ms ; 1 case par 2 ticks = ~4 tiles/s), met à jour `dir` ; retourne `true` si l'acteur a bougé.
  - `animFor(actor)` → nom d'anim atlas (`char3.walk.left`, `char3.phone.right`, …) selon activity + mouvement.
  - Constantes : `ROOM_COLS = 16`, `DESKS_PER_ROW = 3`, `MAX_DESKS = 16`.

Géométrie (fixée ici, tout en tiles) :
- Pièce : largeur 16. Rangée 0 = mur (`wall`). Porte en `(1, 0)`.
- Coin café colonne 12-15, rangées 1-4 : sol `floorWood`, machine à café en `(13,1)`, fontaine `(14,1)`, plante `(15,1)` ; point d'attente café = `(13,3)`.
- Bureaux interactifs : 3 par rangée, cellule de 4 tiles de large × 3 de haut, première cellule en `(1, 2)`. Bureau session i : `tx = 1 + (i%3)*4`, `ty = 2 + floor(i/3)*3`. Dans la cellule : perso en `(tx+1, ty)`, bureau (`desk` + `deskSetup` par-dessus) en `(tx, ty+1)`, side-desks subagents en `(tx+3, ty)` et `(tx+3, ty+1)`.
- Salle de réunion (si workflow actif) : bande sous les bureaux, `meetingTable` au centre `(6, meetingTy)`, jusqu'à 6 sièges autour.
- Back-office (sessions headless) : bande du bas, sol `floorDark`, mêmes cellules bureau sans `deskSetup`, plafonné — au-delà de `MAX_DESKS` bureaux interactifs, l'excédent va aussi en back-office (compteur `+N` rendu par office.js).
- `rows` = calculé : 2 (mur+marge) + rangées bureaux + réunion éventuelle (4) + back-office éventuel + 1 (marge basse). Minimum 8.

Règles de slots : `Map sessionId→slotIndex` dans `state.slots` ; nouvelle session → plus petit slot libre ; jamais réassigné tant que la session vit ; slot libéré à la purge.

Machine d'activité (depuis la spec) :
| state.name | activity | position cible | anim |
|---|---|---|---|
| thinking | think | bureau | `idle.down` (2 fps) + bulle `…` |
| running | work | bureau | `idle.down` (8 fps), écran bleu clignotant |
| waiting | coffee | point café | `walk.*` en chemin, `idle.right` sur place |
| pending | call | bureau | `phone.right` + `!` ambre |
| error | down | bureau | `hurt` une fois puis dernière frame |
| (removed) | leave | porte | `walk.*`, puis `done = true` |
| (new) | enter | spawn porte → bureau | `walk.*` |

Chemins en L : d'abord horizontal jusqu'à la colonne cible, puis vertical (`pathTo(from, to)` → liste de cases). Changement de cible en route : recalcul du path depuis la case courante (le « demi-tour propre » de la spec).

- [ ] **Step 1: Write the failing tests**

```js
// test/office-layout.test.js — Run: node test/office-layout.test.js
const OL = require('../ui/office-layout.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

function sess(id, state, extra) {
  return Object.assign({ sessionId: id, projectName: `proj-${id}`, state: { name: state }, subagents: [], workflows: [] }, extra);
}
function snap(interactive, background, workflows) {
  return { interactive: interactive || [], background: background || [], workflows: workflows || [] };
}

console.log('\ncharIndexFor:');
test('stable pour un même nom', () => {
  assertEq(OL.charIndexFor('aby-claude-watcher'), OL.charIndexFor('aby-claude-watcher'));
});
test('dans [0,9]', () => {
  for (const n of ['a', 'watcher', 'x/y', '']) {
    const i = OL.charIndexFor(n);
    assert(i >= 0 && i <= 9 && Number.isInteger(i), `hors bornes: ${i}`);
  }
});

console.log('\nactivityFor:');
test('mapping complet', () => {
  assertEq(OL.activityFor('thinking'), 'think');
  assertEq(OL.activityFor('running'), 'work');
  assertEq(OL.activityFor('waiting'), 'coffee');
  assertEq(OL.activityFor('pending'), 'call');
  assertEq(OL.activityFor('error'), 'down');
});

console.log('\nslots (stabilité des bureaux):');
test('une session garde son bureau quand une autre part', () => {
  const st = OL.createOfficeState();
  OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]));
  const roomBefore = OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running')]));
  const deskC = roomBefore.zones.desks.get('c');
  // 'b' part → 'c' ne bouge pas
  const roomAfter = OL.layoutRoom(st, snap([sess('a', 'running'), sess('c', 'running')]));
  assertEq(roomAfter.zones.desks.get('c').tx, deskC.tx);
  assertEq(roomAfter.zones.desks.get('c').ty, deskC.ty);
});
test('un slot libéré est réutilisé par la session suivante', () => {
  const st = OL.createOfficeState();
  OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running')]));
  const room1 = OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running')]));
  const deskA = room1.zones.desks.get('a');
  OL.layoutRoom(st, snap([sess('b', 'running')]));           // a part
  const room2 = OL.layoutRoom(st, snap([sess('b', 'running'), sess('d', 'running')])); // d arrive
  assertEq(room2.zones.desks.get('d').tx, deskA.tx);          // d prend le slot de a
  assertEq(room2.zones.desks.get('d').ty, deskA.ty);
});

console.log('\ncroissance de la pièce:');
test('la 4e session ouvre une rangée de bureaux en dessous', () => {
  const st = OL.createOfficeState();
  const r4 = OL.layoutRoom(st, snap([sess('a', 'running'), sess('b', 'running'), sess('c', 'running'), sess('d', 'running')]));
  assertEq(r4.zones.desks.get('d').ty, r4.zones.desks.get('a').ty + 3);
  assertEq(r4.zones.desks.get('d').tx, r4.zones.desks.get('a').tx);
});
test('la pièce grandit avec les rangées (au-delà du minimum de 8)', () => {
  const s6 = OL.createOfficeState(), s9 = OL.createOfficeState();
  const many = n => Array.from({ length: n }, (_, i) => sess('s' + i, 'running'));
  const r6 = OL.layoutRoom(s6, snap(many(6)));
  const r9 = OL.layoutRoom(s9, snap(many(9)));
  assert(r9.rows === r6.rows + 3, `attendu +3 rangées, r6=${r6.rows} r9=${r9.rows}`);
});
test('cols constant à 16', () => {
  const st = OL.createOfficeState();
  assertEq(OL.layoutRoom(st, snap([sess('a', 'running')])).cols, 16);
});
test('au-delà de MAX_DESKS, excédent en back-office (overflow)', () => {
  const st = OL.createOfficeState();
  const many = []; for (let i = 0; i < OL.MAX_DESKS + 3; i++) many.push(sess('s' + i, 'running'));
  const room = OL.layoutRoom(st, snap(many));
  assertEq(room.zones.desks.size, OL.MAX_DESKS);
  assertEq(room.zones.overflow, 3);
});

console.log('\nzones:');
test('workflow actif → sièges de réunion', () => {
  const st = OL.createOfficeState();
  const room = OL.layoutRoom(st, snap([sess('a', 'running', { workflows: [{ runId: 'wf_1', name: 'rev', running: 4 }] })]));
  assert(room.zones.meeting.length >= 4, `sièges: ${room.zones.meeting.length}`);
  assert(room.zones.meeting.length <= 6, 'plafond 6');
});
test('sessions background → bureaux back-office séparés', () => {
  const st = OL.createOfficeState();
  const room = OL.layoutRoom(st, snap([sess('a', 'running')], [sess('bg1', 'running', { isBackground: true })]));
  assert(room.zones.backDesks.get('bg1'), 'bg1 sans bureau back-office');
  assert(room.zones.backDesks.get('bg1').ty > room.zones.desks.get('a').ty, 'back-office pas en bas');
});

console.log('\nsyncActors + tickActor:');
test('nouvelle session → acteur spawn à la porte avec path vers le bureau', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  assert(actor, 'pas d\'acteur');
  assertEq(actor.tx, room.zones.door.tx);
  assert(actor.path.length > 0, 'pas de chemin');
});
test('l\'acteur atteint son bureau en marchant', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  const desk = room.zones.desks.get('a');
  for (let i = 0; i < 200 && actor.path.length > 0; i++) OL.tickActor(actor, room.zones);
  assertEq(actor.tx, desk.tx + 1); // position perso = tx+1 dans la cellule
  assertEq(actor.ty, desk.ty);
});
test('waiting → path vers le café ; retour running en route → path retourné vers le bureau', () => {
  const st = OL.createOfficeState();
  let s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  while (actor.path.length > 0) OL.tickActor(actor, room.zones); // arrive au bureau
  s = snap([sess('a', 'waiting')]);
  OL.syncActors(st, s);
  assert(actor.path.length > 0, 'pas de départ vers le café');
  OL.tickActor(actor, room.zones); // fait quelques pas
  OL.tickActor(actor, room.zones);
  s = snap([sess('a', 'running')]);
  OL.syncActors(st, s);
  const dest = actor.path[actor.path.length - 1];
  assertEq(dest.tx, room.zones.desks.get('a').tx + 1); // il fait demi-tour
  assertEq(dest.ty, room.zones.desks.get('a').ty);
});
test('session supprimée → activity leave, done après la porte', () => {
  const st = OL.createOfficeState();
  let s = snap([sess('a', 'running')]);
  const room = OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const actor = st.actors.get('a');
  while (actor.path.length > 0) OL.tickActor(actor, room.zones);
  OL.syncActors(st, snap([]));                    // purge
  assertEq(actor.activity, 'leave');
  for (let i = 0; i < 200 && !actor.done; i++) OL.tickActor(actor, room.zones);
  assert(actor.done, 'jamais done');
});
test('subagents → acteurs kind=subagent aux side-desks (max 2)', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running', { subagents: [
    { agentId: 'g1' }, { agentId: 'g2' }, { agentId: 'g3' },
  ] })]);
  OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  const subs = [...st.actors.values()].filter(a => a.kind === 'subagent');
  assertEq(subs.length, 2);
});
test('workflow → acteurs kind=meeting (min(running,6))', () => {
  const st = OL.createOfficeState();
  const s = snap([sess('a', 'running', { workflows: [{ runId: 'wf_1', name: 'rev', running: 8 }] })]);
  OL.layoutRoom(st, s);
  OL.syncActors(st, s);
  assertEq([...st.actors.values()].filter(a => a.kind === 'meeting').length, 6);
});

console.log('\nanimFor:');
test('acteur en mouvement → walk.<dir>', () => {
  const a = { charIdx: 3, activity: 'coffee', path: [{ tx: 5, ty: 2 }], dir: 'left' };
  assertEq(OL.animFor(a), 'char3.walk.left');
});
test('work au bureau → idle.down', () => {
  assertEq(OL.animFor({ charIdx: 0, activity: 'work', path: [], dir: 'down' }), 'char0.idle.down');
});
test('call → phone.right, down → hurt, coffee arrivé → idle.right', () => {
  assertEq(OL.animFor({ charIdx: 1, activity: 'call', path: [], dir: 'down' }), 'char1.phone.right');
  assertEq(OL.animFor({ charIdx: 1, activity: 'down', path: [], dir: 'down' }), 'char1.hurt');
  assertEq(OL.animFor({ charIdx: 1, activity: 'coffee', path: [], dir: 'right' }), 'char1.idle.right');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/office-layout.test.js`
Expected: FAIL — `Cannot find module '../ui/office-layout.js'`

- [ ] **Step 3: Write the implementation**

```js
// ui/office-layout.js — logique pure de la vue office : slots de bureaux,
// dimensionnement de la pièce, acteurs (diff sessions), machine d'activité,
// chemins. Aucune dépendance DOM/canvas → testable en node (pattern ring-gauge).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const ROOM_COLS = 16;
  const DESKS_PER_ROW = 3;
  const MAX_DESKS = 16;
  const DESK_CELL_W = 4, DESK_CELL_H = 3;
  const FIRST_DESK = { tx: 1, ty: 2 };

  function createOfficeState() {
    return {
      slots: new Map(),     // sessionId → slotIndex (interactif)
      bgSlots: new Map(),   // sessionId → slotIndex (back-office)
      actors: new Map(),    // actorId → actor
    };
  }

  function charIndexFor(projectName) {
    let h = 0;
    const s = String(projectName || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 10;
  }

  function activityFor(stateName) {
    switch (stateName) {
      case 'thinking': return 'think';
      case 'running': return 'work';
      case 'waiting': return 'coffee';
      case 'pending': return 'call';
      case 'error': return 'down';
      default: return 'work';
    }
  }

  // Attribue le plus petit slot libre ; les slots vivants ne bougent jamais.
  function assignSlots(slotMap, ids, max) {
    for (const id of [...slotMap.keys()]) if (!ids.includes(id)) slotMap.delete(id);
    const used = new Set(slotMap.values());
    let overflow = 0;
    for (const id of ids) {
      if (slotMap.has(id)) continue;
      let s = 0;
      while (used.has(s)) s++;
      if (s >= max) { overflow++; continue; }
      slotMap.set(id, s);
      used.add(s);
    }
    return overflow;
  }

  function deskPos(slot, baseTy) {
    return { tx: FIRST_DESK.tx + (slot % DESKS_PER_ROW) * DESK_CELL_W,
             ty: baseTy + Math.floor(slot / DESKS_PER_ROW) * DESK_CELL_H };
  }

  function layoutRoom(state, snapshot) {
    const interactive = snapshot.interactive || [];
    const background = snapshot.background || [];
    const workflows = (snapshot.workflows || []).filter(w => w.running > 0);

    const overflowCount = assignSlots(state.slots, interactive.map(s => s.sessionId), MAX_DESKS);
    const deskCount = state.slots.size;
    const deskRows = Math.max(1, Math.ceil(deskCount / DESKS_PER_ROW)) * DESK_CELL_H;

    const meetingRows = workflows.length > 0 ? 4 : 0;
    const meetingTy = FIRST_DESK.ty + deskRows;

    const bgCount = background.length + overflowCount;
    assignSlots(state.bgSlots, background.map(s => s.sessionId), 99);
    const bgRows = bgCount > 0 ? Math.ceil(Math.max(1, state.bgSlots.size) / DESKS_PER_ROW) * DESK_CELL_H : 0;
    const bgTy = meetingTy + meetingRows;

    const rows = Math.max(8, bgTy + bgRows + 1);

    const zones = {
      door: { tx: 1, ty: 1 },
      coffee: { tx: 13, ty: 3 },
      desks: new Map(),
      backDesks: new Map(),
      meeting: [],
      sideDesks: new Map(),
      overflow: overflowCount,
      meetingTable: workflows.length > 0 ? { tx: 6, ty: meetingTy + 1 } : null,
    };
    for (const [id, slot] of state.slots) zones.desks.set(id, deskPos(slot, FIRST_DESK.ty));
    for (const [id, slot] of state.bgSlots) zones.backDesks.set(id, deskPos(slot, bgTy));
    for (const [id, d] of zones.desks) {
      zones.sideDesks.set(id, [{ tx: d.tx + 3, ty: d.ty }, { tx: d.tx + 3, ty: d.ty + 1 }]);
    }
    if (workflows.length > 0) {
      const t = zones.meetingTable;
      // 6 sièges : 3 au-dessus, 3 en dessous de la table (table 2 tiles de large)
      zones.meeting = [
        { tx: t.tx - 1, ty: t.ty - 1 }, { tx: t.tx, ty: t.ty - 1 }, { tx: t.tx + 1, ty: t.ty - 1 },
        { tx: t.tx - 1, ty: t.ty + 1 }, { tx: t.tx, ty: t.ty + 1 }, { tx: t.tx + 1, ty: t.ty + 1 },
      ];
    }

    // Tiles statiques : murs rangée 0, sols par zone, meubles.
    const statics = [];
    for (let x = 0; x < ROOM_COLS; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < rows; y++) {
      for (let x = 0; x < ROOM_COLS; x++) {
        let frame = 'floor';
        if (y >= bgTy && bgCount > 0) frame = 'floorDark';
        else if (x >= 12 && y <= 4) frame = 'floorWood';
        statics.push({ frame, tx: x, ty: y });
      }
    }
    statics.push({ frame: 'coffeeMachine', tx: 13, ty: 1 }); // rendu animé par office.js
    statics.push({ frame: 'waterCooler', tx: 14, ty: 1 });
    statics.push({ frame: 'plant', tx: 15, ty: 1 });
    statics.push({ frame: 'poster', tx: 4, ty: 0 });
    for (const [id, d] of zones.desks) {
      statics.push({ frame: 'desk', tx: d.tx, ty: d.ty + 1 });
      statics.push({ frame: 'deskSetup', tx: d.tx, ty: d.ty + 1, screen: id }); // screen → lueur d'état
    }
    for (const [, d] of zones.backDesks) statics.push({ frame: 'desk', tx: d.tx, ty: d.ty + 1 });
    if (zones.meetingTable) statics.push({ frame: 'meetingTable', tx: zones.meetingTable.tx, ty: zones.meetingTable.ty });
    statics.push({ frame: 'vending', tx: ROOM_COLS - 1, ty: rows - 1 });

    return { cols: ROOM_COLS, rows, statics, zones };
  }

  // Chemin en L : horizontal d'abord, puis vertical.
  function pathTo(from, to) {
    const path = [];
    let { tx, ty } = from;
    while (tx !== to.tx) { tx += Math.sign(to.tx - tx); path.push({ tx, ty }); }
    while (ty !== to.ty) { ty += Math.sign(to.ty - ty); path.push({ tx, ty }); }
    return path;
  }

  function charPosForDesk(d) { return { tx: d.tx + 1, ty: d.ty }; }

  function targetFor(activity, sessionId, zones) {
    const desk = zones.desks.get(sessionId);
    if (!desk) return null;
    if (activity === 'coffee') return zones.coffee;
    if (activity === 'leave') return zones.door;
    return charPosForDesk(desk);
  }

  function retarget(actor, target) {
    if (!target) return;
    const last = actor.path.length ? actor.path[actor.path.length - 1] : { tx: actor.tx, ty: actor.ty };
    if (last.tx === target.tx && last.ty === target.ty) return; // déjà en route
    actor.path = pathTo({ tx: actor.tx, ty: actor.ty }, target);
  }

  function syncActors(state, snapshot) {
    const zones = layoutRoom(state, snapshot).zones;
    const seen = new Set();

    for (const s of snapshot.interactive || []) {
      if (!zones.desks.has(s.sessionId)) continue; // overflow → pas d'acteur
      seen.add(s.sessionId);
      let actor = state.actors.get(s.sessionId);
      const activity = activityFor(s.state.name);
      if (!actor) {
        actor = { id: s.sessionId, sessionId: s.sessionId, kind: 'session',
                  charIdx: charIndexFor(s.projectName), activity,
                  tx: zones.door.tx, ty: zones.door.ty, path: [], dir: 'down',
                  animFrame: 0, done: false };
        state.actors.set(s.sessionId, actor);
        retarget(actor, targetFor(activity, s.sessionId, zones));
      } else if (actor.activity !== activity) {
        actor.activity = activity;
        actor.animFrame = 0;
        retarget(actor, targetFor(activity, s.sessionId, zones));
      }
      // Subagents : max 2 acteurs aux side-desks
      const sides = zones.sideDesks.get(s.sessionId) || [];
      const subs = (s.subagents || []).slice(0, 2);
      subs.forEach((sub, i) => {
        const aid = `${s.sessionId}:sub:${sub.agentId}`;
        seen.add(aid);
        if (!state.actors.has(aid) && sides[i]) {
          state.actors.set(aid, { id: aid, sessionId: s.sessionId, kind: 'subagent',
            charIdx: charIndexFor(sub.agentId), activity: 'work',
            tx: sides[i].tx, ty: sides[i].ty, path: [], dir: 'down', animFrame: 0, done: false });
        }
      });
    }

    // Back-office : acteurs statiques au bureau, pas de walk (spawn direct)
    for (const s of snapshot.background || []) {
      const d = zones.backDesks.get(s.sessionId);
      if (!d) continue;
      seen.add(s.sessionId);
      if (!state.actors.has(s.sessionId)) {
        state.actors.set(s.sessionId, { id: s.sessionId, sessionId: s.sessionId, kind: 'session',
          charIdx: charIndexFor(s.projectName), activity: activityFor(s.state.name),
          tx: d.tx + 1, ty: d.ty, path: [], dir: 'down', animFrame: 0, done: false });
      } else {
        state.actors.get(s.sessionId).activity = activityFor(s.state.name);
      }
    }

    // Réunion : min(total running, 6) acteurs autour de la table
    const running = (snapshot.workflows || []).reduce((n, w) => n + (w.running || 0), 0);
    const nSeats = Math.min(running, zones.meeting.length);
    for (let i = 0; i < nSeats; i++) {
      const aid = `meeting:${i}`;
      seen.add(aid);
      if (!state.actors.has(aid)) {
        state.actors.set(aid, { id: aid, sessionId: null, kind: 'meeting',
          charIdx: i % 10, activity: 'work',
          tx: zones.meeting[i].tx, ty: zones.meeting[i].ty, path: [], dir: i < 3 ? 'down' : 'up',
          animFrame: 0, done: false });
      }
    }

    // Disparus → leave (sessions) ou suppression immédiate (subs/meeting)
    for (const [id, actor] of state.actors) {
      if (seen.has(id)) continue;
      if (actor.kind === 'session' && actor.activity !== 'leave') {
        actor.activity = 'leave';
        retarget(actor, zones.door);
      } else if (actor.kind !== 'session') {
        state.actors.delete(id);
      } else if (actor.done) {
        state.actors.delete(id);
      }
    }
    return zones;
  }

  // Avance d'une case tous les 2 ticks (compteur interne sur l'acteur).
  function tickActor(actor, zones) {
    if (actor.path.length === 0) {
      if (actor.activity === 'leave' && actor.tx === zones.door.tx && actor.ty === zones.door.ty) {
        actor.done = true;
      }
      return false;
    }
    actor._step = (actor._step || 0) + 1;
    if (actor._step % 2) return false;
    const next = actor.path.shift();
    actor.dir = next.tx > actor.tx ? 'right' : next.tx < actor.tx ? 'left' : next.ty > actor.ty ? 'down' : 'up';
    actor.tx = next.tx; actor.ty = next.ty;
    return true;
  }

  function animFor(actor) {
    const c = `char${actor.charIdx}`;
    if (actor.path.length > 0) return `${c}.walk.${actor.dir}`;
    switch (actor.activity) {
      case 'call': return `${c}.phone.right`;
      case 'down': return `${c}.hurt`;
      case 'coffee': return `${c}.idle.right`;
      default: return `${c}.idle.down`;
    }
  }

  return { createOfficeState, layoutRoom, syncActors, tickActor, animFor,
           activityFor, charIndexFor, pathTo, ROOM_COLS, DESKS_PER_ROW, MAX_DESKS };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/office-layout.test.js`
Expected: PASS — `18 passed, 0 failed`. Si un test de path/slot échoue, corriger l'implémentation (pas le test) — les invariants testés viennent de la spec.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: toutes les suites passent (les suites existantes ne touchent pas à ces fichiers).

- [ ] **Step 6: Commit**

```bash
git add ui/office-layout.js test/office-layout.test.js
git commit -m "feat(office): layout pur — slots stables, pièce, acteurs, chemins"
```

---

### Task 4: Moteur canvas (`ui/office.js`) + intégration UI

**Files:**
- Create: `ui/office.js`
- Modify: `ui/index.html` (bouton + vue + scripts)
- Modify: `ui/renderer.js` (viewMode office)
- Modify: `ui/styles.css`
- Modify: `i18n.js`

**Interfaces:**
- Consumes: `OfficeLayout` (global, Task 3) ; globals de renderer.js : `sessions` (Map), `getSortedSessions()`, `handleFocus(sessionId)`, `getStateLabel(s)`, `formatDuration(startedAt)`, `formatModel(model)`, `t(key)` ; atlas Task 2 via `fetch('office-assets/atlas.json')` + `Image`.
- Produces: objet global `Office` avec `Office.available()` (atlas présent ?), `Office.activate()`, `Office.deactivate()`, `Office.notifyUpdate()` (appelé par renderer.js quand les sessions changent).

- [ ] **Step 1: Écrire `ui/office.js`**

```js
// ui/office.js — moteur de rendu de la vue office. Chargé APRÈS renderer.js
// (partage son scope global : sessions, handleFocus, t, …).
// Boucle : tick anim 8 fps (setInterval 125 ms) quand la vue est active,
// redraw uniquement si quelque chose a changé (frame, état, souris).
const Office = (() => {
  const SCALE_MAX = 3;
  const TICK_MS = 125;
  const STATE_COLORS = { thinking: '#a78bfa', running: '#3b82f6', waiting: '#22c55e', pending: '#f59e0b', error: '#ef4444' };

  let atlas = null, manifest = null;     // Image + JSON
  let available = null;                   // null = pas encore sondé
  let state = null;                       // OfficeLayout.createOfficeState()
  let room = null;                        // dernier layoutRoom()
  let timer = null;
  let tickCount = 0;
  let hover = null;                       // { sessionId, x, y } sous le curseur
  let canvas, ctx, tooltip;

  async function probe() {
    if (available !== null) return available;
    try {
      const res = await fetch('office-assets/atlas.json');
      if (!res.ok) throw new Error(res.status);
      manifest = await res.json();
      atlas = new Image();
      await new Promise((ok, ko) => { atlas.onload = ok; atlas.onerror = ko; atlas.src = 'office-assets/atlas.png'; });
      available = true;
    } catch (e) {
      console.warn('[office] atlas indisponible:', e.message || e);
      available = false;
    }
    return available;
  }

  function snapshot() {
    const sorted = getSortedSessions();
    return {
      interactive: sorted.filter(s => !s.isBackground),
      background: sorted.filter(s => s.isBackground),
      workflows: sorted.flatMap(s => s.workflows || []),
    };
  }

  function drawFrame(name, px, py, scale) {
    const f = manifest.frames[name];
    if (!f) return;
    // ancre bas-gauche : les sprites plus hauts qu'une tile "dépassent" vers le haut
    ctx.drawImage(atlas, f.x, f.y, f.w, f.h, px, py - (f.h - 16) * scale, f.w * scale, f.h * scale);
  }

  function animFrameName(animName, frameIdx) {
    const a = manifest.anims[animName];
    if (!a) return null;
    return a.loop ? a.frames[frameIdx % a.frames.length]
                  : a.frames[Math.min(frameIdx, a.frames.length - 1)];
  }

  function draw() {
    const snap = snapshot();
    room = OfficeLayout.layoutRoom(state, snap);
    const scale = Math.max(1, Math.min(SCALE_MAX, Math.floor(canvas.clientWidth / (room.cols * 16))));
    const w = room.cols * 16 * scale, h = room.rows * 16 * scale;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    const sessionsById = new Map();
    for (const s of [...snap.interactive, ...snap.background]) sessionsById.set(s.sessionId, s);

    // 1. statiques (sols/murs d'abord, meubles ensuite — l'ordre de statics le garantit)
    for (const st of room.statics) {
      if (st.frame === 'coffeeMachine') {
        drawFrame(animFrameName('coffee', tickCount >> 1), st.tx * 16 * scale, st.ty * 16 * scale, scale);
        continue;
      }
      drawFrame(st.frame, st.tx * 16 * scale, st.ty * 16 * scale, scale);
      if (st.screen) { // lueur d'écran = état de la session
        const s = sessionsById.get(st.screen);
        const color = s && STATE_COLORS[s.state.name];
        if (color && s.state.name !== 'waiting') {
          ctx.fillStyle = color;
          ctx.globalAlpha = (s.state.name === 'running' && (tickCount & 4)) ? 0.4 : 0.9;
          ctx.fillRect((st.tx * 16 + 3) * scale, (st.ty * 16 - 6) * scale, 6 * scale, 4 * scale);
          ctx.globalAlpha = 1;
        }
      }
    }

    // 2. acteurs triés par ty (z-order)
    const actors = [...state.actors.values()].sort((a, b) => a.ty - b.ty);
    const hitRects = [];
    for (const a of actors) {
      // think → anim à 2 fps (>>2), autres → 8 fps
      const fi = a.activity === 'think' ? (a.animFrame >> 2) : a.animFrame;
      const fname = animFrameName(OfficeLayout.animFor(a), fi);
      const px = a.tx * 16 * scale, py = a.ty * 16 * scale;
      if (fname) drawFrame(fname, px, py, scale);
      // Bulles d'état au-dessus de la tête
      const s = sessionsById.get(a.sessionId);
      if (a.kind === 'session' && s) {
        if (s.state.name === 'thinking') pixelText('…', px + 4 * scale, py - 20 * scale, STATE_COLORS.thinking, scale);
        if (s.state.name === 'pending') pixelText('!', px + 6 * scale, py - 20 * scale, STATE_COLORS.pending, scale);
        if (!s.isBackground) hitRects.push({ sessionId: a.sessionId, x: px, y: py - 16 * scale, w: 16 * scale, h: 32 * scale });
      }
    }
    // Bureaux cliquables aussi (même vide, le poste reste la cible)
    for (const [id, d] of room.zones.desks) {
      hitRects.push({ sessionId: id, x: d.tx * 16 * scale, y: d.ty * 16 * scale, w: 3 * 16 * scale, h: 2 * 16 * scale });
    }
    // Overflow back-office
    if (room.zones.overflow > 0) {
      pixelText(`+${room.zones.overflow}`, (room.cols - 3) * 16 * scale, (room.rows - 1) * 16 * scale, '#9ca3af', scale);
    }
    canvas._hitRects = hitRects;
  }

  function pixelText(txt, x, y, color, scale) {
    ctx.font = `${7 * scale}px monospace`;
    ctx.fillStyle = color;
    ctx.fillText(txt, x, y);
  }

  function tick() {
    tickCount++;
    for (const a of state.actors.values()) {
      a.animFrame++;
      OfficeLayout.tickActor(a, room ? room.zones : null);
      if (a.done) state.actors.delete(a.id);
    }
    // Les anims tournent en continu (idle bob, café) : chaque tick change des
    // frames, donc chaque tick redessine. L'économie CPU vient de la boucle
    // entièrement stoppée quand la vue est inactive (deactivate()).
    draw();
  }

  function hitTest(ev) {
    const rects = canvas._hitRects || [];
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    for (let i = rects.length - 1; i >= 0; i--) {
      const h = rects[i];
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
    }
    return null;
  }

  function onMove(ev) {
    const hit = hitTest(ev);
    canvas.style.cursor = hit ? 'pointer' : 'default';
    if (!hit) { tooltip.style.display = 'none'; hover = null; return; }
    if (hover && hover.sessionId === hit.sessionId) return;
    hover = hit;
    const s = sessions.get(hit.sessionId);
    if (!s) return;
    tooltip.innerHTML = `
      <div class="office-tip-name">${esc(s.customName || s.projectName)}</div>
      <div class="office-tip-row">${esc(getStateLabel(s))} · ${esc(s.gitBranch || '—')}</div>
      <div class="office-tip-row">${formatModel(s.model)} · ${formatDuration(s.startedAt)}</div>`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(ev.clientX + 12, window.innerWidth - 220)}px`;
    tooltip.style.top = `${ev.clientY + 12}px`;
  }

  function onClick(ev) {
    const hit = hitTest(ev);
    if (hit) handleFocus(hit.sessionId); // handleFocus ignore déjà les headless
  }

  async function activate() {
    if (!(await probe())) return false;
    canvas = document.getElementById('officeCanvas');
    tooltip = document.getElementById('officeTooltip');
    ctx = canvas.getContext('2d');
    if (!canvas._wired) {
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; hover = null; });
      canvas.addEventListener('click', onClick);
      canvas._wired = true;
    }
    if (!state) state = OfficeLayout.createOfficeState();
    OfficeLayout.syncActors(state, snapshot());
    draw();
    if (!timer) timer = setInterval(tick, TICK_MS);
    return true;
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
    if (tooltip) tooltip.style.display = 'none';
  }

  function notifyUpdate() {
    if (!timer || !state) return; // vue inactive → rien
    OfficeLayout.syncActors(state, snapshot());
    // le prochain tick (≤125 ms) redessine avec le nouvel état
  }

  return { probe, activate, deactivate, notifyUpdate, isAvailable: () => available === true };
})();
```

- [ ] **Step 2: Intégration `ui/index.html`**

Après le bouton `btnMicro` (ligne ~44-49), ajouter dans `.view-segmented` :
```html
      <button class="filter-seg" id="btnOffice" data-i18n-title="view_office" title="Office view" style="display:none;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
          <line x1="9" y1="9" x2="9" y2="9.01"/><line x1="9" y1="12" x2="9" y2="12.01"/><line x1="9" y1="15" x2="9" y2="15.01"/>
        </svg>
      </button>
```
(caché par défaut — affiché par renderer.js si `Office.probe()` réussit)

Après `<div class="micro-view" …>` (ligne ~94), ajouter :
```html
    <div class="office-view" id="officeView" style="display:none;">
      <canvas id="officeCanvas"></canvas>
    </div>
```
Avant `</body>`, après le script renderer.js, ajouter :
```html
  <div class="office-tooltip" id="officeTooltip" style="display:none;"></div>
```
et remplacer les scripts par :
```html
  <script src="../i18n.js"></script>
  <script src="office-layout.js"></script>
  <script src="office.js"></script>
  <script src="renderer.js"></script>
```
**Ordre important** : `renderer.js` appelle `Office.probe()` dans son `init()`, donc `office.js` doit être chargé avant lui. L'inverse ne pose pas problème : `office.js` ne touche aux globals de renderer.js (`sessions`, `handleFocus`, …) qu'à l'exécution (`activate()`/`draw()`), jamais au chargement.

- [ ] **Step 3: Intégration `ui/renderer.js`**

1. Ligne 27-28, commentaire : `'grid' | 'compact' | 'micro' | 'office'`.
2. Ligne 82, le clamp devient :
```js
  if (!['grid', 'compact', 'micro', 'office'].includes(viewMode)) viewMode = 'grid';
```
3. Ligne 83 : `previousViewMode = (viewMode === 'micro') ? 'grid' : viewMode;` (inchangé).
4. Après la ligne 159 (`$btnMicro.addEventListener…`), ajouter :
```js
  const $btnOffice = document.getElementById('btnOffice');
  $btnOffice.addEventListener('click', () => setView('office'));
  Office.probe().then(ok => {
    if (ok) { $btnOffice.style.display = ''; }
    else if (viewMode === 'office') setView('grid'); // atlas parti entre deux runs
  });
```
5. `updateViewToggle()` (ligne 335) — ajouter :
```js
  document.getElementById('btnOffice').classList.toggle('active', viewMode === 'office');
```
6. `setView(mode)` (ligne 323) — au début de la fonction, ajouter :
```js
  if (mode !== 'office') Office.deactivate();
```
7. `render()` (ligne 656) — après la ligne `$microView.style.display = …`, ajouter :
```js
  const $officeView = document.getElementById('officeView');
  $officeView.style.display = viewMode === 'office' ? 'block' : 'none';
  if (viewMode === 'office') { Office.activate(); return updateStatusBar(); }
```
(le `return` court-circuite `fullRender()` — le DOM des cartes n'est pas reconstruit inutilement sous le canvas)
8. `updateSession(s)` (ligne 721) — première ligne de la fonction :
```js
  if (viewMode === 'office') { Office.notifyUpdate(); updateStatusBar(); return; }
```
9. `removeSessionFromDOM` (ligne 785) — première ligne :
```js
  if (viewMode === 'office') { Office.notifyUpdate(); return; }
```
(le `render()` en fin de fonction gère déjà les vues DOM ; en office l'acteur sort par la porte via le diff)

- [ ] **Step 4: Styles `ui/styles.css`** (à la fin du fichier)

```css
/* ═══ Office view ═══ */
.office-view {
  display: flex;
  justify-content: center;
  padding: 12px;
  overflow: auto;
}
.office-view canvas {
  image-rendering: pixelated;
  max-width: 100%;
}
.office-tooltip {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  background: var(--bg-card, #1c1c1f);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11px;
  max-width: 210px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.office-tip-name { font-weight: 600; margin-bottom: 3px; }
.office-tip-row { color: var(--text-dim, #9ca3af); }
```
(vérifier les noms de variables CSS réellement utilisés dans styles.css — reprendre ceux des cartes si différents)

- [ ] **Step 5: i18n** — dans `i18n.js`, bloc fr après `view_micro` (ligne 22) :
```js
      view_office: 'Vue bureau',
```
bloc en après `view_micro` (ligne 175) :
```js
      view_office: 'Office view',
```

- [ ] **Step 6: Vérification manuelle via CDP + sessions forgées**

1. Killer toute instance Electron du watcher, lancer `npm run dev` en arrière-plan (mémoire `feedback_dev_relaunch`).
2. Forger 2-3 fausses sessions (flow `reference_cdp_verification` : sleep + session.json) dans des états différents.
3. Via CDP : cliquer `#btnOffice`, screenshot du canvas — vérifier : pièce dessinée, persos aux bureaux, écrans colorés selon l'état, machine à café animée.
4. Passer une session en waiting → le perso marche vers le café.
5. Hover un bureau → tooltip ; click → spy sur `focusTerminal` appelé avec le bon sessionId.
6. Retour vue grid → vérifier `timer` coupé (pas de redraw : `Office.deactivate()` loggable temporairement).

Expected: les 6 points OK. Tout écart = bug à corriger avant commit.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: PASS complet.

- [ ] **Step 8: Commit**

```bash
git add ui/office.js ui/index.html ui/renderer.js ui/styles.css i18n.js
git commit -m "feat(office): vue bureau pixel-art — canvas, tooltip, clic focus"
```

---

### Task 5: Fallback sans atlas, README, vérif finale

**Files:**
- Modify: `README.md`
- Modify: `ui/renderer.js` (si besoin résiduel)

- [ ] **Step 1: Tester le fallback atlas absent**

```bash
mv ui/office-assets ui/office-assets.bak
```
Relancer l'app (`npm run dev` après kill). Expected :
- le bouton office est absent de la toolbar,
- aucune erreur console autre que le `console.warn('[office] …')`,
- si la config disait `viewMode: 'office'`, l'app retombe en grid sans crash.

```bash
mv ui/office-assets.bak ui/office-assets
```
Si un des trois points échoue, corriger `Office.probe()` / l'init de renderer.js et re-tester.

- [ ] **Step 2: README**

Dans `README.md`, section développement, ajouter :

```markdown
### Vue bureau (assets de jeu)

La vue « bureau » utilise les packs pixel-art de [LimeZu](https://limezu.itch.io/)
(Modern Interiors, Modern Office). Leur licence interdit la redistribution des
assets : ils ne sont **pas dans le repo**. Pour générer l'atlas en local :

    BAKE_ASSETS_SRC=/chemin/vers/les/packs npm run bake

Sans atlas, l'app fonctionne normalement — le bouton de vue bureau est
simplement masqué. Merci à LimeZu pour les assets. 🌱
```

- [ ] **Step 3: Vérification finale complète**

Run: `npm test`
Expected: PASS complet.

Run: `git status --short`
Expected: aucun fichier `ui/office-assets/*` listé.

Puis une passe visuelle rapide (app lancée, vraies sessions si dispo) : ouvrir la vue office, vérifier le rendu et le clic-focus sur une vraie session.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(office): crédit LimeZu + doc npm run bake"
```

---

## Hors plan (rappels)

- **Pas de release ici** : le flow release (`release_process.md`) est déclenché par Paul avec « mettre en prod ». Le bump de version + CHANGELOG se feront à ce moment-là.
- Si un DMG est buildé plus tard : `ui/**/*` couvre déjà `ui/office-assets/` dans `build.files` — vérifier après build que le DMG contient l'atlas (piège `build_files_whitelist_gotcha` : log dans `~/Library/Logs/aby-claude-watcher/main.log`).
- Améliorations parkées : recherche dans la vue office, persos custom, sons de scène.
