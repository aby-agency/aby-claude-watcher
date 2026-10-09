// Nom court et groupe d'un projet, lus dans le registre du Cockpit (09/10/2026).
//
// Paul veut un seul nom par projet, identique sur le Stream Deck, l'app Hublot, les titres cmux et ici :
// le `short` du registre (11 caractères au plus). Le groupe « commercial » porte un marqueur (CSS), jamais
// dans le nom : « PEC » client et « PEC » commercial ont le même nom court.
//
// Même cascade que le Cockpit et le Hublot : `projects.local.json` (registre du poste) REMPLACE
// `projects.json` (registre partagé) quand il existe, il ne s'y ajoute pas. Le dossier du Cockpit :
// `$COCKPIT_DIR`, sinon `~/Aby/cockpit` (présent sur les deux postes), sinon `~/Project/aby/interne/cockpit`.
// Sans registre lisible, rien : le watcher garde le basename du dossier, comme avant.
//
// Le projet d'un dossier : le dossier exact, sinon le projet le plus profond qui le contient (une session
// qui a fait `cd src` reste dans son projet) ; un projet posé sur ~ ne vaut que pour ~ lui-même. Porté de
// `slugForCwd` (cockpit/src/registry.ts).
//
// Module pur côté Node (fs, path, os) : pas d'electron, pas de logger, testable seul.
const fs = require('fs');
const os = require('os');
const path = require('path');

const COMMERCIAL_GROUP = 'commercial';

function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

function cockpitDirs(home, env) {
  const dirs = [];
  if (env && env.COCKPIT_DIR) dirs.push(env.COCKPIT_DIR);
  dirs.push(path.join(home, 'Aby', 'cockpit'), path.join(home, 'Project', 'aby', 'interne', 'cockpit'));
  return dirs;
}

// Le fichier du registre à lire : le local d'abord, sinon le partagé, dans le premier dossier qui en a un.
function registryFile(home = os.homedir(), env = process.env, exists = fs.existsSync) {
  for (const dir of cockpitDirs(home, env)) {
    for (const name of ['projects.local.json', 'projects.json']) {
      const f = path.join(dir, name);
      if (exists(f)) return f;
    }
  }
  return null;
}

// Les projets du registre : slug, nom affiché (short, sinon name), groupe, dossier absolu.
function parseProjects(text, home = os.homedir()) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!data || !Array.isArray(data.projects)) return [];
  const out = [];
  for (const p of data.projects) {
    if (!p || typeof p.slug !== 'string' || typeof p.cwd !== 'string') continue;
    const short = typeof p.short === 'string' && p.short.trim() ? p.short.trim() : null;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.slug;
    out.push({
      slug: p.slug,
      name: short || name,
      group: typeof p.group === 'string' && p.group ? p.group : null,
      dir: norm(expandHome(p.cwd, home)),
    });
  }
  return out;
}

function projectForCwd(projects, cwd, home = os.homedir()) {
  if (!cwd) return null;
  const want = norm(cwd);
  const exact = projects.find((p) => p.dir === want);
  if (exact) return exact;
  const h = norm(home);
  const parents = projects.filter((p) => p.dir !== h && p.dir !== '/' && want.startsWith(`${p.dir}/`));
  return parents.sort((a, b) => b.dir.length - a.dir.length)[0] || null;
}

// Lecteur avec cache sur la date du fichier : le registre change rarement, un scan passe toutes les 2 s.
function createRegistryReader({ home = os.homedir(), env = process.env, fsImpl = fs } = {}) {
  let cache = { file: null, mtimeMs: -1, projects: [] };
  function projects() {
    const file = registryFile(home, env, (f) => fsImpl.existsSync(f));
    if (!file) { cache = { file: null, mtimeMs: -1, projects: [] }; return []; }
    let mtimeMs;
    try { mtimeMs = fsImpl.statSync(file).mtimeMs; } catch { return []; }
    if (cache.file !== file || cache.mtimeMs !== mtimeMs) {
      let text = '';
      try { text = fsImpl.readFileSync(file, 'utf-8'); } catch { text = ''; }
      cache = { file, mtimeMs, projects: parseProjects(text, home) };
    }
    return cache.projects;
  }
  return {
    projects,
    // { name, group, slug } du projet du dossier, ou null hors registre.
    identityForCwd(cwd) {
      const p = projectForCwd(projects(), cwd, home);
      return p ? { slug: p.slug, name: p.name, group: p.group } : null;
    },
  };
}

module.exports = { COMMERCIAL_GROUP, registryFile, parseProjects, projectForCwd, createRegistryReader };
