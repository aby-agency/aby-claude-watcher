// Tests for island-model.js. Run: node test/island-model.test.js
const { buildIsland, islandLayout, bannerPayload, updateNotice, ISLAND_MAX_SUBROWS } = require('../island-model.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// Session factory
const NOW = 1_000_000_000_000;
let n = 0;
function sess(state, opts = {}) {
  n++;
  return {
    sessionId: opts.id || `s${n}`,
    projectName: opts.name || `proj${n}`,
    customName: opts.customName || null,
    state: { name: state },
    isBackground: !!opts.bg,
    lastEventTime: opts.lastEventTime !== undefined ? opts.lastEventTime : NOW - 120000,
    startedAt: new Date(NOW - (opts.age || n) * 60000).toISOString(),
    stateSince: opts.stateSince !== undefined ? opts.stateSince : null,
    ...(opts.bgTaskCount !== undefined && { bgTaskCount: opts.bgTaskCount }),
    ...(opts.bgTasks !== undefined && { bgTasks: opts.bgTasks }),
  };
}

console.log('\nbuildIsland:');
// Pilule binaire (décision Paul/Etienne) : DROITE = ça bosse, GAUCHE = ça
// attend. Une pastille agrégée + compteur par aile, deux « états » de groupe.
test('right wing = busy (running/thinking), left wing = idle (waiting/pending/error)', () => {
  const m = buildIsland([sess('running'), sess('waiting')], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 1 }]);
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
});
test('busy aggregates running+thinking; idle aggregates waiting+pending+error', () => {
  const m = buildIsland([sess('running'), sess('running'), sess('thinking'), sess('waiting'), sess('pending'), sess('error')], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 3 }]);
  assertEq(m.left.leds, [{ state: 'idle', count: 3 }]);
});
test('empty group → empty wing (all working → left empty)', () => {
  const many = Array.from({ length: 9 }, () => sess('running'));
  const m = buildIsland(many, {});
  assertEq(m.right.leds, [{ state: 'busy', count: 9 }]);
  assertEq(m.left.leds, []);
});
// `delegating` = des délégués travaillent : ça tourne et ça reprendra seul,
// donc aile busy — le compter idle rappellerait l'utilisateur pour rien.
test('delegating counts as busy, not idle', () => {
  const m = buildIsland([sess('delegating'), sess('waiting')], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 1 }]);
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
});
test('delegating survit dans les rows du panneau (détail par état)', () => {
  const m = buildIsland([sess('delegating')], {});
  assertEq(m.rows.map(r => r.state), ['delegating']);
});
test('unknown state counts as idle (attend), never busy', () => {
  const m = buildIsland([sess('weird')], {});
  assertEq(m.right.leds, []);
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
});
test('headless sessions count in the activity wings when shown', () => {
  const m = buildIsland([sess('running'), sess('running', { bg: true })], {});
  assertEq(m.right.leds, [{ state: 'busy', count: 2 }]);
});
test('sessionOrder from config wins, then newest first', () => {
  const a = sess('running', { id: 'a', age: 10 });
  const b = sess('running', { id: 'b', age: 1 });
  const c = sess('running', { id: 'c', age: 5 });
  const m = buildIsland([a, b, c], { sessionOrder: ["c"] });
  assertEq(m.rows.map(r => r.sessionId), ['c', 'b', 'a']);
});
test('row name prefers customName over projectName', () => {
  const m = buildIsland([sess('running', { name: 'proj', customName: 'mon-nom' })], {});
  assertEq(m.rows[0].name, 'mon-nom');
});
test('backgroundRows flagged isBackground (panel keeps type split)', () => {
  const m = buildIsland([sess('running', { bg: true })], {});
  assertEq(m.rows.length, 0);
  assertEq(m.backgroundRows[0].isBackground, true);
});
test('islandShowHeadless:false excludes headless from wings and panel, keeps interactive', () => {
  const m = buildIsland([sess('running'), sess('waiting', { bg: true })], { islandShowHeadless: false });
  assertEq(m.right.leds, [{ state: 'busy', count: 1 }]);
  assertEq(m.left.leds, []); // le headless « waiting » est exclu du décompte
  assertEq(m.backgroundRows.length, 0);
  assertEq(m.rows.length, 1);
});
test('islandShowHeadless defaults to shown when flag absent', () => {
  const m = buildIsland([sess('waiting', { bg: true })], {});
  assertEq(m.left.leds, [{ state: 'idle', count: 1 }]);
  assertEq(m.backgroundRows.length, 1);
});
test('rows carry subagents (label fallback desc→type→subagent) and workflows', () => {
  const s = sess('running');
  s.subagents = [
    { agentId: 'a1', description: 'Review Task 2', agentType: 'general-purpose' },
    { agentId: 'a2', description: null, agentType: 'Explore' },
    { agentId: 'a3' },
  ];
  s.workflows = [{ runId: 'wf_x', name: 'review-changes', started: 7, done: 3, running: 2 }];
  const r = buildIsland([s], {}).rows[0];
  assertEq(r.subagents, [{ label: 'Review Task 2' }, { label: 'Explore' }, { label: 'subagent' }]);
  assertEq(r.workflows, [{ name: 'review-changes', started: 7, done: 3, running: 2 }]);
});
test('rows default to empty subagents/workflows when absent', () => {
  const r = buildIsland([sess('running')], {}).rows[0];
  assertEq(r.subagents, []);
  assertEq(r.workflows, []);
  assertEq(r.subagentsMore, 0);
});
test('subagents are capped per session in the island, the rest is counted (fan-out of 20 audits)', () => {
  const s = sess('running');
  s.subagents = Array.from({ length: 20 }, (_, i) => ({ agentId: 'a' + i, description: 'Audit ' + i }));
  const r = buildIsland([s], {}).rows[0];
  assertEq(r.subagents.length, ISLAND_MAX_SUBROWS);
  assertEq(r.subagents[0].label, 'Audit 0');
  assertEq(r.subagentsMore, 20 - ISLAND_MAX_SUBROWS);
  // Exactly at the cap → nothing hidden, no « +0 autres ».
  s.subagents = s.subagents.slice(0, ISLAND_MAX_SUBROWS);
  assertEq(buildIsland([s], {}).rows[0].subagentsMore, 0);
});

console.log('\nrow minutes (durée d\'état):');
test('minutes = minutes entières depuis stateSince, now injecté', () => {
  const m = buildIsland([sess('waiting', { stateSince: NOW - 12 * 60000 })], {}, NOW);
  assertEq(m.rows[0].minutes, 12);
});
test('minutes null sous 60 s (jamais de « 0 min »)', () => {
  const m = buildIsland([sess('waiting', { stateSince: NOW - 59000 })], {}, NOW);
  assertEq(m.rows[0].minutes, null);
});
test('minutes null sans stateSince (config antérieure)', () => {
  const m = buildIsland([sess('waiting')], {}, NOW);
  assertEq(m.rows[0].minutes, null);
});
test('minutes aussi sur les rangées headless', () => {
  const m = buildIsland([sess('running', { bg: true, stateSince: NOW - 5 * 60000 })], {}, NOW);
  assertEq(m.backgroundRows[0].minutes, 5);
});

console.log('\nislandLayout:');
// Mesure réelle (MBP 16" 1728pt) : encoche 185pt décentrée de 7pt à gauche.
test('centers window on the MEASURED notch, gap = notch + margin', () => {
  const d = { bounds: { x: 0, y: 0, width: 1728, height: 1117 } };
  const l = islandLayout(d, { left: 771, width: 185 }, 460);
  // centre encoche = 771 + 92.5 = 863.5 → x = 863.5 - 230 arrondi
  assertEq(l, { x: 634, gapPx: 209, h: 800 });
});
test('secondary display coords: bounds.x is added', () => {
  const d = { bounds: { x: 2000, y: 0, width: 1728, height: 1117 } };
  assertEq(islandLayout(d, { left: 771, width: 185 }, 460), { x: 2634, gapPx: 209, h: 800 });
});
test('no measurement → window centered on display, default gap 180', () => {
  const d = { internal: true, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 34, width: 1728, height: 1083 } };
  assertEq(islandLayout(d, null, 460), { x: 634, gapPx: 180, h: 800 });
});
test('invalid measurement (width <= 0, negative left) → fallback', () => {
  const d = { internal: true, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 34, width: 1728, height: 1083 } };
  assertEq(islandLayout(d, { left: 771, width: 0 }, 460), { x: 634, gapPx: 180, h: 800 });
  assertEq(islandLayout(d, { left: -5, width: 185 }, 460), { x: 634, gapPx: 180, h: 800 });
});
test('display sans encoche (docké) → centré, fausse encoche 180', () => {
  const d = { internal: false, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, workArea: { x: 0, y: 31, width: 3440, height: 1409 } };
  assertEq(islandLayout(d, null, 460), { x: 1490, gapPx: 180, h: 800 });
});
test('hauteur clampée à l\'écran quand le display fait moins de 800pt', () => {
  const d = { bounds: { x: 0, y: 0, width: 1280, height: 720 } };
  assertEq(islandLayout(d, null, 460).h, 720);
});
console.log('\nbannerPayload:');
test('customName prioritaire, puis projectName, puis fallback', () => {
  const s = { sessionId: 'x', projectName: 'proj', state: { name: 'waiting' } };
  assertEq(bannerPayload(s, 'mon-nom'), { sessionId: 'x', name: 'mon-nom', state: 'waiting' });
  assertEq(bannerPayload(s, null).name, 'proj');
  assertEq(bannerPayload({ sessionId: 'y', state: { name: 'pending' } }, null).name, 'Claude Code');
});
test('state extrait du nom d\'état ; null si absent', () => {
  assertEq(bannerPayload({ sessionId: 'z', projectName: 'p', state: { name: 'pending' } }, null).state, 'pending');
  assertEq(bannerPayload({ sessionId: 'z', projectName: 'p' }, null).state, null);
});

console.log('\nupdateNotice:');
test('sans info : version courante seule, pas de bannière', () => {
  const n = updateNotice({ current: '2.5.0' });
  assertEq([n.current, n.latest, n.showBanner, n.phase], ['2.5.0', null, false, null]);
});
test('maj dispo → bannière + clic actif', () => {
  const n = updateNotice({ current: '2.5.0', latest: '2.6.0', canInstall: true });
  assertEq([n.showBanner, n.canInstall, n.clickable], [true, true, true]);
});
test('écartée → plus de bannière, mais la version courante reste', () => {
  const n = updateNotice({ current: '2.5.0', latest: '2.6.0', canInstall: true, dismissed: true });
  assertEq([n.showBanner, n.latest], [false, '2.6.0']);
});
test('installation en cours : prime sur dismissed, clic neutralisé', () => {
  const n = updateNotice({
    current: '2.5.0', latest: '2.6.0', canInstall: true, dismissed: true,
    install: { phase: 'downloading', percent: 41.7 },
  });
  assertEq([n.showBanner, n.phase, n.percent, n.clickable], [true, 'downloading', 42, false]);
});
test('échec : la ligne redevient cliquable (réessayer)', () => {
  const n = updateNotice({ current: '2.5.0', latest: '2.6.0', canInstall: true, install: { phase: 'error' } });
  assertEq([n.showBanner, n.clickable], [true, true]);
});
test('pourcentage borné 0-100', () => {
  assertEq(updateNotice({ install: { phase: 'downloading', percent: -5 } }).percent, 0);
  assertEq(updateNotice({ install: { phase: 'downloading', percent: 180 } }).percent, 100);
});
test('sans DMG pour cette architecture : bannière informative, canInstall false', () => {
  const n = updateNotice({ current: '2.5.0', latest: '2.6.0', canInstall: false, url: 'https://x' });
  assertEq([n.showBanner, n.canInstall, n.url], [true, false, 'https://x']);
});

console.log('\nbuildIsland — tâches de fond:');
// Sous-ligne « en fond » sous la session : même gabarit que les agents /
// workflows (spinner + libellé). Le compte vient de serializeSession
// (bgTaskCount : JSONL, ou 1 si la présence CLI dit `shell`).
test('bgTaskCount transmis tel quel sur la rangée, 0 par défaut', () => {
  const m = buildIsland([sess('waiting', { bgTaskCount: 2 }), sess('waiting')], {});
  assertEq(m.rows.map((r) => r.bgTaskCount), [2, 0]);
});
test('bgTaskCount présent aussi sur les rangées headless', () => {
  const m = buildIsland([sess('waiting', { bg: true, bgTaskCount: 1 })], {});
  assertEq(m.backgroundRows[0].bgTaskCount, 1);
});
// Groupes par famille : serveur d'abord, puis tâches ; titres = descriptions.
test('bgGroups : serveur puis tâches, comptes et titres', () => {
  const bgTasks = [
    { id: 'a', kind: 'task', description: 'Build DMG', command: 'npm run build' },
    { id: 'b', kind: 'server', description: "Lancer l'app en mode dev", command: 'npm run dev' },
    { id: 'c', kind: 'task', description: '', command: 'npm test' },
  ];
  const m = buildIsland([sess('waiting', { bgTaskCount: 3, bgTasks })], {});
  assertEq(m.rows[0].bgGroups, [
    { kind: 'server', count: 1, title: "Lancer l'app en mode dev" },
    { kind: 'task', count: 2, title: 'Build DMG · npm test' },
  ]);
});
test('bgGroups : la veille a son groupe, entre le serveur et les tâches', () => {
  const bgTasks = [
    { id: 'a', kind: 'task', description: 'Build DMG', command: 'npm run build' },
    { id: 'b', kind: 'waiter', description: 'Attendre la fin du build', command: 'until [ -f x ]; do sleep 5; done' },
    { id: 'c', kind: 'server', description: 'Dev', command: 'npm run dev' },
  ];
  const m = buildIsland([sess('waiting', { bgTaskCount: 3, bgTasks })], {});
  assertEq(m.rows[0].bgGroups, [
    { kind: 'server', count: 1, title: 'Dev' },
    { kind: 'waiter', count: 1, title: 'Attendre la fin du build' },
    { kind: 'task', count: 1, title: 'Build DMG' },
  ]);
});
test('bgGroups : compte sans fiche (présence CLI seule) → une tâche anonyme', () => {
  const m = buildIsland([sess('waiting', { bgTaskCount: 1, bgTasks: [] })], {});
  assertEq(m.rows[0].bgGroups, [{ kind: 'task', count: 1, title: '' }]);
});
test('bgGroups : rien sans tâche', () => {
  assertEq(buildIsland([sess('waiting')], {}).rows[0].bgGroups, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
