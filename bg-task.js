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

// Découpe une ligne shell en segments de commande et retire les `cd …` de tête.
function commandSegments(command) {
  return String(command)
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((s) => s.trim().replace(/^(sudo\s+|env\s+\S+=\S+\s+)+/, ''))
    .filter((s) => s && !/^cd\s/.test(s) && !/^(export|set|source)\s/.test(s));
}

// 'server' = tourne sans fin (site, watcher, tunnel…) ; 'task' = finira.
function classifyBgCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'task';
  for (const seg of commandSegments(command)) {
    if (SERVER_PATTERNS.some((re) => re.test(seg))) return 'server';
  }
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

module.exports = { classifyBgCommand, bgTaskOpening, SERVER_PATTERNS };
