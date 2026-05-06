// Updater — checks GitHub Releases, then downloads + installs the DMG itself.
//
// Why custom (not electron-updater):
//   - The app is ad-hoc signed (no Apple Developer ID). electron-updater's
//     Squirrel.Mac flow rejects ad-hoc signatures with "could not get code
//     signature for running application". A custom installer based on
//     hdiutil + cp + open works regardless of signing identity.
//
// Flow:
//   1. checkForUpdates() hits the GitHub API, returns metadata + the DMG
//      asset URL matching the running architecture (arm64/x64).
//   2. downloadAndInstall() streams the DMG to temp with progress callbacks.
//   3. On completion, writes a detached shell script that waits for our PID
//      to exit, mounts the DMG, replaces the .app under /Applications (or
//      wherever the running .app lives), removes quarantine, and relaunches.
//   4. app.quit() — the script takes over.

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

const GITHUB_OWNER = 'aby-agency';
const GITHUB_REPO = 'aby-claude-watcher';
const WEBSITE_URL = 'https://aby-agency.fr';

const CHECK_INTERVAL = 60 * 60 * 1000;
let lastCheck = 0;

function parseVersion(v) {
  if (!v) return [0, 0, 0];
  return String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

function pickDmgAsset(assets, arch) {
  if (!Array.isArray(assets)) return null;
  // electron-builder names: "Aby Claude Watcher-1.5.3-arm64.dmg" / "...-x64.dmg"
  const tag = `-${arch}.dmg`;
  return assets.find(a => a && typeof a.name === 'string' && a.name.endsWith(tag)) || null;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      headers: {
        'User-Agent': 'Aby-Claude-Watcher-Updater',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 10000,
    };
    const req = https.get(options, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const asset = pickDmgAsset(data.assets, process.arch);
          resolve({
            version: (data.tag_name || '').replace(/^v/, ''),
            url: data.html_url,
            body: data.body || '',
            publishedAt: data.published_at,
            dmgUrl: asset ? asset.browser_download_url : null,
            dmgName: asset ? asset.name : null,
            dmgSize: asset ? asset.size : null,
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function checkForUpdates(force = false) {
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_INTERVAL) {
    return { status: 'rate-limited', lastCheck };
  }
  lastCheck = now;

  const current = app.getVersion();
  try {
    const latest = await fetchLatestRelease();
    if (!latest || !latest.version) {
      return { status: 'no-releases', current, lastCheck };
    }
    if (isNewer(latest.version, current)) {
      return {
        status: 'update-available',
        current,
        latest: latest.version,
        url: latest.url,
        body: latest.body,
        dmgUrl: latest.dmgUrl,
        dmgName: latest.dmgName,
        dmgSize: latest.dmgSize,
        canAutoInstall: !!latest.dmgUrl,
        lastCheck,
      };
    }
    return { status: 'up-to-date', current, latest: latest.version, lastCheck };
  } catch (e) {
    return { status: 'error', error: e.message, lastCheck };
  }
}

// ─── download + install ───────────────────────────────────────────────────

let activeDownload = null; // { req, dest, abort }

function downloadDmg(dmgUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let aborted = false;
    let receivedFromHistory = 0;

    const cleanup = (err) => {
      activeDownload = null;
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    };

    const open = (url, redirectsLeft = 5) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'Aby-Claude-Watcher-Updater' },
        timeout: 30000,
      }, (res) => {
        // GitHub sends a 302 to S3 — follow redirects.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return cleanup(new Error('too many redirects'));
          res.resume();
          open(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          return cleanup(new Error(`download failed: HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = receivedFromHistory;
        const out = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total) {
            onProgress({ received, total, percent: Math.min(100, (received / total) * 100) });
          }
        });
        res.on('error', cleanup);
        out.on('error', cleanup);
        out.on('finish', () => {
          activeDownload = null;
          out.close(() => resolve(destPath));
        });
        res.pipe(out);
      });
      req.on('error', (e) => { if (!aborted) cleanup(e); });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });

      activeDownload = {
        req,
        dest: destPath,
        abort: () => {
          aborted = true;
          req.destroy(new Error('aborted'));
          try { fs.unlinkSync(destPath); } catch {}
        },
      };
    };

    open(dmgUrl);
  });
}

function shellEscape(s) {
  // single-quote escaping for bash
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function getRunningAppPath() {
  // process.execPath is like /Applications/Aby Claude Watcher.app/Contents/MacOS/Aby Claude Watcher
  // We want /Applications/Aby Claude Watcher.app
  const exe = process.execPath;
  const macOSDir = path.dirname(exe);          // .../Contents/MacOS
  const contents = path.dirname(macOSDir);     // .../Contents
  const appBundle = path.dirname(contents);    // .../Aby Claude Watcher.app
  return appBundle;
}

function buildInstallScript({ pid, dmgPath, installPath, logPath }) {
  // Detached bash script. Stays alive after the parent quits.
  // Uses set -u carefully and captures everything to a log for post-mortem.
  return `#!/bin/bash
exec >>${shellEscape(logPath)} 2>&1
echo "[$(date)] installer starting (pid=$$, target pid=${pid})"

APP_PID=${pid}
DMG=${shellEscape(dmgPath)}
INSTALL_PATH=${shellEscape(installPath)}

# 1. Wait for the app to exit (max 30s).
for i in $(seq 1 30); do
  kill -0 "$APP_PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "app did not exit in 30s, forcing"
  kill -TERM "$APP_PID" 2>/dev/null || true
  sleep 2
fi

# 2. Mount the DMG.
MOUNT_OUT=$(hdiutil attach -nobrowse -readonly "$DMG" 2>&1)
echo "$MOUNT_OUT"
MOUNT_POINT=$(echo "$MOUNT_OUT" | grep -E "/Volumes/" | tail -1 | awk '{ for (i=3; i<=NF; i++) printf "%s%s", $i, (i==NF?"":" ") }')
if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
  echo "failed to mount DMG"
  exit 1
fi
SRC_APP="$MOUNT_POINT/Aby Claude Watcher.app"
if [ ! -d "$SRC_APP" ]; then
  echo "app not found inside DMG at $SRC_APP"
  hdiutil detach "$MOUNT_POINT" -force 2>/dev/null
  exit 1
fi

# 3. Replace.
rm -rf "$INSTALL_PATH"
cp -R "$SRC_APP" "$INSTALL_PATH"
xattr -dr com.apple.quarantine "$INSTALL_PATH" 2>/dev/null || true

# 4. Unmount + cleanup.
hdiutil detach "$MOUNT_POINT" -force 2>/dev/null
rm -f "$DMG"

# 5. Relaunch.
open "$INSTALL_PATH"

echo "[$(date)] installer done"
`;
}

async function downloadAndInstall(release, onProgress) {
  if (!release || !release.dmgUrl) {
    throw new Error('no DMG asset for this architecture');
  }

  const tmpDir = app.getPath('temp');
  const dmgName = release.dmgName || `aby-claude-watcher-${release.latest}-${process.arch}.dmg`;
  const dmgPath = path.join(tmpDir, dmgName);

  await downloadDmg(release.dmgUrl, dmgPath, onProgress);

  const installPath = getRunningAppPath();
  const scriptPath = path.join(tmpDir, `aby-claude-watcher-install-${process.pid}.sh`);
  const logPath = path.join(tmpDir, `aby-claude-watcher-install-${process.pid}.log`);

  fs.writeFileSync(
    scriptPath,
    buildInstallScript({ pid: process.pid, dmgPath, installPath, logPath }),
    { mode: 0o755 }
  );

  // Detached so it survives our quit. Stdio fully detached (ignore + unref).
  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Give the script a beat to start, then quit.
  setTimeout(() => {
    try { app.quit(); } catch {}
  }, 500);

  return { scriptPath, logPath, dmgPath, installPath };
}

function abortActiveDownload() {
  if (activeDownload && typeof activeDownload.abort === 'function') {
    activeDownload.abort();
    return true;
  }
  return false;
}

module.exports = {
  checkForUpdates,
  downloadAndInstall,
  abortActiveDownload,
  GITHUB_OWNER,
  GITHUB_REPO,
  WEBSITE_URL,
};
