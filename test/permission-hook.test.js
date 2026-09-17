// Tests du hook bin/aby-permission-hook.sh — le script réel, lancé pour de vrai,
// avec le payload EXACT documenté par Claude Code (docs hooks, PermissionRequest).
// Les deux moteurs sont couverts : jq, et le repli python3 qui ne tourne jamais
// sur la machine de dev mais reste du code de production.
// Run via `node test/permission-hook.test.js`.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'bin', 'aby-permission-hook.sh');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what || ''} attendu ${JSON.stringify(expected)}, reçu ${JSON.stringify(actual)}`);
}

// Lance le hook avec un payload sur stdin et rend le message reçu sur le socket.
// `engine` = 'jq' (PATH normal) ou 'python3' (PATH sans jq, pour forcer le repli).
function runHook(payload, engine = 'jq') {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aby-hook-test-'));
    const sock = path.join(dir, 's.sock');
    const done = (fn) => { try { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch {} fn(); };
    const timer = setTimeout(() => done(() => reject(new Error('aucun message reçu en 5 s'))), 5000);

    const server = net.createServer((conn) => {
      let buf = '';
      conn.on('data', (d) => { buf += d; });
      conn.on('end', () => { clearTimeout(timer); done(() => resolve(buf.trim())); });
    });

    server.listen(sock, () => {
      const env = { ...process.env, ABY_WATCHER_SOCKET: sock };
      if (engine === 'python3') {
        // PATH réduit à un dossier qui contient python3 et nc mais pas jq.
        const bin = path.join(dir, 'bin');
        fs.mkdirSync(bin);
        for (const cmd of ['python3', 'nc', 'cat', 'command']) {
          const real = requireWhich(cmd);
          if (real) { try { fs.symlinkSync(real, path.join(bin, cmd)); } catch {} }
        }
        env.PATH = bin;
      }
      const p = spawn('/bin/bash', [HOOK], { env, stdio: ['pipe', 'ignore', 'ignore'] });
      p.on('error', (e) => { clearTimeout(timer); done(() => reject(e)); });
      p.stdin.end(JSON.stringify(payload));
    });
  });
}

function requireWhich(cmd) {
  const dirs = (process.env.PATH || '').split(':');
  for (const d of dirs) {
    const p = path.join(d, cmd);
    try { if (fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}

// Payload officiel, copié de la doc Claude Code (section PermissionRequest input).
const DOC_PAYLOAD = {
  session_id: 'abc123',
  transcript_path: '/Users/x/.claude/projects/y/00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl',
  cwd: '/Users/x',
  permission_mode: 'default',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf node_modules', description: 'Remove node_modules directory' },
  permission_suggestions: [],
};

for (const engine of ['jq', 'python3']) {
  test(`[${engine}] le payload de la doc donne la description, pas la commande`, async () => {
    const msg = JSON.parse(await runHook(DOC_PAYLOAD, engine));
    eq(msg.action, 'permission-pending', 'action');
    eq(msg.sessionId, 'abc123', 'sessionId');
    eq(msg.hookEvent, 'PermissionRequest', 'hookEvent');
    eq(msg.toolName, 'Bash', 'toolName');
    eq(msg.toolTarget, 'Remove node_modules directory', 'toolTarget');
  });

  test(`[${engine}] sans description, la commande fait la cible`, async () => {
    const p = { ...DOC_PAYLOAD, tool_input: { command: 'npm run build' } };
    eq(JSON.parse(await runHook(p, engine)).toolTarget, 'npm run build', 'toolTarget');
  });

  test(`[${engine}] Edit → le fichier visé`, async () => {
    const p = { ...DOC_PAYLOAD, tool_name: 'Edit', tool_input: { file_path: '/tmp/watcher.js', old_string: 'a', new_string: 'b' } };
    const msg = JSON.parse(await runHook(p, engine));
    eq(msg.toolName, 'Edit', 'toolName');
    eq(msg.toolTarget, '/tmp/watcher.js', 'toolTarget');
  });

  test(`[${engine}] AskUserQuestion → la question posée`, async () => {
    const p = { ...DOC_PAYLOAD, tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Quel périmètre ?', header: 'Périmètre' }] } };
    eq(JSON.parse(await runHook(p, engine)).toolTarget, 'Quel périmètre ?', 'toolTarget');
  });

  test(`[${engine}] un guillemet dans le nom d'outil ne casse pas le message`, async () => {
    const p = { ...DOC_PAYLOAD, tool_name: 'Weird"Tool', tool_input: { description: 'a "quoted" value' } };
    const msg = JSON.parse(await runHook(p, engine)); // doit parser sans throw
    eq(msg.toolName, 'Weird"Tool', 'toolName');
    eq(msg.toolTarget, 'a "quoted" value', 'toolTarget');
  });

  test(`[${engine}] une Notification idle reste sans cible`, async () => {
    const p = { session_id: 'abc123', hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' };
    const msg = JSON.parse(await runHook(p, engine));
    eq(msg.idle, true, 'idle');
    eq(msg.toolTarget, '', 'toolTarget');
  });

  test(`[${engine}] une cible démesurée est bornée avant l'envoi`, async () => {
    const p = { ...DOC_PAYLOAD, tool_name: 'Write', tool_input: { file_path: '/tmp/f', content: 'z'.repeat(300000) } };
    const msg = JSON.parse(await runHook(p, engine));
    if (msg.toolTarget.length > 200) throw new Error(`cible non bornée : ${msg.toolTarget.length}`);
  });
}

(async () => {
  console.log('\nbin/aby-permission-hook.sh:');
  for (const { name, fn } of queue) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
