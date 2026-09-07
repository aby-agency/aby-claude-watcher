// Tests for bg-task.js — classification d'une commande Bash de fond :
// serveur (tourne sans fin, ne « bosse » pas) vs tâche (finira).
// Run via `node test/bg-task.test.js`.
const assert = require('assert');
const { classifyBgCommand, bgTaskOpening, hasLiveBgTask } = require('../bg-task');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\nclassifyBgCommand:');
const servers = [
  'npm run dev',
  'npm run dev > /tmp/out.log 2>&1',
  'cd /x && npm start',
  'pnpm dev --port 3001',
  'yarn serve',
  'npx vite',
  'npx next dev',
  'npx electron . --dev --remote-debugging-port=9333',
  'python -m http.server 8080',
  'uvicorn app:main --reload',
  'flask run',
  'rails s',
  'docker compose up',
  'docker-compose up -d',
  'tail -f /var/log/app.log',
  'ngrok http 3000',
  'node server.js',
  'php -S localhost:8000',
  'godot --editor',
  'cargo watch -x run',
  'nodemon index.js',
  'watchexec -e rs cargo test',
];
const tasks = [
  'npm test',
  'npm run build',
  'npx electron-builder --mac',
  'cargo build --release',
  'pytest -q',
  'git clone https://x/y.git',
  'curl -sL https://x -o f',
  'sleep 30 && echo done',
  'python train.py --epochs 3',
  'make',
  'brew install foo',
  'until grep -q Ready dev.log; do sleep 0.5; done',
];
test('commandes serveur → server', () => {
  for (const c of servers) assert.strictEqual(classifyBgCommand(c), 'server', c);
});
test('commandes finies → task', () => {
  for (const c of tasks) assert.strictEqual(classifyBgCommand(c), 'task', c);
});
test('entrée vide ou non string → task (dégradation : le chip générique)', () => {
  assert.strictEqual(classifyBgCommand(''), 'task');
  assert.strictEqual(classifyBgCommand(null), 'task');
  assert.strictEqual(classifyBgCommand(42), 'task');
});
test('« dev » dans un chemin ne suffit pas (npm test dans ~/dev/x)', () => {
  assert.strictEqual(classifyBgCommand('cd /Users/paul/dev/x && npm test'), 'task');
});
test('« watch » d\'un test runner = serveur au sens « tourne sans fin »', () => {
  assert.strictEqual(classifyBgCommand('npx vitest --watch'), 'server');
});

console.log('\nbgTaskOpening:');
test('event user avec backgroundTaskId → id, toolUseId, at, deliberate', () => {
  const ev = {
    type: 'user', timestamp: '2026-09-07T08:47:05.624Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Command running in background with ID: b1' }] },
    toolUseResult: { backgroundTaskId: 'b1' },
  };
  assert.deepStrictEqual(bgTaskOpening(ev), { id: 'b1', toolUseId: 'toolu_1', at: Date.parse('2026-09-07T08:47:05.624Z'), deliberate: true });
});
test('parquée après timeout → deliberate false', () => {
  const ev = {
    type: 'user', timestamp: '2026-09-07T07:21:23.387Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2' }] },
    toolUseResult: { backgroundTaskId: 'b2', timedOutAfterMs: 120000 },
  };
  assert.strictEqual(bgTaskOpening(ev).deliberate, false);
});
test('sans backgroundTaskId → null ; sans tool_use_id → toolUseId null, at null sans timestamp', () => {
  assert.strictEqual(bgTaskOpening({ type: 'user', toolUseResult: {} }), null);
  assert.strictEqual(bgTaskOpening({ type: 'assistant', toolUseResult: { backgroundTaskId: 'x' } }), null);
  const o = bgTaskOpening({ type: 'user', message: { content: 'texte' }, toolUseResult: { backgroundTaskId: 'b3' } });
  assert.deepStrictEqual(o, { id: 'b3', toolUseId: null, at: null, deliberate: true });
});

console.log('\nhasLiveBgTask:');
test('tâche reconnue (fiche) → délégation', () => {
  assert.strictEqual(hasLiveBgTask([{ kind: 'task', known: true }]), true);
  assert.strictEqual(hasLiveBgTask([{ kind: 'server', known: true }, { kind: 'task', known: true }]), true);
});
test('serveur seul → pas de délégation (la conversation est libre)', () => {
  assert.strictEqual(hasLiveBgTask([{ kind: 'server', known: true }]), false);
});
test('tâche sans fiche (anonyme) → pas de délégation, on ne prétend rien', () => {
  assert.strictEqual(hasLiveBgTask([{ kind: 'task', known: false }]), false);
});
test('liste vide / non liste → false', () => {
  assert.strictEqual(hasLiveBgTask([]), false);
  assert.strictEqual(hasLiveBgTask(null), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
