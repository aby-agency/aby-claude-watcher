const net = require('net');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\aby-claude-watcher'
  : '/tmp/aby-claude-watcher.sock';

class SocketServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
  }

  start() {
    // Clean up stale socket file on Unix
    if (process.platform !== 'win32' && fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }

    this.server = net.createServer((conn) => {
      let buffer = '';

      conn.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg, conn);
          } catch (e) {
            // skip malformed messages
          }
        }
      });

      conn.on('error', () => {});
    });

    this.server.listen(SOCKET_PATH, () => {
      // Make socket accessible
      if (process.platform !== 'win32') {
        fs.chmodSync(SOCKET_PATH, 0o600);
      }
    });

    this.server.on('error', (err) => {
      console.error('Socket server error:', err.message);
    });
  }

  handleMessage(msg, conn) {
    switch (msg.action) {
      case 'register':
        // cc wrapper: new session with terminal info
        this.emit('register', {
          pid: msg.pid,
          terminalApp: msg.terminalApp,
          terminalId: msg.terminalId,
          cwd: msg.cwd,
        });
        conn.write(JSON.stringify({ status: 'ok' }) + '\n');
        break;

      case 'attach':
        // cwa: attach terminal to existing session
        this.emit('attach', {
          sessionId: msg.sessionId,
          terminalApp: msg.terminalApp,
          terminalId: msg.terminalId,
        });
        conn.write(JSON.stringify({ status: 'ok' }) + '\n');
        break;

      case 'permission-pending':
        // Claude hook fired (PreToolUse / Notification) — session is waiting
        // for the user to answer a permission prompt or a question.
        this.emit('permission-pending', {
          sessionId: msg.sessionId,
          hookEvent: msg.hookEvent,
        });
        conn.write(JSON.stringify({ status: 'ok' }) + '\n');
        break;

      case 'ping':
        conn.write(JSON.stringify({ status: 'pong' }) + '\n');
        break;

      default:
        conn.write(JSON.stringify({ status: 'error', message: 'unknown action' }) + '\n');
    }
  }

  stop() {
    if (this.server) {
      this.server.close();
      if (process.platform !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
      }
    }
  }
}

module.exports = { SocketServer, SOCKET_PATH };
