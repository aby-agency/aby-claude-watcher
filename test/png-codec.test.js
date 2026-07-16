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
