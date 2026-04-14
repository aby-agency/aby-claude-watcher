// Updater — Level 2: GitHub Releases API check, manual download
//
// Queries GitHub Releases for the latest version, compares with the app's
// current version, and notifies the renderer when an update is available.
// The user clicks a link to download the new .dmg manually.
//
// Rate-limited to one check per hour unless explicitly triggered.

const https = require('https');
const { app } = require('electron');

// Configure these for your repo — update when you publish to GitHub
const GITHUB_OWNER = 'invictorius';
const GITHUB_REPO = 'claude-watch';

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
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

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      headers: {
        'User-Agent': 'Claude-Watch-Updater',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 10000,
    };

    const req = https.get(options, (res) => {
      if (res.statusCode === 404) {
        resolve(null); // No releases yet
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            version: (data.tag_name || '').replace(/^v/, ''),
            url: data.html_url,
            body: data.body || '',
            publishedAt: data.published_at,
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
        lastCheck,
      };
    }
    return { status: 'up-to-date', current, latest: latest.version, lastCheck };
  } catch (e) {
    return { status: 'error', error: e.message, lastCheck };
  }
}

module.exports = { checkForUpdates, GITHUB_OWNER, GITHUB_REPO };
