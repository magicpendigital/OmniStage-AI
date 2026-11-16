// PATH for the OmniStage server when it runs inside the desktop app.
//
// Apps started from the Start menu / Dock / a .desktop file do not inherit the PATH of the user's shell profile, so
// AI CLIs installed with `npm i -g`, Homebrew, the native Claude installer, Antigravity (`agy`) etc. would look
// "not installed" in the studio. server/ai/cliProviders.ts finds CLIs on PATH, so we append the usual install
// directories (only the ones that exist, after the inherited PATH so the user's own order still wins). Pure Node: no Electron imports (unit-tested).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Candidate CLI install directories for a platform (existence is checked by augmentPath). */
function candidateCliDirs(platform = process.platform, env = process.env, home = os.homedir()) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = [];
  const add = (...parts) => {
    if (parts.every((x) => typeof x === 'string' && x.length)) dirs.push(p.join(...parts));
  };
  if (platform === 'win32') {
    const appData = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    add(appData, 'npm'); // npm i -g (claude, codex, opencode)
    add(home, '.local', 'bin'); // native Claude Code installer
    add(local, 'agy', 'bin'); // Google Antigravity CLI
    add(local, 'Programs', 'Antigravity', 'bin');
    add(local, 'pnpm');
    add(home, '.bun', 'bin');
    add(home, 'scoop', 'shims');
    add(local, 'Volta', 'bin');
    add(home, '.opencode', 'bin');
    if (env.NVM_SYMLINK) add(env.NVM_SYMLINK);
    if (env.VOLTA_HOME) add(env.VOLTA_HOME, 'bin');
    add(env.ProgramFiles || 'C:\\Program Files', 'nodejs'); // npm .cmd shims need node.exe
  } else {
    add(home, '.local', 'bin');
    add(home, '.claude', 'local');
    add(home, '.npm-global', 'bin');
    add(home, '.bun', 'bin');
    add(home, '.volta', 'bin');
    add(home, '.opencode', 'bin');
    add(home, '.antigravity', 'bin');
    add(home, 'Library', 'pnpm');
    add(home, '.local', 'share', 'pnpm');
    if (env.NVM_BIN) add(env.NVM_BIN);
    add('/opt/homebrew/bin');
    add('/usr/local/bin');
    add('/usr/bin');
    add('/bin');
  }
  return dirs;
}

/**
 * macOS / Linux: ask the user's login shell for its PATH (covers nvm, asdf, custom profiles). Windows GUI apps get
 * the registry PATH already, so this is skipped there. Never throws; a slow or broken profile just returns [].
 */
function loginShellPath(platform = process.platform, env = process.env) {
  if (platform === 'win32') return [];
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__OMNI_PATH__%s__OMNI_PATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...env, DISABLE_AUTO_UPDATE: 'true' },
    });
    const m = /__OMNI_PATH__(.*)__OMNI_PATH__/s.exec(out);
    return m ? m[1].split(':').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Returns the PATH to give the server and the directories that were added to it.
 * `exists` is injectable for tests.
 */
function augmentPath({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  extraDirs = [],
  exists = (dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  },
} = {}) {
  const sep = platform === 'win32' ? ';' : ':';
  const pathKey = platform === 'win32' ? Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path' : 'PATH';
  const current = String(env[pathKey] || '').split(sep).filter(Boolean);
  const norm = (d) => (platform === 'win32' ? d.replace(/[\\/]+$/, '').toLowerCase() : d.replace(/\/+$/, ''));
  const seen = new Set(current.map(norm));
  const added = [];
  for (const dir of [...extraDirs, ...candidateCliDirs(platform, env, home)]) {
    const key = norm(dir);
    if (seen.has(key) || !exists(dir)) continue;
    seen.add(key);
    added.push(dir);
  }
  return { pathKey, path: [...current, ...added].join(sep), added };
}

module.exports = { candidateCliDirs, loginShellPath, augmentPath };
