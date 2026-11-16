// Desktop settings (userData/settings.json): workspace folder, preferred port, LAN access. Pure Node (unit-tested).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PORT = 39217;

function defaultSettings(documentsDir) {
  return {
    // Projects, libraries, extensions, memory: the studio's OMNISTAGE_HOME.
    workspaceDir: path.join(documentsDir, 'OmniStage'),
    // A stable port keeps the studio's origin (and its browser storage: settings, keys) the same between launches.
    port: DEFAULT_PORT,
    // false: the server only listens on 127.0.0.1. true: 0.0.0.0, needed for "Play on phone" over Wi-Fi.
    lanAccess: false,
  };
}

function normalizeSettings(raw, documentsDir) {
  const d = defaultSettings(documentsDir);
  const s = raw && typeof raw === 'object' ? raw : {};
  const port = Number(s.port);
  return {
    workspaceDir: typeof s.workspaceDir === 'string' && path.isAbsolute(s.workspaceDir) ? s.workspaceDir : d.workspaceDir,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : d.port,
    lanAccess: s.lanAccess === true,
  };
}

function loadSettings(file, documentsDir) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')), documentsDir);
  } catch {
    return defaultSettings(documentsDir);
  }
}

function saveSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Navigation inside the app window stays on the local studio origin; everything else goes to the system browser. */
function isAppUrl(url, origin) {
  try {
    const u = new URL(url);
    return u.origin === origin || (u.protocol === 'blob:' && u.href.startsWith(`blob:${origin}/`));
  } catch {
    return false;
  }
}

/** Only these schemes may be handed to the OS (shell.openExternal): never file:, javascript:, custom handlers. */
function isSafeExternalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

module.exports = { DEFAULT_PORT, defaultSettings, normalizeSettings, loadSettings, saveSettings, isAppUrl, isSafeExternalUrl };
