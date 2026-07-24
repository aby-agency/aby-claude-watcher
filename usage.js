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
const POLL_MS = 5 * 60 * 1000;
const FIRST_POLL_DELAY_MS = 2000;
// Exponential backoff: double the interval on each consecutive failure
// up to MAX_BACKOFF_MS, then cap. Resets to POLL_MS on first success.
const MAX_BACKOFF_MS = 60 * 60 * 1000;

class UsageMonitor extends EventEmitter {
  constructor() {
    super();
    this.nextTimer = null;
    this.latest = null;
    this.lastError = null;
    this.consecutiveFailures = 0;
    this.stopped = false;
  }

  start() {
    if (this.nextTimer || this.stopped) return;
    this._scheduleNext(FIRST_POLL_DELAY_MS);
  }

  stop() {
    this.stopped = true;
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = null;
  }

  _scheduleNext(delayMs) {
    if (this.stopped) return;
    this.nextTimer = setTimeout(async () => {
      this.nextTimer = null;
      await this.poll();
      if (this.stopped) return;
      const next = this.consecutiveFailures > 0
        ? Math.min(POLL_MS * 2 ** Math.min(this.consecutiveFailures - 1, 8), MAX_BACKOFF_MS)
        : POLL_MS;
      this._scheduleNext(next);
    }, delayMs);
  }

  getLatest() {
    return this.latest;
  }

  async poll() {
    try {
      const token = await this._readToken();
      if (!token) {
        this.consecutiveFailures += 1;
        this._setError('no-token');
        return;
      }
      const data = await this._fetch(token);
      const normalized = this._normalize(data);
      this.latest = normalized;
      this.lastError = null;
      this.consecutiveFailures = 0;
      this.emit('update', normalized);
    } catch (e) {
      this.consecutiveFailures += 1;
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
    // Le nouveau schéma expose `limits[]` : une entrée par fenêtre, dont les
    // limites SCOPÉES par modèle (ex. la limite hebdo Fable) que les ex-clés
    // seven_day_sonnet/opus (désormais toujours null, constaté 2026-07-24)
    // n'exposent plus. On lit `scope.model.display_name` GÉNÉRIQUEMENT : le
    // tooltip suivra automatiquement le modèle sous limite, quel qu'il soit.
    const scopedLimits = (Array.isArray(d.limits) ? d.limits : [])
      .filter((l) => l && l.scope && l.scope.model && l.scope.model.display_name
        && typeof l.percent === 'number')
      .map((l) => ({
        model: l.scope.model.display_name,
        group: l.group || null,
        percent: l.percent,
        resetsAt: l.resets_at || null,
        severity: l.severity || 'normal',
      }));
    return {
      fiveHour: pick(d.five_hour),
      sevenDay: pick(d.seven_day),
      scopedLimits,
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
