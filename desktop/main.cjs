// OmniStage AI desktop: starts the bundled studio server (dist-server/server.mjs) in an Electron utility process on
// localhost, waits for /api/health, and shows the studio in a locked-down window. See docs/desktop.md.
'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session, utilityProcess } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { augmentPath, loginShellPath } = require('./cliPath.cjs');
const { loadSettings, saveSettings, isAppUrl, isSafeExternalUrl } = require('./settings.cjs');

const APP_NAME = 'OmniStage AI';
const HEALTH_TIMEOUT_MS = 30_000;

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('ai.omnistage.studio');

/** Paths of the server bundle and the built studio: repo folders in dev, resources/ in the installed app. */
function resourcePaths() {
  if (app.isPackaged) {
    return { serverEntry: path.join(process.resourcesPath, 'server', 'server.mjs'), distDir: path.join(process.resourcesPath, 'studio') };
  }
  const repo = path.resolve(__dirname, '..');
  return { serverEntry: path.join(repo, 'dist-server', 'server.mjs'), distDir: path.join(repo, 'dist') };
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const logFile = () => path.join(app.getPath('logs'), 'server.log');

let settings;
let serverProc = null;
let serverOrigin = '';
let pathInfo = { added: [] };
let mainWindow = null;
let quitting = false;

function portFree(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

function randomFreePort(host) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, host, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** The saved port when free (stable origin = the studio keeps its browser storage), else a random free one. */
async function pickPort(host) {
  if (await portFree(settings.port, host)) return settings.port;
  const port = await randomFreePort(host);
  settings.port = port;
  saveSettings(settingsFile(), settings);
  return port;
}

async function waitForHealth(origin, proc) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.exited) throw new Error(`The OmniStage server stopped during start-up (exit code ${proc.exitCode}). See ${logFile()}.`);
    try {
      const res = await fetch(`${origin}/api/health`);
      if (res.ok && (await res.json())?.status === 'ok') return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The OmniStage server did not answer within ${HEALTH_TIMEOUT_MS / 1000}s. See ${logFile()}.`);
}

async function startServer() {
  const { serverEntry, distDir } = resourcePaths();
  if (!fs.existsSync(serverEntry) || !fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`The studio is not built yet.\nMissing: ${fs.existsSync(serverEntry) ? path.join(distDir, 'index.html') : serverEntry}\n\nRun "npm run build && npm run build:server" in the OmniStage folder.`);
  }
  fs.mkdirSync(settings.workspaceDir, { recursive: true });
  fs.mkdirSync(path.dirname(logFile()), { recursive: true });

  const host = settings.lanAccess ? '0.0.0.0' : '127.0.0.1';
  const port = await pickPort('127.0.0.1');
  pathInfo = augmentPath({ extraDirs: loginShellPath() });
  const env = {
    ...process.env,
    [pathInfo.pathKey]: pathInfo.path,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: host,
    OMNISTAGE_HOME: settings.workspaceDir,
    OMNISTAGE_DIST_DIR: distDir,
    OMNISTAGE_DESKTOP: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const log = fs.createWriteStream(logFile(), { flags: 'a' });
  log.write(`\n--- ${new Date().toISOString()} starting ${serverEntry} on ${host}:${port}\n--- PATH additions: ${pathInfo.added.join(', ') || '(none)'}\n`);
  // cwd = workspace: `dotenv/config` in the server reads <workspace>/.env, where advanced users can put server-side keys.
  const proc = utilityProcess.fork(serverEntry, ['--prod'], { cwd: settings.workspaceDir, env, stdio: 'pipe', serviceName: 'OmniStage server' });
  proc.exited = false;
  proc.stdout?.on('data', (d) => log.write(d));
  proc.stderr?.on('data', (d) => log.write(d));
  proc.once('exit', (code) => {
    proc.exited = true;
    proc.exitCode = code;
    log.write(`--- server exited with code ${code}\n`);
    log.end();
    if (proc === serverProc && !quitting) {
      serverProc = null;
      dialog.showErrorBox(APP_NAME, `The OmniStage server stopped unexpectedly (exit code ${code}).\nLog: ${logFile()}`);
      app.quit();
    }
  });
  serverProc = proc;
  serverOrigin = `http://127.0.0.1:${port}`;
  await waitForHealth(serverOrigin, proc);
}

/** Asks the server to close (it handles the message like SIGTERM), then force-kills after 3 s. */
function stopServer() {
  const proc = serverProc;
  serverProc = null;
  if (!proc || proc.exited) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill();
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.postMessage({ type: 'omnistage:shutdown' });
    } catch {
      proc.kill();
    }
  });
}

// ---- Window security -------------------------------------------------------------------------------------------

function openExternal(url) {
  if (isSafeExternalUrl(url)) shell.openExternal(url);
}

app.on('web-contents-created', (_e, contents) => {
  // Popups: same-origin ones (e.g. a preview tab) open as another locked-down app window; links leave for the browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url, serverOrigin)) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: secureWebPreferences() } };
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, serverOrigin)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, serverOrigin)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

function secureWebPreferences() {
  return { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false };
}

const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'notifications']);

function lockPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(wc.getURL(), serverOrigin));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => ALLOWED_PERMISSIONS.has(permission) && requestingOrigin === serverOrigin);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#09090b',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: secureWebPreferences(),
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(serverOrigin);
}

// ---- Menu: workspace + diagnostics -----------------------------------------------------------------------------

async function showDiagnostics() {
  let cliLines = ['(could not reach the server)'];
  try {
    const res = await fetch(`${serverOrigin}/api/ai/providers?refresh=1`);
    const data = await res.json();
    cliLines = (data.cli || []).map((c) => `${c.installed ? '[found]   ' : '[missing] '}${c.label}${c.version ? ` — ${c.version}` : ''}`);
  } catch {
    // keep the placeholder
  }
  const detail = [
    `Version: ${app.getVersion()}  (Electron ${process.versions.electron})`,
    `Studio: ${serverOrigin}${settings.lanAccess ? '  (LAN access on)' : ''}`,
    `Workspace folder: ${settings.workspaceDir}`,
    `Server log: ${logFile()}`,
    '',
    'AI command-line tools (sign in once in a terminal, then pick them in Settings):',
    ...cliLines,
    '',
    `Folders added to PATH for the CLIs: ${pathInfo.added.length ? '' : '(none needed)'}`,
    ...pathInfo.added.map((d) => `  ${d}`),
  ].join('\n');
  await dialog.showMessageBox(mainWindow ?? undefined, { type: 'info', title: `${APP_NAME} — Diagnostics`, message: 'OmniStage diagnostics', detail, buttons: ['OK'] });
}

async function restartServer() {
  await stopServer();
  try {
    await startServer();
    mainWindow?.loadURL(serverOrigin);
  } catch (e) {
    dialog.showErrorBox(APP_NAME, String(e?.message || e));
    app.quit();
  }
}

async function chooseWorkspace() {
  const r = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Choose the OmniStage workspace folder',
    defaultPath: settings.workspaceDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0] || r.filePaths[0] === settings.workspaceDir) return;
  settings.workspaceDir = r.filePaths[0];
  saveSettings(settingsFile(), settings);
  await restartServer();
}

async function toggleLanAccess(item) {
  settings.lanAccess = item.checked;
  saveSettings(settingsFile(), settings);
  await restartServer();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Workspace Folder', click: () => shell.openPath(settings.workspaceDir) },
        { label: 'Change Workspace Folder…', click: () => chooseWorkspace() },
        { type: 'separator' },
        { label: 'Allow Play on Phone (LAN access)', type: 'checkbox', checked: settings.lanAccess, click: (item) => toggleLanAccess(item) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Diagnostics (AI CLIs, paths)…', click: () => showDiagnostics() },
        { label: 'Open Server Log', click: () => shell.openPath(logFile()) },
        { label: 'Open Studio in Browser', click: () => openExternal(serverOrigin) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Lifecycle --------------------------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    settings = loadSettings(settingsFile(), app.getPath('documents'));
    saveSettings(settingsFile(), settings);
    try {
      await startServer();
    } catch (e) {
      dialog.showErrorBox(APP_NAME, String(e?.message || e));
      quitting = true;
      await stopServer();
      app.exit(1);
      return;
    }
    lockPermissions();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (!mainWindow) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    if (!serverProc) return;
    event.preventDefault();
    stopServer().finally(() => app.quit());
  });
}
