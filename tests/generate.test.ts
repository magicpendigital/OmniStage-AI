import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Throwaway workspace for this file.
process.env.OMNISTAGE_HOME = mkdtempSync(join(tmpdir(), 'omnistage-gen-'));
for (const k of ['MESHY_API_KEY', 'TRIPO_API_KEY', 'FAL_KEY', 'REPLICATE_API_TOKEN']) delete process.env[k];

const { PROVIDERS, cleanPrompt, safeUrl, spritePrompt, upstreamErrorMessage } = await import('../server/generate/providers');
const { startGeneration, pollGeneration, sniffResult, _resetGenerationJobs, MIN_POLL_MS } = await import('../server/generate/jobs');
const { availableGenerators, resolveGenerator } = await import('../server/generate/routes');
const { AssetStore } = await import('../server/workspace/assets');
const { EXTENSION_CATALOG } = await import('../src/extensions/catalog');
const { validateManifest, reviewExtension } = await import('../src/extensions/validate');
import type { InstalledExtension } from '../src/extensions/types';

const KEY = 'sk-secret-123456';
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(60, 2)]);

const catalog = (id: string) => EXTENSION_CATALOG.find((m) => m.id === id)!;
const generator = (extId: string, genId: string) => catalog(extId).contributes!.generators!.find((g) => g.id === genId)!;
const installed = (id: string, over: Partial<InstalledExtension> = {}): InstalledExtension => ({
  manifest: catalog(id),
  enabled: true,
  installedAt: '',
  source: 'builtin-catalog',
  approvedPermissions: catalog(id).permissions || [],
  ...over,
});

interface Call { url: string; method: string; headers: Record<string, string>; body?: any }

/** Fake upstream: routes by method + URL prefix, records every call. */
function fakeFetch(routes: Array<[string, string, (call: Call) => { status?: number; json?: unknown; bytes?: Buffer }]>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: any) => {
    const call: Call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const hit = routes.find(([m, prefix]) => m === init.method && url.startsWith(prefix));
    if (!hit) return new Response('not found', { status: 404 });
    const out = hit[2](call);
    if (out.bytes) return new Response(new Uint8Array(out.bytes), { status: out.status || 200, headers: { 'content-length': String(out.bytes.length) } });
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status || 200 });
  };
  return { fetch, calls };
}

function clock() {
  let t = 1_000_000;
  return { now: () => t, tick: () => (t += MIN_POLL_MS + 1) };
}

test('generator catalog extensions are valid, need the generate permission and say who gets the prompt', () => {
  for (const id of ['meshy-3d-generator', 'tripo-3d-generator', 'fal-sprite-generator', 'replicate-sprite-generator']) {
    const m = catalog(id);
    assert.deepEqual(validateManifest(m), [], id);
    assert.deepEqual(m.permissions, ['generate']);
    assert.ok(reviewExtension(m).findings.some((f) => /your own API key/.test(f.message)), id);
  }
  const noPerm = { ...catalog('fal-sprite-generator'), permissions: [] };
  assert.ok(validateManifest(noPerm).some((e) => /generate/.test(e)));
  const bad = { ...catalog('fal-sprite-generator'), contributes: { generators: [{ id: 'x1', title: 'X', provider: 'fal', output: 'model', model: '../../etc' }, { id: 'y1', title: 'Y', provider: 'evil', output: 'image' }] } };
  const errors = validateManifest(bad);
  assert.ok(errors.some((e) => /generates images/.test(e)), errors.join('|'));
  assert.ok(errors.some((e) => /invalid model id/.test(e)), errors.join('|'));
  assert.ok(errors.some((e) => /unknown provider/.test(e)), errors.join('|'));
});

test('generators are only offered from enabled extensions that were granted "generate"', () => {
  const list = [installed('meshy-3d-generator'), installed('tripo-3d-generator', { enabled: false }), installed('fal-sprite-generator', { approvedPermissions: [] })];
  const gens = availableGenerators(list, {});
  assert.deepEqual(gens.map((g) => g.id), ['meshy-text-to-3d', 'meshy-text-to-mesh']);
  assert.equal(gens[0].serverKey, false);
  assert.equal(availableGenerators(list, { MESHY_API_KEY: 'x' })[0].serverKey, true);
  assert.throws(() => resolveGenerator(list, 'tripo-3d-generator', 'tripo-text-to-3d'), /turned off/);
  assert.throws(() => resolveGenerator(list, 'fal-sprite-generator', 'fal-sprite'), /permission/);
  assert.throws(() => resolveGenerator(list, 'nope', 'x'), /not installed/);
  assert.equal(resolveGenerator(list, 'meshy-3d-generator', 'meshy-text-to-3d').provider, 'meshy');
});

test('prompts, URLs and errors are sanitised (no SSRF, no key echo)', () => {
  assert.throws(() => cleanPrompt('  '));
  assert.equal(cleanPrompt('a\u0000 red\n\n chest'), 'a red chest');
  assert.equal(cleanPrompt('x'.repeat(5000)).length, 800);
  assert.match(spritePrompt('a fox'), /^a fox\. Single game sprite/);
  assert.ok(safeUrl('https://assets.meshy.ai/x.glb', ['meshy.ai']));
  for (const bad of ['http://assets.meshy.ai/x.glb', 'https://meshy.ai.evil.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://u:p@assets.meshy.ai/x', 'https://assets.meshy.ai:8443/x', 'file:///etc/passwd']) {
    assert.equal(safeUrl(bad, ['meshy.ai', 'localhost']), null, bad);
  }
  assert.match(upstreamErrorMessage('Meshy', 401, '', KEY), /rejected the API key/);
  assert.equal(upstreamErrorMessage('fal.ai', 500, `bad key ${KEY} here`, KEY).includes(KEY), false);
  assert.equal(sniffResult(GLB, 'model'), '.glb');
  assert.equal(sniffResult(PNG, 'image'), '.png');
  assert.throws(() => sniffResult(PNG, 'model'), /unexpected file/);
  assert.throws(() => sniffResult(Buffer.from('<html>'), 'image'), /unexpected file/);
});

test('Meshy: preview → refine → GLB saved in the library with source, licence and prompt', async () => {
  _resetGenerationJobs();
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const c = clock();
  let previewPolls = 0;
  const { fetch, calls } = fakeFetch([
    ['POST', 'https://api.meshy.ai/openapi/v2/text-to-3d', (call) => ({ json: { result: call.body.mode === 'preview' ? 'prev-task-1' : 'refine-task-1' } })],
    ['GET', 'https://api.meshy.ai/openapi/v2/text-to-3d/prev-task-1', () => (++previewPolls < 2 ? { json: { status: 'IN_PROGRESS', progress: 40 } } : { json: { status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/prev.glb' } } })],
    ['GET', 'https://api.meshy.ai/openapi/v2/text-to-3d/refine-task-1', () => ({ json: { status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/final.glb' } } })],
    ['GET', 'https://assets.meshy.ai/final.glb', () => ({ bytes: GLB })],
  ]);
  const deps = { fetch, store, now: c.now };
  const job = await startGeneration({ extensionId: 'meshy-3d-generator', generator: generator('meshy-3d-generator', 'meshy-text-to-3d'), prompt: 'A wooden treasure chest!', scope: 'personal' }, KEY, deps);
  assert.equal(job.status, 'running');
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].body.mode, 'preview');
  assert.equal(JSON.stringify(job).includes(KEY), false, 'job view never carries the key');

  // Throttled: an immediate poll does not hit the provider.
  await pollGeneration(job.id, KEY, deps);
  assert.equal(calls.length, 1);

  c.tick();
  let v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.stage, 'preview');
  assert.equal(v.progress, 20); // 40% of stage 1 of 2
  c.tick();
  v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.stage, 'refine');
  assert.deepEqual(calls.at(-1)!.body, { mode: 'refine', preview_task_id: 'prev-task-1', enable_pbr: true, target_formats: ['glb'] });
  c.tick();
  v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.status, 'succeeded', v.error);
  assert.equal(v.asset!.kind, 'model');
  assert.equal(v.asset!.source, 'meshy');
  assert.match(v.asset!.license!, /Meshy/);
  assert.equal(v.asset!.meta!.prompt, 'A wooden treasure chest!');
  assert.ok(v.asset!.file.endsWith('.glb'));
  const { path } = await store.filePath(v.asset!.id);
  assert.deepEqual(readFileSync(path), GLB);
  assert.ok(!calls.some((x) => x.url === 'https://assets.meshy.ai/final.glb' && x.headers.Authorization), 'the key is not sent to the file host');
});

test('fal.ai sprite: queue → result → background cut-out → transparent sprite asset', async () => {
  _resetGenerationJobs();
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const c = clock();
  const { fetch, calls } = fakeFetch([
    ['POST', 'https://queue.fal.run/fal-ai/flux/schnell', () => ({ json: { request_id: 'req-img-1', status_url: 'https://queue.fal.run/fal-ai/flux/requests/req-img-1/status', response_url: 'https://queue.fal.run/fal-ai/flux/requests/req-img-1' } })],
    ['GET', 'https://queue.fal.run/fal-ai/flux/requests/req-img-1/status', () => ({ json: { status: 'COMPLETED' } })],
    ['GET', 'https://queue.fal.run/fal-ai/flux/requests/req-img-1', () => ({ json: { images: [{ url: 'https://v3.fal.media/files/raw.png' }] } })],
    ['POST', 'https://queue.fal.run/fal-ai/imageutils/rembg', () => ({ json: { request_id: 'req-cut-1', status_url: 'https://queue.fal.run/fal-ai/imageutils/requests/req-cut-1/status', response_url: 'https://queue.fal.run/fal-ai/imageutils/requests/req-cut-1' } })],
    ['GET', 'https://queue.fal.run/fal-ai/imageutils/requests/req-cut-1/status', () => ({ json: { status: 'COMPLETED' } })],
    ['GET', 'https://queue.fal.run/fal-ai/imageutils/requests/req-cut-1', () => ({ json: { image: { url: 'https://v3.fal.media/files/cut.png' } } })],
    ['GET', 'https://v3.fal.media/files/cut.png', () => ({ bytes: PNG })],
  ]);
  const deps = { fetch, store, now: c.now };
  const job = await startGeneration({ extensionId: 'fal-sprite-generator', generator: generator('fal-sprite-generator', 'fal-sprite'), prompt: 'pixel fox knight', scope: 'personal' }, KEY, deps);
  assert.equal(calls[0].headers.Authorization, `Key ${KEY}`);
  assert.match(calls[0].body.prompt, /Single game sprite/);
  c.tick();
  let v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.stage, 'cutout');
  assert.equal(calls.at(-1)!.body.image_url, 'https://v3.fal.media/files/raw.png');
  c.tick();
  v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.status, 'succeeded', v.error);
  assert.equal(v.asset!.kind, 'spritesheet');
  assert.equal(v.asset!.source, 'fal');
  assert.equal(v.asset!.meta!.transparent, true);
});

test('Tripo + Replicate happy paths, and failures become readable job errors', async () => {
  _resetGenerationJobs();
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const c = clock();
  const { fetch } = fakeFetch([
    ['POST', 'https://api.tripo3d.ai/v2/openapi/task', () => ({ json: { code: 0, data: { task_id: 'tripo-1' } } })],
    ['GET', 'https://api.tripo3d.ai/v2/openapi/task/tripo-1', () => ({ json: { code: 0, data: { status: 'success', output: { pbr_model: 'https://tripo-data.rg1.data.tripo3d.com/m.glb' } } } })],
    ['GET', 'https://tripo-data.rg1.data.tripo3d.com/m.glb', () => ({ bytes: GLB })],
    ['POST', 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', () => ({ json: { id: 'rep1abcd', status: 'starting' } })],
    ['GET', 'https://api.replicate.com/v1/predictions/rep1abcd', () => ({ json: { status: 'succeeded', output: ['https://evil.example.com/x.png'] } })],
  ]);
  const deps = { fetch, store, now: c.now };
  const t = await startGeneration({ extensionId: 'tripo-3d-generator', generator: generator('tripo-3d-generator', 'tripo-text-to-3d'), prompt: 'stone golem', scope: 'personal' }, KEY, deps);
  c.tick();
  const tv = await pollGeneration(t.id, KEY, deps);
  assert.equal(tv.status, 'succeeded', tv.error);
  assert.equal(tv.asset!.source, 'tripo');

  const r = await startGeneration({ extensionId: 'replicate-sprite-generator', generator: generator('replicate-sprite-generator', 'replicate-sprite'), prompt: 'slime monster', scope: 'personal' }, KEY, deps);
  c.tick();
  const rv = await pollGeneration(r.id, KEY, deps);
  assert.equal(rv.status, 'failed');
  assert.match(rv.error!, /will not download/);

  await assert.rejects(() => startGeneration({ extensionId: 'tripo-3d-generator', generator: generator('tripo-3d-generator', 'tripo-text-to-3d'), prompt: 'golem', scope: 'personal' }, '', deps), /API key/);
  const denied = fakeFetch([['POST', 'https://api.tripo3d.ai/', () => ({ status: 401, json: { message: `invalid ${KEY}` } })]]);
  await assert.rejects(
    () => startGeneration({ extensionId: 'tripo-3d-generator', generator: generator('tripo-3d-generator', 'tripo-text-to-3d'), prompt: 'golem', scope: 'personal' }, KEY, { ...deps, fetch: denied.fetch }),
    (e: any) => /rejected the API key/.test(e.message) && !e.message.includes(KEY)
  );
});

test('provider adapters never target hosts outside their own API', () => {
  for (const spec of Object.values(PROVIDERS)) {
    const g = { id: 'g1', title: 'g', provider: spec.id, output: spec.output, texture: true, sprite: true } as any;
    const req = spec.create({ prompt: 'a test prompt', generator: g }, KEY);
    assert.ok(spec.apiHosts.includes(new URL(req.url).hostname), spec.id);
  }
});
