import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Throwaway workspace for this file.
process.env.OMNISTAGE_HOME = mkdtempSync(join(tmpdir(), 'omnistage-gen-'));
for (const k of ['MESHY_API_KEY', 'TRIPO_API_KEY', 'FAL_KEY', 'REPLICATE_API_TOKEN', 'RODIN_API_KEY', 'OPENROUTER_API_KEY', 'ELEVENLABS_API_KEY']) delete process.env[k];

const { PROVIDERS, ANY_PUBLIC_HOST, cleanPrompt, safeUrl, spritePrompt, upstreamErrorMessage } = await import('../server/generate/providers');
const { startGeneration, pollGeneration, sniffResult, sheetMeta, _resetGenerationJobs, MIN_POLL_MS } = await import('../server/generate/jobs');
const { availableGenerators, resolveGenerator, readSourceImage } = await import('../server/generate/routes');
const { generationKeyFor, spriteSheetFromMeta } = await import('../src/extensions/generationHelpers');
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

interface Call { url: string; method: string; headers: Record<string, string>; body?: any; form?: FormData }

/** Fake upstream: routes by method + URL prefix, records every call. */
function fakeFetch(routes: Array<[string, string, (call: Call) => { status?: number; json?: unknown; bytes?: Buffer }]>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: any) => {
    const form = init.body instanceof FormData ? init.body : undefined;
    const call: Call = { url, method: init.method, headers: init.headers, form, body: init.body && !form ? JSON.parse(init.body) : undefined };
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
  for (const id of ['meshy-3d-generator', 'tripo-3d-generator', 'rodin-3d-generator', 'fal-sprite-generator', 'replicate-sprite-generator', 'openrouter-image-generator', 'elevenlabs-audio-generator']) {
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
  assert.deepEqual(gens.map((g) => g.id), ['meshy-text-to-3d', 'meshy-text-to-mesh', 'meshy-image-to-3d']);
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

/** PNG header with a real IHDR (width × height) so sprite-sheet cells can be measured. */
function pngOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(64, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(80, 3)]);

/** Sync providers finish in the background; poll until the job settles. */
async function settle(id: string, deps: any) {
  for (let i = 0; i < 50; i++) {
    const v = await pollGeneration(id, KEY, deps);
    if (v.status !== 'running') return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job never settled');
}

test('Rodin: multipart create → status by subscription key → GLB from any public host, key never sent there', async () => {
  _resetGenerationJobs();
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const c = clock();
  let polls = 0;
  const { fetch, calls } = fakeFetch([
    ['POST', 'https://api.hyper3d.com/api/v2/rodin', () => ({ json: { uuid: 'rodin-task-1', jobs: { uuids: ['a', 'b'], subscription_key: 'sub-key-123' } } })],
    ['POST', 'https://api.hyper3d.com/api/v2/status', () => (++polls < 2 ? { json: { jobs: [{ uuid: 'a', status: 'Done' }, { uuid: 'b', status: 'Generating' }] } } : { json: { jobs: [{ uuid: 'a', status: 'Done' }, { uuid: 'b', status: 'Done' }] } })],
    ['POST', 'https://api.hyper3d.com/api/v2/download', () => ({ json: { list: [{ name: 'preview.webp', url: 'https://cdn.hyper3d-files.example/p.webp' }, { name: 'base_basic_pbr.glb', url: 'https://cdn.hyper3d-files.example/m.glb' }] } })],
    ['GET', 'https://cdn.hyper3d-files.example/m.glb', () => ({ bytes: GLB })],
  ]);
  const deps = { fetch, store, now: c.now };
  const job = await startGeneration({ extensionId: 'rodin-3d-generator', generator: generator('rodin-3d-generator', 'rodin-text-to-3d'), prompt: 'bronze robot', scope: 'personal' }, KEY, deps);
  assert.ok(calls[0].form, 'Rodin create is multipart');
  assert.equal(calls[0].form!.get('prompt'), 'bronze robot');
  assert.equal(calls[0].form!.get('geometry_file_format'), 'glb');
  assert.equal(calls[0].form!.get('material'), 'PBR');
  c.tick();
  let v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.status, 'running');
  assert.deepEqual(calls.at(-1)!.body, { subscription_key: 'sub-key-123' });
  c.tick();
  v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.status, 'succeeded', v.error);
  assert.equal(v.asset!.source, 'rodin');
  assert.deepEqual(calls.find((x) => x.url.endsWith('/download'))!.body, { task_uuid: 'rodin-task-1' });
  assert.ok(!calls.some((x) => x.url.startsWith('https://cdn.hyper3d-files.example') && x.headers.Authorization), 'no key to the CDN');
  assert.equal(JSON.stringify(v).includes('sub-key-123'), false, 'the subscription key stays server-side');

  // Picture → 3D sends the picture as a form file.
  const img = await startGeneration({ extensionId: 'rodin-3d-generator', generator: generator('rodin-3d-generator', 'rodin-image-to-3d'), prompt: '', scope: 'personal', image: { data: PNG, mime: 'image/png' } }, KEY, deps);
  assert.equal(img.status, 'running');
  const file = calls.at(-1)!.form!.get('images') as File;
  assert.equal(file.name, 'reference.png');
  assert.equal(file.type, 'image/png');
  assert.equal(calls.at(-1)!.form!.get('prompt'), null);
});

test('safeUrl: "*" allows any public https host but still blocks private names, IPs, ports and http', () => {
  assert.equal(ANY_PUBLIC_HOST, '*');
  assert.ok(safeUrl('https://files.some-cdn.com/x.glb', ['*']));
  for (const bad of ['http://files.some-cdn.com/x', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://printer.local/x', 'https://nas.lan/x', 'https://intranet/x', 'https://cdn.example.com:444/x', 'https://u:p@cdn.example.com/x']) {
    assert.equal(safeUrl(bad, ['*']), null, bad);
  }
});

test('Meshy picture → 3D uses the v1 image endpoint with a data URI and polls it there', async () => {
  _resetGenerationJobs();
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const c = clock();
  const { fetch, calls } = fakeFetch([
    ['POST', 'https://api.meshy.ai/openapi/v1/image-to-3d', () => ({ json: { result: 'img-task-1' } })],
    ['GET', 'https://api.meshy.ai/openapi/v1/image-to-3d/img-task-1', () => ({ json: { status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/img.glb' } } })],
    ['GET', 'https://assets.meshy.ai/img.glb', () => ({ bytes: GLB })],
  ]);
  const deps = { fetch, store, now: c.now };
  await assert.rejects(() => startGeneration({ extensionId: 'meshy-3d-generator', generator: generator('meshy-3d-generator', 'meshy-image-to-3d'), prompt: '', scope: 'personal' }, KEY, deps), /picture/);
  const job = await startGeneration({ extensionId: 'meshy-3d-generator', generator: generator('meshy-3d-generator', 'meshy-image-to-3d'), prompt: '', scope: 'personal', image: { data: PNG, mime: 'image/png' } }, KEY, deps);
  assert.match(calls[0].body.image_url, /^data:image\/png;base64,/);
  assert.equal(job.stage, 'image');
  c.tick();
  const v = await pollGeneration(job.id, KEY, deps);
  assert.equal(v.status, 'succeeded', v.error);
  assert.ok(v.asset!.tags.includes('from-image'));
  assert.equal(JSON.stringify(v).includes(PNG.toString('base64')), false, 'the picture is not kept in the job');
});

test('OpenRouter: one-shot base64 image → animated sprite sheet with cell metadata', async () => {
  _resetGenerationJobs();
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const sheet = pngOf(1024, 256);
  const { fetch, calls } = fakeFetch([['POST', 'https://openrouter.ai/api/v1/images', () => ({ json: { data: [{ b64_json: sheet.toString('base64') }] } })]]);
  const deps = { fetch, store, now: Date.now };
  const job = await startGeneration({ extensionId: 'openrouter-image-generator', generator: generator('openrouter-image-generator', 'openrouter-sprite-sheet'), prompt: 'fox knight walking', scope: 'personal' }, KEY, deps);
  const v = await settle(job.id, deps);
  assert.equal(v.status, 'succeeded', v.error);
  assert.equal(calls.length, 1, 'sync providers are never polled upstream');
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].body.model, 'google/gemini-2.5-flash-image');
  assert.match(calls[0].body.prompt, /exactly 4 animation frames/);
  assert.equal(v.asset!.kind, 'spritesheet');
  assert.ok(v.asset!.tags.includes('animated'));
  assert.deepEqual(v.asset!.meta!.spriteSheet, { frameWidth: 256, frameHeight: 256, columns: 4, frameCount: 4, fps: 8, loop: true });
  assert.equal(v.asset!.meta!.taskId, undefined);

  const empty = fakeFetch([['POST', 'https://openrouter.ai/', () => ({ json: { choices: [{ message: { content: 'sorry' } }] } })]]);
  const deps2 = { ...deps, fetch: empty.fetch };
  const j2 = await startGeneration({ extensionId: 'openrouter-image-generator', generator: generator('openrouter-image-generator', 'openrouter-image'), prompt: 'castle backdrop', scope: 'personal' }, KEY, deps2);
  const v2 = await settle(j2.id, deps2);
  assert.equal(v2.status, 'failed');
  assert.match(v2.error!, /no image/);
});

test('ElevenLabs: binary MP3 → audio asset tagged sfx / music with a licence record', async () => {
  _resetGenerationJobs();
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'library'));
  const { fetch, calls } = fakeFetch([['POST', 'https://api.elevenlabs.io/', () => ({ bytes: MP3 })]]);
  const deps = { fetch, store, now: Date.now };
  const start = (genId: string, prompt: string, d: any = deps) =>
    startGeneration({ extensionId: 'elevenlabs-audio-generator', generator: generator('elevenlabs-audio-generator', genId), prompt, scope: 'personal' }, KEY, d);
  const sfx = await settle((await start('elevenlabs-sfx', 'coin pickup chime')).id, deps);
  assert.equal(sfx.status, 'succeeded', sfx.error);
  assert.equal(calls[0].headers['xi-api-key'], KEY);
  assert.equal(sfx.asset!.kind, 'audio');
  assert.ok(sfx.asset!.file.endsWith('.mp3'));
  assert.ok(sfx.asset!.tags.includes('sfx'));
  assert.equal(sfx.asset!.meta!.audioKind, 'sfx');
  assert.ok(sfx.asset!.meta!.licence);
  const music = await settle((await start('elevenlabs-music', 'upbeat chiptune loop')).id, deps);
  assert.equal(music.status, 'succeeded', music.error);
  assert.ok(music.asset!.tags.includes('music'));
  assert.equal(music.asset!.meta!.audioKind, 'music');
  assert.equal(JSON.stringify([sfx, music]).includes(KEY), false);

  const html = fakeFetch([['POST', 'https://api.elevenlabs.io/', () => ({ bytes: Buffer.from('<html>nope</html>') })]]);
  const deps2 = { ...deps, fetch: html.fetch };
  const bad = await settle((await start('elevenlabs-sfx', 'boom', deps2)).id, deps2);
  assert.equal(bad.status, 'failed');
  assert.match(bad.error!, /unexpected file/);
});

test('generator manifests reject bad input / frames / audio / duration combinations', () => {
  const base = catalog('fal-sprite-generator');
  const withGen = (g: any) => validateManifest({ ...base, contributes: { generators: [{ id: 'g1', title: 'G', ...g }] } });
  assert.ok(withGen({ provider: 'fal', output: 'image', input: 'image' }).length, 'fal has no picture input');
  assert.ok(withGen({ provider: 'fal', output: 'image', input: 'video' }).length);
  assert.ok(withGen({ provider: 'fal', output: 'image', frames: 1 }).length);
  assert.ok(withGen({ provider: 'fal', output: 'image', frames: 9 }).length);
  assert.ok(withGen({ provider: 'meshy', output: 'model', frames: 4 }).length, 'frames only for images');
  assert.ok(withGen({ provider: 'elevenlabs', output: 'audio', audio: 'speech' }).length);
  assert.ok(withGen({ provider: 'elevenlabs', output: 'audio', durationSeconds: 900 }).length);
  assert.ok(withGen({ provider: 'fal', output: 'image', audio: 'sfx' }).length, 'audio only for audio');
  assert.deepEqual(withGen({ provider: 'meshy', output: 'model', input: 'image' }), []);
  assert.deepEqual(withGen({ provider: 'fal', output: 'image', frames: 6 }), []);
});

test('readSourceImage only hands real pictures from the library to image-to-3D', async () => {
  const store = new AssetStore(join(process.env.OMNISTAGE_HOME!, 'src-images'));
  const pic = await store.add({ filename: 'hero.png', data: PNG, kind: 'image' });
  const out = await readSourceImage(store, pic.id);
  assert.equal(out.mime, 'image/png');
  assert.deepEqual(out.data, PNG);
  const model = await store.add({ filename: 'm.glb', data: GLB, kind: 'model' });
  await assert.rejects(() => readSourceImage(store, model.id), /not a picture/);
  const fake = await store.add({ filename: 'fake.png', data: Buffer.from('<svg/>'.padEnd(80, ' ')), kind: 'image' });
  await assert.rejects(() => readSourceImage(store, fake.id), /PNG, JPEG or WebP/);
  await assert.rejects(() => readSourceImage(store, undefined), /Pick a picture/);
});

test('sprite-sheet meta and studio helpers', () => {
  const cell = { frameWidth: 192, frameHeight: 192, columns: 4, frameCount: 4, fps: 8, loop: true };
  assert.deepEqual(sheetMeta(pngOf(768, 192), 4), cell);
  assert.equal(sheetMeta(Buffer.from('nope'), 4), undefined);
  assert.deepEqual(spriteSheetFromMeta({ spriteSheet: cell }), cell);
  assert.equal(spriteSheetFromMeta({ spriteSheet: { columns: 1, rows: 1 } }), undefined);
  assert.equal(spriteSheetFromMeta({ spriteSheet: { frameWidth: -1, frameHeight: 'x', columns: 4, frameCount: 4 } }), undefined);
  assert.equal(spriteSheetFromMeta(undefined), undefined);
  assert.equal(generationKeyFor({ generationKeys: { openrouter: ' own ' }, aiApiKeys: { openrouter: 'ai' } } as any, 'openrouter'), 'own');
  assert.equal(generationKeyFor({ aiApiKeys: { openrouter: 'ai' } } as any, 'openrouter'), 'ai');
  assert.equal(generationKeyFor({ elevenLabsApiKey: 'el' } as any, 'elevenlabs'), 'el');
  assert.equal(generationKeyFor({ aiApiKeys: { openrouter: 'ai' } } as any, 'meshy'), '');
});
