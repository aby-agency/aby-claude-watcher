// ─── usage.js ───
// Polls Claude Code's undocumented OAuth usage endpoint to surface
// subscription utilization (5h + 7d windows). Token comes from the
// macOS Keychain entry "Claude Code-credentials" or the Linux
// fallback file ~/.claude/.credentials.json.
//
// Endpoint and beta header are not in Anthropic's public reference;
// they may change without notice. All failures degrade silently —
// the UI just shows no usage bar until the next successful poll.

const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const BETA_HEADER = 'oauth-2025-04-20';
const POLL_MS = 60 * 1000;
const FIRST_POLL_DELAY_MS = 2000;

class UsageMonitor extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.firstPollTimer = null;
    this.latest = null;
    this.lastError = null;
  }

  start() {
    if (this.timer) return;
    this.firstPollTimer = setTimeout(() => {
      this.firstPollTimer = null;
      this.poll();
    }, FIRST_POLL_DELAY_MS);
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstPollTimer) clearTimeout(this.firstPollTimer);
    this.timer = null;
    this.firstPollTimer = null;
  }

  getLatest() {
    return this.latest;
  }

  async poll() {
    try {
      const token = await this._readToken();
      if (!token) {
        this._setError('no-token');
        return;
      }
      const data = await this._fetch(token);
      const normalized = this._normalize(data);
      this.latest = normalized;
      this.lastError = null;
      this.emit('update', normalized);
    } catch (e) {
      this._setError(e.code || e.message || 'unknown');
    }
  }

  _setError(code) {
    if (this.lastError === code) return;
    this.lastError = code;
    this.emit('error', code);
  }

  _normalize(d) {
    const pick = (obj) => obj && typeof obj.utilization === 'number'
      ? { utilization: obj.utilization, resetsAt: obj.resets_at || null }
      : null;
    return {
      fiveHour: pick(d.five_hour),
      sevenDay: pick(d.seven_day),
      sevenDaySonnet: pick(d.seven_day_sonnet),
      sevenDayOpus: pick(d.seven_day_opus),
      fetchedAt: Date.now(),
    };
  }

  _readToken() {
    if (process.platform === 'darwin') return this._readTokenKeychain();
    return this._readTokenFile();
  }

  _readTokenKeychain() {
    return new Promise((resolve) => {
      execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const json = JSON.parse(stdout.trim());
          resolve(json?.claudeAiOauth?.accessToken || null);
        } catch {
          resolve(null);
        }
      });
    });
  }

  _readTokenFile() {
    try {
      const p = path.join(os.homedir(), '.claude', '.credentials.json');
      const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return Promise.resolve(json?.claudeAiOauth?.accessToken || null);
    } catch {
      return Promise.resolve(null);
    }
  }

  _fetch(token) {
    return new Promise((resolve, reject) => {
      const req = https.request(ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'anthropic-beta': BETA_HEADER,
          'User-Agent': 'aby-claude-watcher',
        },
        timeout: 10000,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error('parse-error')); }
          } else {
            const err = new Error(`http-${res.statusCode}`);
            err.code = `http-${res.statusCode}`;
            reject(err);
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = { UsageMonitor };
