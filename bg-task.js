// bg-task.js — Tâches Bash de fond : ouverture (event JSONL) et classification.
//
// Deux sessions avec un chip « en fond » se ressemblent, et pourtant l'une fait
// tourner un site (serveur dev, volontairement laissé en vie) et l'autre attend
// la fin d'un build (retour Paul 2026-09-07). Le JSONL nous donne de quoi les
// distinguer : la commande (dans le `tool_use` Bash) et, à l'ouverture, si la
// tâche a été backgroundée exprès (`run_in_background`) ou parquée après un
// timeout. Heuristique volontairement simple : une liste de motifs « ça tourne
// sans fin » ; tout le reste est une tâche qui finira. Une mauvaise étiquette
// coûte une icône — le tooltip (description + commande) reste la vérité.
//
// TROISIÈME famille depuis le 2026-09-07 (aby-landing) : la VEILLE. Une boucle
// `until [ -f x ]; do sleep 5; done` tourne vraiment — un process vit, 0 % CPU —
// mais elle ne produit rien : elle attend qu'autre chose arrive. Tant que cette
// autre chose est elle-même une tâche ouverte, c'est ELLE qui porte la
// délégation ; quand elle est finie (chez Paul : un build Next en erreur 40 min
// plus tôt, dont le veilleur attendait un format de sortie qui n'arriverait
// jamais), il ne reste qu'une garde perpétuelle, et la session attend
// l'utilisateur — pas son veilleur. Ni « Délégation », ni mute des notifs.
// Module PUR, sans effet, testé (test/bg-task.test.js).

// Motifs testés sur la PREMIÈRE commande utile de chaque segment (après `cd …
// &&`, `;`, `||`) — « dev » dans un chemin ne doit pas suffire.
const SERVER_PATTERNS = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview|watch)\b/,
  // (?![\w-]) et non \b : `electron-builder --mac` est un build, pas l'app.
  /^(npx|pnpm|yarn|bunx?)\s+(vite|next|nuxt|astro|remix|expo|webpack(-dev-server)?|parcel|serve|http-server|live-server|nodemon|ts-node-dev|tsx watch|electron)(?![\w-])/,
  /^(vite|next|nuxt|astro|webpack-dev-server|nodemon|electron|serve|http-server|live-server|browser-sync)(?![\w-])/,
  /^node\s+\S*(server|serve|app|index|dev)\S*\.[cm]?js\b/,
  /^python3?\s+-m\s+(http\.server|flask|uvicorn|gunicorn|django)\b/,
  /^(uvicorn|gunicorn|hypercorn|flask\s+run|django-admin\s+runserver|manage\.py\s+runserver)\b/,
  /^(rails|bin\/rails)\s+s(erver)?\b/,
  /^php\s+(-S|artisan\s+serve)\b/,
  /^(docker|docker-compose|podman)(\s+compose)?\s+up\b/,
  /^tail\s+(-[a-zA-Z]*[fF]\S*|--follow)\b/,
  /^(ngrok|cloudflared|localtunnel|lt)\b/,
  /^(godot|love|blender)\b/,
  /^(cargo\s+watch|watchexec|entr|fswatch|chokidar|nodemon)\b/,
  /--(watch|reload|hot|serve)\b/,
  /(^|\s)-w(\s|$)/,
];

// Motifs « veille » : la commande ne produit rien, elle attend qu'autre chose
// arrive. Deux formes — une boucle `until`/`while` dont le corps dort, et les
// utilitaires d'attente dédiés. `for` n'en est pas une (il itère du travail) et
// un `while read` sans `sleep` non plus.
const WAIT_LOOP = /\b(?:until|while)\b[\s\S]*?;\s*do\b[\s\S]*?\bsleep\b[\s\S]*?\bdone\b/g;
const WAIT_CMDS = [
  /^(npx\s+|pnpm\s+dlx\s+|bunx\s+)?wait-on\b/,
  /^(\.\/|bash\s+|sh\s+)?wait-for-it(\.sh)?\b/,
  /^(npx\s+)?wait-port\b/,
  /^dockerize\s+-wait\b/,
];
// Segments sans effet propre : ils accompagnent une veille (récupérer la sortie
// une fois l'attente finie) sans en faire du travail.
const HARMLESS = /^(cat|echo|printf|ls|pwd|date|true|:|wc|head|sleep)\b/;

// Découpe une ligne shell en segments de commande et retire les `cd …` de tête.
function commandSegments(command) {
  return String(command)
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((s) => s.trim().replace(/^(sudo\s+|env\s+\S+=\S+\s+)+/, ''))
    .filter((s) => s && !/^cd\s/.test(s) && !/^(export|set|source)\s/.test(s));
}

// 'server' = tourne sans fin (site, watcher, tunnel…) ; 'waiter' = ça attend
// sans rien produire ; 'task' = ça travaille et ça finira.
function classifyBgCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'task';
  const segments = commandSegments(command);
  for (const seg of segments) {
    if (SERVER_PATTERNS.some((re) => re.test(seg))) return 'server';
  }
  // Veille : on retire les boucles d'attente de la ligne, puis on regarde ce
  // qui reste. Rien d'utile → la commande n'est QUE de l'attente. Sinon c'est
  // une tâche qui attend un moment (`npm run build && until …`), et le travail
  // qu'elle porte prime.
  const stripped = String(command).replace(WAIT_LOOP, ' ; ');
  const hadLoop = stripped !== String(command);
  const rest = commandSegments(stripped)
    .filter((seg) => seg !== 'done' && !HARMLESS.test(seg) && !WAIT_CMDS.some((re) => re.test(seg)));
  const hadWaitCmd = segments.some((seg) => WAIT_CMDS.some((re) => re.test(seg)));
  if ((hadLoop || hadWaitCmd) && !rest.length) return 'waiter';
  return 'task';
}

// Event `user` d'ouverture d'une tâche de fond → { id, toolUseId, at, deliberate }
// ou null. `toolUseId` relie au `tool_use` Bash (description + commande) ;
// `deliberate` = backgroundée exprès (pas de `timedOutAfterMs`).
function bgTaskOpening(event) {
  if (!event || event.type !== 'user') return null;
  const r = event.toolUseResult;
  const id = r && r.backgroundTaskId;
  if (typeof id !== 'string' || !id) return null;
  const content = event.message && event.message.content;
  const result = Array.isArray(content) ? content.find((c) => c && c.type === 'tool_result') : null;
  const at = event.timestamp ? Date.parse(event.timestamp) : NaN;
  return {
    id,
    toolUseId: result && typeof result.tool_use_id === 'string' ? result.tool_use_id : null,
    at: Number.isFinite(at) ? at : null,
    deliberate: typeof r.timedOutAfterMs !== 'number',
  };
}

// Un tour fini pendant qu'une TÂCHE de fond (build, tests…) tourne encore n'est
// pas de l'inactivité : elle réveillera la session → « Délégation », comme les
// agents (décision Paul 2026-09-07, révise l'arbitrage v2.8.0 pris quand on ne
// savait pas distinguer un build d'un serveur). Un SERVEUR ne compte pas (la
// conversation est vraiment libre), un VEILLEUR non plus (il attend, il ne
// travaille pas), et une tâche SANS fiche non plus : sans preuve, on ne prétend
// pas « ça tourne sans toi » — c'est le mensonge de l'ex-état `job` (un serveur
// ne « complète » jamais) qu'on ne ressuscite pas.
function hasLiveBgTask(details) {
  return Array.isArray(details) && details.some((b) => b && b.known === true && b.kind === 'task');
}

module.exports = { classifyBgCommand, bgTaskOpening, hasLiveBgTask, SERVER_PATTERNS };
