// electron-builder hook: runs after all DMG/ZIP artifacts are built.
// We use it to push hidden files (.background.tiff, .VolumeIcon.icns, etc.)
// off-screen in each DMG so they don't show up in the visible layout when
// the user toggles Cmd+Shift+. (show hidden files) in Finder.
//
// See build/push-hidden-offscreen.py for the heavy lifting.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  const paths = context.artifactPaths || [];
  const dmgs = paths.filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) return [];

  const script = path.join(__dirname, 'push-hidden-offscreen.py');
  for (const dmg of dmgs) {
    console.log(`  • patching .DS_Store: ${path.basename(dmg)}`);
    execFileSync('python3', [script, dmg], { stdio: 'inherit' });
  }
  return [];
};
