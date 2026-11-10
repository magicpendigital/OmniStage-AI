import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMessage } from '../mcp/server';
import { applyJsonPatch, mergePatch, normalizeBundle } from '../mcp/projectTools';

function context() {
  const rootDir = mkdtempSync(join(tmpdir(), 'omnistage-mcp-'));
  return { rootDir, projectPath: join(rootDir, 'demo.scenespec.json') };
}

let nextId = 1;
async function call(ctx: ReturnType<typeof context>, name: string, args: object = {}) {
  const res: any = await handleMessage({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, ctx);
  const text = res.result.content[0].text;
  return { isError: res.result.isError as boolean, text, json: res.result.isError ? null : JSON.parse(text) };
}

test('initialize negotiates protocol and lists tools', async () => {
  const ctx = context();
  const init: any = await handleMessage({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx), null);
  const list: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx);
  const names = list.result.tools.map((t: any) => t.name);
  for (const n of ['omnistage_contract', 'omnistage_create_scene', 'omnistage_apply_patch', 'omnistage_verify', 'omnistage_export_playable']) {
    assert.ok(names.includes(n), n);
  }
  const unknown: any = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, ctx);
  assert.equal(unknown.error.code, -32601);
});

test('agent workflow: create → patch (auto-fixed) → link → export offline playable', async () => {
  const ctx = context();
  const created = await call(ctx, 'omnistage_create_scene', { engineType: '2d', title: 'Level 1', mode: 'game' });
  assert.equal(created.isError, false, created.text);
  const sceneId = created.json.created.id;

  // Agent adds an unreachable sky star with a JSON Patch and an impossible score goal via merge patch.
  const patched = await call(ctx, 'omnistage_apply_patch', {
    mergePatch: { gameRules: { targetScore: 999 }, audio: { enabled: true, masterVolume: 0.5, cues: { collect: 'powerup' } } },
    ops: [
      {
        op: 'add',
        path: '/nodes2D/-',
        value: { id: 'sky-star', name: 'Sky Star', type: 'vector-shape', x: 900, y: 60, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#FBBF24', stroke: '#fff', shapeKind: 'star', physics2D: 'collectible', scoreValue: 25 },
      },
      { op: 'add', path: '/captions', value: [{ start: 0, end: 2, text: 'Grab every star!' }] },
    ],
  });
  assert.equal(patched.isError, false, patched.text);
  assert.equal(patched.json.verification.ok, true, patched.text);
  assert.ok(patched.json.autoFixes.length >= 2, patched.text);

  const scene = (await call(ctx, 'omnistage_get_scene', { sceneId })).json;
  assert.equal(scene.gameRules.targetScore, 50);
  assert.ok(scene.nodes2D.find((n: any) => n.id === 'sky-star').y > 60, 'star moved onto a reachable ledge');

  const second = await call(ctx, 'omnistage_create_scene', { engineType: '3d', title: 'Level 2', mode: 'game' });
  await call(ctx, 'omnistage_link_scenes', { sceneIds: [sceneId, second.json.created.id], kind: 'game-levels' });
  const listed = (await call(ctx, 'omnistage_list_scenes')).json;
  assert.equal(listed.scenes.length, 2);
  assert.equal(listed.scenes[0].sequence.nextSceneId, second.json.created.id);

  // The file on disk is a studio-importable bundle.
  const onDisk = normalizeBundle(JSON.parse(readFileSync(ctx.projectPath, 'utf8')));
  assert.equal(onDisk.scenes.length, 2);

  const exported = await call(ctx, 'omnistage_export_playable', { sceneId, network: 'meta', outPath: 'out/level.html' });
  assert.equal(exported.isError, false, exported.text);
  assert.equal(exported.json.budget.offlineReady, true, JSON.stringify(exported.json.budget));
  assert.equal(exported.json.budget.withinBudget, true);
  assert.ok(existsSync(join(ctx.rootDir, 'out', 'level.html')));

  const vtt = await call(ctx, 'omnistage_export_captions', { sceneId, outPath: 'out/level.vtt' });
  assert.equal(vtt.json.cues, 1);
  assert.match(readFileSync(join(ctx.rootDir, 'out', 'level.vtt'), 'utf8'), /^WEBVTT/);
});

test('safety: writes outside root and unknown scenes are refused', async () => {
  const ctx = context();
  await call(ctx, 'omnistage_create_scene', { engineType: '2d' });
  const escape = await call(ctx, 'omnistage_export_playable', { outPath: '../../evil.html' });
  assert.equal(escape.isError, true);
  assert.match(escape.text, /outside/);
  const missing = await call(ctx, 'omnistage_get_scene', { sceneId: 'nope' });
  assert.equal(missing.isError, true);
  const noProject = await call(context(), 'omnistage_verify');
  assert.equal(noProject.isError, true);
});

test('merge patch and JSON patch semantics', () => {
  assert.deepEqual(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: null, e: 4 }, f: [1] }), { a: 1, b: { d: 3, e: 4 }, f: [1] });
  const doc = { list: [1, 2], o: { k: 'v' } };
  assert.deepEqual(applyJsonPatch(doc, [
    { op: 'add', path: '/list/-', value: 3 },
    { op: 'replace', path: '/o/k', value: 'w' },
    { op: 'remove', path: '/list/0' },
    { op: 'test', path: '/list/0', value: 2 },
  ]), { list: [2, 3], o: { k: 'w' } });
  assert.deepEqual(doc.list, [1, 2], 'input untouched');
  assert.throws(() => applyJsonPatch(doc, [{ op: 'replace', path: '/missing/x', value: 1 }]));
});
