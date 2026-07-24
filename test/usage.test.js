// Tests for usage.js _normalize (parsing de la réponse OAuth usage).
// Run: node test/usage.test.js
const { UsageMonitor } = require('../usage.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const m = new UsageMonitor();

// Réponse réelle observée 2026-07-24 : seven_day_sonnet/opus → null,
// la limite Fable vit dans limits[] (weekly_scoped).
const SAMPLE = {
  five_hour: { utilization: 12, resets_at: '2026-07-24T13:49:59Z' },
  seven_day: { utilization: 67, resets_at: '2026-07-24T17:59:59Z' },
  seven_day_sonnet: null,
  seven_day_opus: null,
  limits: [
    { kind: 'session', group: 'session', percent: 12, severity: 'normal', resets_at: '2026-07-24T13:49:59Z', scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 67, severity: 'normal', resets_at: '2026-07-24T17:59:59Z', scope: null, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 81, severity: 'warning', resets_at: '2026-07-24T17:59:59Z', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
  ],
};

console.log('\n_normalize — fenêtres de base:');
test('fiveHour / sevenDay picked', () => {
  const n = m._normalize(SAMPLE);
  assertEq(n.fiveHour.utilization, 12);
  assertEq(n.sevenDay.utilization, 67);
  assertEq(n.fiveHour.resetsAt, '2026-07-24T13:49:59Z');
});

console.log('\n_normalize — scopedLimits (limites par modèle):');
test('ne retient que les entrées scopées par modèle', () => {
  const n = m._normalize(SAMPLE);
  assertEq(n.scopedLimits.length, 1);
});
test('extrait model/percent/severity/group/resetsAt de Fable', () => {
  const l = m._normalize(SAMPLE).scopedLimits[0];
  assertEq(l.model, 'Fable');
  assertEq(l.percent, 81);
  assertEq(l.severity, 'warning');
  assertEq(l.group, 'weekly');
  assertEq(l.resetsAt, '2026-07-24T17:59:59Z');
});
test('générique : suit n\'importe quel display_name', () => {
  const l = m._normalize({ limits: [
    { group: 'weekly', percent: 40, scope: { model: { display_name: 'Opus' } } },
  ] }).scopedLimits[0];
  assertEq(l.model, 'Opus');
  assertEq(l.percent, 40);
  assertEq(l.severity, 'normal'); // défaut quand absent
});
test('limits absent → scopedLimits vide, pas de crash', () => {
  assertEq(m._normalize({ five_hour: { utilization: 5 } }).scopedLimits.length, 0);
});
test('entrée sans percent numérique ignorée', () => {
  const n = m._normalize({ limits: [
    { group: 'weekly', percent: null, scope: { model: { display_name: 'X' } } },
    { group: 'weekly', scope: { model: { display_name: 'Y' } } },
  ] });
  assertEq(n.scopedLimits.length, 0);
});
test('entrée scope=null (non scopée) ignorée', () => {
  const n = m._normalize({ limits: [
    { group: 'weekly', percent: 67, scope: null },
  ] });
  assertEq(n.scopedLimits.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
