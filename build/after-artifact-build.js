// electron-builder hook: runs after all DMG/ZIP artifacts are built.
// We use it to push hidden files (.background.tiff, .VolumeIcon.icns, etc.)
// off-screen in each DMG so they don't show up in the visible layout when
// the user toggles Cmd+Shift+. (show hidden files) in Finder.
//
// See build/push-hidden-offscreen.py for the heavy lifting.

const { execFileSync } = require('child_process');
const path = require('path');

// PIÈGE : `python3` du PATH n'est pas forcément celui qui a `ds_store`. Un
// upgrade Homebrew suffit à casser le build — vu le 2026-07-25, python@3.14
// avec un pyexpat lié à un expat plus récent que celui du système : tout
// import échoue, pip inclus, alors que /usr/bin/python3 marche. On choisit
// donc l'interpréteur sur son aptitude réelle à importer ds_store, pas sur
// l'ordre du PATH.
function pickPython() {
  const candidates = ['python3', '/usr/bin/python3'];
  for (const py of candidates) {
    try {
      execFileSync(py, ['-c', 'import ds_store'], { stdio: 'ignore' });
      return py;
    } catch (e) {
      // interpréteur absent, cassé, ou sans ds_store → suivant
    }
  }
  return null;
}

exports.default = async function (context) {
  const paths = context.artifactPaths || [];
  const dmgs = paths.filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) return [];

  const python = pickPython();
  if (!python) {
    throw new Error(
      'aucun python3 avec le module ds_store (essayés : python3, /usr/bin/python3) — ' +
      'installez-le avec `/usr/bin/pip3 install --user ds_store`'
    );
  }

  const script = path.join(__dirname, 'push-hidden-offscreen.py');
  for (const dmg of dmgs) {
    console.log(`  • patching .DS_Store: ${path.basename(dmg)} (${python})`);
    execFileSync(python, [script, dmg], { stdio: 'inherit' });
  }
  return [];
};
