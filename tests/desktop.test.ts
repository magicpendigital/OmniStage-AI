import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { augmentPath, candidateCliDirs } = require('../desktop/cliPath.cjs');
const { normalizeSettings, isAppUrl, isSafeExternalUrl, DEFAULT_PORT } = require('../desktop/settings.cjs');

test('desktop PATH: Windows adds existing npm / agy / native-claude dirs after the inherited PATH', () => {
  const env = { Path: 'C:\\Windows\\system32;C:\\Users\\me\\AppData\\Roaming\\npm\\', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  const existing = new Set(['C:\\Users\\me\\AppData\\Roaming\\npm', 'C:\\Users\\me\\AppData\\Local\\agy\\bin', 'C:\\Users\\me\\.local\\bin']);
  const r = augmentPath({ platform: 'win32', env, home: 'C:\\Users\\me', exists: (d: string) => existing.has(d) });
  assert.equal(r.pathKey, 'Path');
  // npm is already on PATH (trailing slash, different case is the same dir): not added twice.
  assert.deepEqual(r.added, ['C:\\Users\\me\\.local\\bin', 'C:\\Users\\me\\AppData\\Local\\agy\\bin']);
  assert.ok(r.path.startsWith('C:\\Windows\\system32;'));
  assert.ok(r.path.endsWith(';C:\\Users\\me\\.local\\bin;C:\\Users\\me\\AppData\\Local\\agy\\bin'));
});

test('desktop PATH: macOS covers Homebrew and ~/.local/bin; login-shell dirs come first', () => {
  const dirs = candidateCliDirs('darwin', {}, '/Users/me');
  assert.ok(dirs.includes('/opt/homebrew/bin'));
  assert.ok(dirs.includes('/Users/me/.local/bin'));
  const r = augmentPath({ platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, home: '/Users/me', extraDirs: ['/Users/me/.nvm/versions/node/v22/bin'], exists: () => true });
  assert.equal(r.pathKey, 'PATH');
  assert.equal(r.added[0], '/Users/me/.nvm/versions/node/v22/bin');
  assert.ok(!r.added.includes('/usr/bin'));
  assert.ok(r.path.startsWith('/usr/bin:/bin:'));
});

test('desktop settings: defaults and validation', () => {
  const docs = process.platform === 'win32' ? 'C:\\Users\\me\\Documents' : '/home/me/Documents';
  const d = normalizeSettings(null, docs);
  assert.equal(d.port, DEFAULT_PORT);
  assert.equal(d.lanAccess, false);
  assert.ok(d.workspaceDir.startsWith(docs) && d.workspaceDir.endsWith('OmniStage'));
  const bad = normalizeSettings({ workspaceDir: 'relative/dir', port: 80, lanAccess: 'yes' }, docs);
  assert.equal(bad.workspaceDir, d.workspaceDir);
  assert.equal(bad.port, DEFAULT_PORT);
  assert.equal(bad.lanAccess, false);
});

test('desktop navigation lock: only the local origin stays in the window, only web links go outside', () => {
  const origin = 'http://127.0.0.1:39217';
  assert.equal(isAppUrl('http://127.0.0.1:39217/play/abc', origin), true);
  assert.equal(isAppUrl('blob:http://127.0.0.1:39217/1234-5678', origin), true);
  assert.equal(isAppUrl('http://127.0.0.1:39218/', origin), false);
  assert.equal(isAppUrl('https://evil.example/', origin), false);
  assert.equal(isAppUrl('file:///C:/Windows/', origin), false);
  assert.equal(isSafeExternalUrl('https://poly.pizza/settings/api'), true);
  assert.equal(isSafeExternalUrl('file:///C:/Windows/system32/calc.exe'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('ms-settings:'), false);
});
