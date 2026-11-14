import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test file gets its own throwaway workspace.
process.env.OMNISTAGE_HOME = mkdtempSync(join(tmpdir(), 'omnistage-home-'));

const { createProject, listProjects, createGame, loadGame, saveGame, trashGame, trashProject, updateProject, projectAssets } = await import('../server/workspace/projects');
const { AssetStore } = await import('../server/workspace/assets');
const { addMemory, readMemory, updateMemory, deleteMemory, markMemoriesUsed } = await import('../server/workspace/memory');
const { installExtension, listInstalled, setExtensionEnabled, uninstallExtension } = await import('../server/workspace/extensions');
const { assertId, slugify } = await import('../server/workspace/store');
const { EXTENSION_CATALOG } = await import('../src/extensions/catalog');
const { createBlankSceneSpec } = await import('../src/registry/assetRegistry');
const { normalizeBundle } = await import('../mcp/projectTools');

test('ids are safe slugs (no traversal) and Vietnamese names slugify', () => {
  assert.equal(slugify('Game Nông Trại Đẹp'), 'game-nong-trai-dep');
  for (const bad of ['../etc', 'a/b', '', 'A B', '..', 'x'.repeat(70)]) assert.throws(() => assertId(bad));
  assert.equal(assertId('neon-runner-2'), 'neon-runner-2');
});

test('projects: create, games as studio bundles, save, trash', async () => {
  const p = await createProject({ name: 'Neon Runner', kind: 'collection', tags: ['Platformer', 'pixel'] });
  assert.equal(p.id, 'neon-runner');
  assert.deepEqual(p.tags, ['platformer', 'pixel']);
  const dup = await createProject({ name: 'Neon Runner' });
  assert.equal(dup.id, 'neon-runner-2');

  const scene = createBlankSceneSpec('2d', 'Level 1');
  const bundle = { ...scene, projectBundleVersion: '3.1.0', activeSceneId: scene.id, scenes: [scene] };
  const { game } = await createGame(p.id, 'Level 1', bundle);
  assert.equal(game.sceneCount, 1);
  assert.equal(game.engineType, '2d');

  const loaded: any = await loadGame(p.id, game.id);
  assert.equal(normalizeBundle(loaded).scenes[0].title, 'Level 1', 'game files are MCP / studio compatible');

  const scene2 = createBlankSceneSpec('3d', 'Level 2');
  await saveGame(p.id, game.id, { ...bundle, scenes: [scene, scene2] });
  const updated = (await listProjects()).find((x) => x.id === p.id)!;
  assert.equal(updated.games[0].sceneCount, 2);

  await updateProject(p.id, { description: 'Fast neon platformer', extensions: ['pixel-retro-pack'] });
  await assert.rejects(updateProject(p.id, { extensions: ['../evil'] }));

  await trashGame(p.id, game.id);
  assert.equal((await listProjects()).find((x) => x.id === p.id)!.games.length, 0);
  await trashProject(dup.id);
  assert.ok(!(await listProjects()).some((x) => x.id === dup.id));
  assert.ok(readdirSync(join(process.env.OMNISTAGE_HOME!, '.trash')).length >= 2, 'deleted items are recoverable from .trash');
});

test('asset store: personal and project libraries', async () => {
  const lib = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const a = await lib.add({ filename: 'Hero Sheet.png', data: Buffer.from([137, 80, 78, 71]), tags: ['Hero', 'sprite'], meta: { frameWidth: 32 } });
  assert.equal(a.kind, 'image');
  assert.equal(a.mime, 'image/png');
  assert.deepEqual(a.tags, ['hero', 'sprite']);
  const { path } = await lib.filePath(a.id);
  assert.ok(existsSync(path));
  await lib.update(a.id, { kind: 'spritesheet', meta: { columns: 4 } });
  assert.deepEqual((await lib.list())[0].meta, { frameWidth: 32, columns: 4 });
  await assert.rejects(lib.add({ filename: 'virus.exe', data: Buffer.from('x') }), /Unsupported/);
  await assert.rejects(lib.add({ filename: 'empty.glb', data: Buffer.alloc(0) }), /Empty/);
  await lib.remove(a.id);
  assert.equal((await lib.list()).length, 0);

  const proj = await createProject({ name: 'Shared Assets' });
  const store = projectAssets(proj.id);
  const m = await store.add({ filename: 'robot.glb', data: Buffer.from('glTF') });
  assert.equal(m.kind, 'model');
});

test('memory: add, dedupe, pin, use counts, delete, sanitise scope', async () => {
  const a = await addMemory({ text: '  My games target kids 6-10  ', kind: 'goal' });
  const again = await addMemory({ text: 'my games target kids 6-10' });
  assert.equal(again.id, a.id, 'case-insensitive dedupe');
  const scoped = await addMemory({ text: 'Neon palette only', kind: 'style', scope: 'neon-runner' });
  assert.equal(scoped.scope, 'neon-runner');
  const weird = await addMemory({ text: 'x y z', scope: '../../etc' });
  assert.equal(weird.scope, 'global');
  await updateMemory(a.id, { pinned: true });
  await markMemoriesUsed([a.id, a.id]);
  const file = await readMemory();
  const stored = file.entries.find((e) => e.id === a.id)!;
  assert.equal(stored.pinned, true);
  assert.equal(stored.uses, 1);
  await deleteMemory(weird.id);
  assert.ok(!(await readMemory()).entries.some((e) => e.id === weird.id));
});

test('extensions: install requires approving every permission; enable / uninstall', async () => {
  const tool = EXTENSION_CATALOG.find((m) => m.id === 'level-layout-tool')!;
  await assert.rejects(installExtension({ manifest: tool, source: 'builtin-catalog', approvedPermissions: ['scene:read'] }), /not approved/);
  const ok = await installExtension({ manifest: tool, source: 'builtin-catalog', approvedPermissions: ['scene:read', 'scene:write', 'ui:notify'] });
  assert.equal(ok.enabled, true);
  assert.equal(ok.review?.risk, 'medium');
  const data = EXTENSION_CATALOG.find((m) => m.id === 'pixel-retro-pack')!;
  await installExtension({ manifest: data, source: 'builtin-catalog', approvedPermissions: [] });
  await assert.rejects(installExtension({ manifest: { ...data, id: 'Bad Id' }, source: 'file', approvedPermissions: [] }), /Invalid extension/);
  await setExtensionEnabled('pixel-retro-pack', false);
  const list = await listInstalled();
  assert.equal(list.length, 2);
  assert.equal(list.find((e) => e.manifest.id === 'pixel-retro-pack')!.enabled, false);
  await uninstallExtension('level-layout-tool');
  assert.deepEqual((await listInstalled()).map((e) => e.manifest.id), ['pixel-retro-pack']);
});
