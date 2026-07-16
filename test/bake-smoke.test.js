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
