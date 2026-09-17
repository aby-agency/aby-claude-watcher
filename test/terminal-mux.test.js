// Tests for terminal-mux.js — pure helpers behind the cmux / tmux focus paths.
// Run: node test/terminal-mux.test.js

const {
  parseProcessEnv,
  tmuxTargetFromEnv,
  cmuxSurfaceFromEnv,
  isCmuxEnv,
  cmuxSurfaceForSession,
  parseTmuxClients,
  cmuxSurfaceForPid,
  tmuxAttachCommand,
  isCmuxProcess,
  sessionInCmux,
} = require('../terminal-mux.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assertEq(a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`expected ${jb}, got ${ja}`);
}

// Real `ps eww -o command= -p <pid>` shape: the command line, then KEY=value
// tokens separated by single spaces. Values may themselves contain spaces.
const PS_CMUX = '/Users/me/.local/bin/claude --dangerously-skip-permissions --mcp-config={"mcpServers":{"x":{"env":{"A":"1"}}}} '
  + 'CMUX_BUNDLED_CLI_PATH=/Applications/cmux.app/Contents/Resources/bin/cmux '
  + 'TERM_PROGRAM=ghostty CMUX_NO_PR_WATCH= '
  + 'CMUX_SURFACE_ID=E677B462-773C-42C2-836C-60D64FCFCBE1 '
  + 'CMUX_BUNDLE_ID=com.cmuxterm.app PWD=/Users/me/my project dir HOME=/Users/me\n';
const PS_TMUX = 'claude TERM_PROGRAM=tmux TERM_PROGRAM_VERSION=3.7c TMUX=/private/tmp/tmux-501/rc,10524,0 TMUX_PANE=%74\n';

console.log('\nparseProcessEnv:');
test('extracts KEY=value tokens after the command line', () => {
  const env = parseProcessEnv(PS_CMUX);
  assertEq(env.TERM_PROGRAM, 'ghostty');
  assertEq(env.CMUX_SURFACE_ID, 'E677B462-773C-42C2-836C-60D64FCFCBE1');
  assertEq(env.CMUX_BUNDLE_ID, 'com.cmuxterm.app');
});
test('ignores the command line even when it contains "="', () => {
  const env = parseProcessEnv(PS_CMUX);
  assertEq(env['--mcp-config'], undefined);
  assertEq(Object.keys(env).some(k => k.startsWith('-')), false);
});
test('keeps spaces inside a value (token without "=" joins the previous var)', () => {
  assertEq(parseProcessEnv(PS_CMUX).PWD, '/Users/me/my project dir');
});
test('empty value is kept as empty string', () => {
  assertEq(parseProcessEnv(PS_CMUX).CMUX_NO_PR_WATCH, '');
});
test('tolerates empty / null input', () => {
  assertEq(parseProcessEnv(''), {});
  assertEq(parseProcessEnv(null), {});
});

console.log('\ntmuxTargetFromEnv:');
test('parses socket path and pane id', () => {
  assertEq(tmuxTargetFromEnv(parseProcessEnv(PS_TMUX)), { socket: '/private/tmp/tmux-501/rc', pane: '%74' });
});
test('null without TMUX', () => assertEq(tmuxTargetFromEnv({ TERM_PROGRAM: 'ghostty' }), null));
test('null without TMUX_PANE', () => assertEq(tmuxTargetFromEnv({ TMUX: '/tmp/tmux-501/default,1,0' }), null));
test('rejects a relative or unsafe socket path', () => {
  assertEq(tmuxTargetFromEnv({ TMUX: 'tmp/sock,1,0', TMUX_PANE: '%1' }), null);
  assertEq(tmuxTargetFromEnv({ TMUX: '/tmp/s;rm -rf,1,0', TMUX_PANE: '%1' }), null);
});
test('rejects a malformed pane id', () => {
  assertEq(tmuxTargetFromEnv({ TMUX: '/tmp/sock,1,0', TMUX_PANE: '74' }), null);
  assertEq(tmuxTargetFromEnv({ TMUX: '/tmp/sock,1,0', TMUX_PANE: '%74; echo' }), null);
});

console.log('\ncmuxSurfaceFromEnv / isCmuxEnv:');
test('CMUX_SURFACE_ID wins', () => {
  assertEq(cmuxSurfaceFromEnv({ CMUX_SURFACE_ID: 'E677B462-773C-42C2-836C-60D64FCFCBE1', CMUX_PANEL_ID: 'AAAAAAAA-0000-0000-0000-000000000000' }), 'E677B462-773C-42C2-836C-60D64FCFCBE1');
});
test('falls back to CMUX_PANEL_ID (older cmux)', () => {
  assertEq(cmuxSurfaceFromEnv({ CMUX_PANEL_ID: '3F8042E7-AE64-47D4-B329-5C6ED73F1ECA' }), '3F8042E7-AE64-47D4-B329-5C6ED73F1ECA');
});
test('rejects a non-UUID value', () => {
  assertEq(cmuxSurfaceFromEnv({ CMUX_SURFACE_ID: 'surface:10' }), null);
  assertEq(cmuxSurfaceFromEnv({}), null);
});
test('isCmuxEnv: bundle id or surface id', () => {
  assertEq(isCmuxEnv({ CMUX_BUNDLE_ID: 'com.cmuxterm.app' }), true);
  assertEq(isCmuxEnv({ CMUX_PANEL_ID: '3F8042E7-AE64-47D4-B329-5C6ED73F1ECA' }), true);
  assertEq(isCmuxEnv({ TERM_PROGRAM: 'ghostty' }), false);
});

console.log('\nisCmuxProcess:');
test('matches the cmux main binary by comm or full path', () => {
  assertEq(isCmuxProcess('cmux', '/Applications/cmux.app/Contents/MacOS/cmux'), true);
  assertEq(isCmuxProcess('login', '/usr/bin/login -fp me'), false);
  assertEq(isCmuxProcess('cmux-cua', '/Applications/cmux.app/Contents/Resources/bin/cmux-cua mcp'), false);
});

console.log('\ncmuxSurfaceForSession:');
const STORE = {
  version: 1,
  sessions: {
    'd331faaf-9f78-4e05-b745-0b83daa677d1': { sessionId: 'd331faaf-9f78-4e05-b745-0b83daa677d1', surfaceId: '3F8042E7-AE64-47D4-B329-5C6ED73F1ECA', workspaceId: 'C25DAB63-88AD-4888-86B9-B5A5281C7BDF', pid: 49291 },
  },
  activeSessionsBySurface: {
    'E677B462-773C-42C2-836C-60D64FCFCBE1': { sessionId: 'e8b1a442-018c-44de-b774-a432766e86a6' },
  },
};
test('reads surface + workspace from sessions[sessionId]', () => {
  assertEq(cmuxSurfaceForSession(STORE, 'd331faaf-9f78-4e05-b745-0b83daa677d1'), { surfaceId: '3F8042E7-AE64-47D4-B329-5C6ED73F1ECA', workspaceId: 'C25DAB63-88AD-4888-86B9-B5A5281C7BDF' });
});
test('falls back to activeSessionsBySurface', () => {
  assertEq(cmuxSurfaceForSession(STORE, 'e8b1a442-018c-44de-b774-a432766e86a6'), { surfaceId: 'E677B462-773C-42C2-836C-60D64FCFCBE1', workspaceId: null });
});
test('null for unknown session or bad store', () => {
  assertEq(cmuxSurfaceForSession(STORE, 'nope'), null);
  assertEq(cmuxSurfaceForSession(null, 'x'), null);
  assertEq(cmuxSurfaceForSession({ sessions: { x: { surfaceId: 'not a uuid' } } }, 'x'), null);
});

console.log('\nparseTmuxClients:');
test('parses pid\\ttty lines', () => {
  assertEq(parseTmuxClients('91533\t/dev/ttys005\n12\t/dev/ttys001\n'), [{ pid: 91533, tty: '/dev/ttys005' }, { pid: 12, tty: '/dev/ttys001' }]);
});
test('empty output → []', () => assertEq(parseTmuxClients(''), []));
test('skips garbage lines', () => assertEq(parseTmuxClients('abc\tdef\n\n42\t/dev/ttys002'), [{ pid: 42, tty: '/dev/ttys002' }]));

console.log('\ncmuxSurfaceForPid:');
// Real shape of `cmux top --all --processes --format tsv`: cpu, mem, count, kind, id, parent, name.
const TOP = [
  '13.4\t1\t39\ttotal\ttotal\t\t',
  '4.3\t1\t1\tprocess\t47389\twindow:1\tcmux',
  '0.6\t1\t13\tworkspace\tworkspace:5\twindow:1\tABY Landing',
  '0.6\t1\t11\ttag\tworkspace:C25DAB63:tag:claude_code\tworkspace:5\tIdle',
  '0.2\t1\t1\tprocess\t49291\tworkspace:C25DAB63:tag:claude_code\t2.1.272',
  '0.0\t1\t1\tprocess\t49521\t49291\tnode',
  '0.6\t1\t12\tpane\tpane:6\tworkspace:5\t',
  '0.6\t1\t12\tsurface\tsurface:6\tpane:6\tClaude',
  '0.2\t1\t1\tprocess\t49291\tsurface:6\t2.1.272',
  '0.0\t1\t1\tprocess\t49521\t49291\tnode',
  '0.0\t1\t1\tprocess\t91533\t49521\ttmux',
  '0.0\t1\t1\tprocess\t49266\tsurface:6\tgitstatusd-darw',
].join('\n') + '\n';
test('direct child of a surface', () => assertEq(cmuxSurfaceForPid(TOP, 49291), 'surface:6'));
test('climbs pid parents up to the surface', () => assertEq(cmuxSurfaceForPid(TOP, 91533), 'surface:6'));
test('unknown pid → null', () => assertEq(cmuxSurfaceForPid(TOP, 1), null));
test('window-level process (no surface) → null', () => assertEq(cmuxSurfaceForPid(TOP, 47389), null));
test('cycle-safe', () => {
  const loop = '0\t1\t1\tprocess\t10\t11\ta\n0\t1\t1\tprocess\t11\t10\tb\n';
  assertEq(cmuxSurfaceForPid(loop, 10), null);
});

console.log('\ntmuxAttachCommand:');
test('quotes the socket and targets the session', () => {
  assertEq(tmuxAttachCommand('/private/tmp/tmux-501/rc', 'claude'), "tmux -S '/private/tmp/tmux-501/rc' attach -t '=claude'");
});
test('control mode flag for iTerm2', () => {
  assertEq(tmuxAttachCommand('/private/tmp/tmux-501/rc', 'claude', { controlMode: true }), "tmux -S '/private/tmp/tmux-501/rc' -CC attach -t '=claude'");
});
test('rejects a session name with shell metacharacters', () => {
  assertEq(tmuxAttachCommand('/tmp/s', 'a;b'), null);
  assertEq(tmuxAttachCommand('/tmp/s', ''), null);
});



// ---------------------------------------------------------------------------
// sessionInCmux — « cockpit voit-il cette session ? ». Sert au réglage
// anti-doublon de notif : cockpit ne couvre QUE ce qui tourne dans cmux.
const SURF = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const alive = () => true;
const dead = () => false;

console.log('\nsessionInCmux:');

test('une session du store, process vivant → couverte', () => {
  const store = { sessions: { s1: { surfaceId: SURF, pid: 4242 } } };
  assertEq(sessionInCmux(store, 's1', alive), true);
});

test('une session absente du store → pas couverte', () => {
  const store = { sessions: { s1: { surfaceId: SURF, pid: 4242 } } };
  assertEq(sessionInCmux(store, 'autre', alive), false);
});

test('entrée fantôme (process mort) → pas couverte', () => {
  // cmux quitté sans SessionEnd laisse l'entrée figée (leur LRN-016) : sans ce
  // filtre, un id recyclé ferait taire une session qui n'est plus dans cmux.
  const store = { sessions: { s1: { surfaceId: SURF, pid: 4242 } } };
  assertEq(sessionInCmux(store, 's1', dead), false);
});

test('entrée sans pid → couverte (on ne peut pas prouver la mort)', () => {
  const store = { sessions: { s1: { surfaceId: SURF } } };
  assertEq(sessionInCmux(store, 's1', dead), true);
});

test('surface trouvée via activeSessionsBySurface', () => {
  const store = { activeSessionsBySurface: { [SURF]: { sessionId: 's9' } } };
  assertEq(sessionInCmux(store, 's9', alive), true);
});

test('store absent ou illisible → pas couverte (jamais de mute sans preuve)', () => {
  assertEq(sessionInCmux(null, 's1', alive), false);
  assertEq(sessionInCmux({}, 's1', alive), false);
  assertEq(sessionInCmux({ sessions: {} }, '', alive), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
