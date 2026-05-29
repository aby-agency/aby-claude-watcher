// Centralized logger (electron-log) + single source for the DEBUG flag.
//
// Writes to ~/Library/Logs/aby-claude-watcher/main.log (path derives from
// app.getName() = package.json "name", in dev AND packaged) with rotation, so builds
// (launched from the Finder, no terminal attached) keep a forensic trail of
// state transitions and errors. Also the single source for the DEBUG flag —
// replaces the consts previously duplicated in watcher.js and focus.js.
const log = require('electron-log/main');

const DEBUG = process.argv.includes('--dev') || !!process.env.ABY_DEBUG;

// Electron-only wiring. Under plain Node (unit tests require modules that pull
// this in), there is no `app`, so log.initialize()/errorHandler would throw at
// require time. Guard on the Electron runtime and disable the file transport so
// stray log.* calls don't try to resolve app paths.
if (process.versions && process.versions.electron) {
  // Enable renderer-side logging over IPC (captures ui/ console.* into the file too).
  log.initialize();

  // File always persists; verbose only when debugging. Console mirrors in dev.
  log.transports.file.level = DEBUG ? 'debug' : 'info';
  log.transports.console.level = DEBUG ? 'debug' : 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB, then rotates to main.old.log

  // Capture uncaughtException / unhandledRejection with a full stack trace instead
  // of letting the tray app die silently. No dialog — this runs in the background.
  log.errorHandler.startCatching({ showDialog: false });
} else {
  log.transports.file.level = false; // no Electron app → console transport only
}

module.exports = { log, DEBUG };
