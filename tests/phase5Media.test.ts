import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { playerClipFor, spriteFrameAt } from '../src/animation/spriteSheet';
import { createParticle2DRuntime, PARTICLE_2D_PRESETS } from '../src/vfx/particles2D';
import { activeCaptions, captionsFromScript, captionsToSRT, captionsToWebVTT, drawCaptionOnCanvas } from '../src/media/captions';
import { analyzePlayableBudget, buildZip, crc32, findExternalDependencies } from '../src/exporter/playableBundle';
import { generateStandaloneHTMLContent } from '../src/exporter/mediaExporter';
import { PLAYER_RUNTIME } from '../src/exporter/generated/playerRuntime';
import { createPlayerStore } from '../src/player/playerStore';
import { PLATFORMER_PHYSICS } from '../src/verification/sceneVerifier';
import { readFileSync } from 'node:fs';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { SpriteSheetSpec } from '../src/types/scene.schema';

const sheet: SpriteSheetSpec = {
  frameWidth: 32, frameHeight: 48, columns: 4, frameCount: 10, fps: 10,
  clips: { idle: { start: 0, end: 1 }, run: { start: 2, end: 7, fps: 20 }, jump: { start: 8, end: 9, loop: false } },
};

test('spritesheet frames, clips, looping and player clip selection', () => {
  assert.deepEqual(spriteFrameAt(sheet, 0), { index: 0, sx: 0, sy: 0, sw: 32, sh: 48 });
  assert.equal(spriteFrameAt(sheet, 0.55)!.index, 5);
  // run clip: frames 2..7 at 20 fps → t=0.5 is step 10 → 10 % 6 = 4 → frame 6 (column 2, row 1)
  assert.deepEqual(spriteFrameAt(sheet, 0.5, 'run'), { index: 6, sx: 64, sy: 48, sw: 32, sh: 48 });
  assert.equal(spriteFrameAt(sheet, 5, 'jump')!.index, 9, 'non-looping clip holds its last frame');
  assert.equal(spriteFrameAt(sheet, 1.05)!.index, 0, 'whole sheet loops');
  assert.equal(spriteFrameAt({ ...sheet, columns: 0 }, 1), null);
  assert.equal(playerClipFor(sheet, 0, true), 'idle');
  assert.equal(playerClipFor(sheet, 200, true), 'run');
  assert.equal(playerClipFor(sheet, 200, false), 'jump');
});

test('2D particles are deterministic, bounded and exportable', () => {
  const rt = createParticle2DRuntime();
  assert.deepEqual(rt.presets, PARTICLE_2D_PRESETS);
  for (const preset of rt.presets) {
    // t = 0.5 s is inside every preset's first emission window (pixel-burst pauses between bursts).
    const a = rt.particlesAt(preset, 7, 0.5, 200, 200);
    const b = rt.particlesAt(preset, 7, 0.5, 200, 200);
    assert.deepEqual(a, b, `${preset} deterministic`);
    assert.ok(a.length > 0 && a.length <= 420, `${preset} count ${a.length}`);
    assert.ok(a.every((p) => p.alpha >= 0 && p.alpha <= 1 && p.size > 0));
  }
  assert.notDeepEqual(rt.particlesAt('fire', 1, 1, 100, 100), rt.particlesAt('fire', 2, 1, 100, 100), 'seed changes the pattern');
  // pixel-burst repeats every life + pause (0.75 + 0.6 s)
  assert.equal(rt.particlesAt('pixel-burst', 3, 1.0, 100, 100).length, 0, 'pause between bursts');
  assert.equal(rt.particlesAt('pixel-burst', 3, 0.2, 100, 100).length, rt.particlesAt('pixel-burst', 3, 1.55, 100, 100).length);
  // Same `__name` shim the exporter defines (tsx/esbuild keepNames may inject it into toString output).
  const rebuilt = new Function(`var __name = function (f) { return f; }; return (${createParticle2DRuntime.toString()})();`)();
  assert.deepEqual(rebuilt.particlesAt('snow', 9, 2, 1000, 600), rt.particlesAt('snow', 9, 2, 1000, 600));
});

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: '',
    save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect() { calls.push('fillRect'); }, strokeText() { calls.push('strokeText'); },
    fillText(t: string) { calls.push(`fillText:${t}`); },
    measureText(t: string) { return { width: t.length * 10 }; },
  };
}

test('captions: lookup, wrapping, WebVTT / SRT and script splitting', () => {
  const caps = [
    { start: 2, end: 4, text: 'Second' },
    { start: 0, end: 2, text: 'First line', position: 'top' as const },
    { start: 5, end: 4, text: 'broken' },
  ];
  assert.deepEqual(activeCaptions(caps, 1).map((c) => c.text), ['First line']);
  assert.deepEqual(activeCaptions(caps, 2).map((c) => c.text), ['Second']);
  const vtt = captionsToWebVTT(caps);
  assert.match(vtt, /^WEBVTT\n\ncue-1\n00:00:00\.000 --> 00:00:02\.000 line:10%\nFirst line\n\ncue-2\n00:00:02\.000 --> 00:00:04\.000\nSecond\n$/);
  assert.match(captionsToSRT(caps, 10), /^1\n00:00:10,000 --> 00:00:12,000\nFirst line\n/);
  const ctx = fakeCtx();
  drawCaptionOnCanvas(ctx, { text: 'a very long caption that has to wrap across multiple lines on a narrow canvas' }, 300, 600);
  assert.ok(ctx.calls.filter((c) => c.startsWith('fillText')).length >= 2, 'wraps into several lines');
  const fromScript = captionsFromScript('Hello world. This is OmniStage! Ready?', 9);
  assert.equal(fromScript.length, 3);
  assert.equal(fromScript[2].end, 8.9);
});

test('budget: external dependencies and per-network limits', () => {
  const html = '<script src="mraid.js"></script><script src="https://cdn.example.com/x.js"></script><img src="data:image/png;base64,AA">';
  assert.deepEqual(findExternalDependencies(html), ['https://cdn.example.com/x.js']);
  const report = analyzePlayableBudget(html, 'meta');
  assert.equal(report.offlineReady, false);
  assert.equal(report.withinBudget, true);
  assert.equal(analyzePlayableBudget('x'.repeat(2 * 1024 * 1024 + 1), 'meta').withinBudget, false);
  assert.equal(analyzePlayableBudget('x', 'tiktok', 6 * 1024 * 1024).withinBudget, false, 'tiktok measures the zip');
});

function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, { method: number; data: Buffer }> = {};
  let o = 0;
  while (view.getUint32(o, true) === 0x04034b50) {
    const method = view.getUint16(o + 8, true);
    const crc = view.getUint32(o + 14, true);
    const size = view.getUint32(o + 18, true);
    const nameLen = view.getUint16(o + 26, true);
    const name = Buffer.from(bytes.slice(o + 30, o + 30 + nameLen)).toString('utf8');
    const raw = Buffer.from(bytes.slice(o + 30 + nameLen, o + 30 + nameLen + size));
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(crc32(new Uint8Array(data)), crc, `crc ${name}`);
    out[name] = { method, data };
    o += 30 + nameLen + size;
  }
  assert.equal(view.getUint32(o, true), 0x02014b50, 'central directory follows');
  return out;
}

test('ZIP bundles are DEFLATE-compressed, valid and fall back to stored', async () => {
  const big = 'OmniStage playable '.repeat(2000);
  const zipped = await buildZip([{ name: 'index.html', content: big }, { name: 'tiny.txt', content: 'a' }], { date: new Date(2026, 10, 10) });
  const entries = readZip(zipped);
  assert.equal(entries['index.html'].method, 8);
  assert.equal(entries['index.html'].data.toString('utf8'), big);
  assert.equal(entries['tiny.txt'].method, 0, 'incompressible entries stay stored');
  assert.ok(zipped.length < big.length / 10);
  const stored = readZip(await buildZip([{ name: 'index.html', content: big }], { compress: false }));
  assert.equal(stored['index.html'].method, 0);
});

test('offline playable: the Player export keeps particles, captions and spritesheets in the scene data, within the Meta budget', () => {
  const spec = { ...createBlankSceneSpec('2d'), mode: 'game' as const };
  spec.captions = [{ start: 0, end: 3, text: 'Collect the stars' }];
  spec.nodes2D.push({
    id: 'fx', name: 'FX', type: 'particle-emitter', x: 500, y: 300, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: 'transparent', stroke: '#fff', physics2D: 'none', emitter: { preset: 'confetti' },
  });
  const scene3d = createBlankSceneSpec('3d');
  const html = generateStandaloneHTMLContent(spec, 'meta', [spec, scene3d], { playerRuntimeSource: PLAYER_RUNTIME });
  const budget = analyzePlayableBudget(html, 'meta');
  assert.equal(budget.offlineReady, true, budget.notes.join('; '));
  assert.equal(budget.withinBudget, true);
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  assert.ok(html.includes('"preset":"confetti"') && html.includes('Collect the stars'));
});

test('verifier repairs invalid particle presets, spritesheets and captions', () => {
  const spec = createBlankSceneSpec('2d');
  spec.durationSeconds = 6;
  spec.nodes2D.push(
    { id: 'fx', name: 'FX', type: 'particle-emitter', x: 500, y: 300, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '', stroke: '', physics2D: 'none', emitter: { preset: 'lava' as any } },
    { id: 'spr', name: 'Sprite', type: 'sprite-actor', x: 300, y: 300, width: 64, height: 64, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '', stroke: '', physics2D: 'none', spriteSheet: { frameWidth: 0, frameHeight: 32, columns: 4, frameCount: 4, fps: 8 } }
  );
  spec.captions = [{ start: 1, end: 0.5, text: 'Backwards' }, { start: 9, end: 10, text: 'Too late' }, { start: 0, end: 1, text: 'Fine' }];
  const codes = verifySceneSpec(spec).issues.map((i) => i.code);
  assert.ok(codes.includes('2d.unknown-particle') && codes.includes('2d.invalid-spritesheet') && codes.includes('captions.invalid'), codes.join(','));
  const fixed = autoFixSceneSpec(spec);
  assert.equal(fixed.report.issues.length, 0, JSON.stringify(fixed.report.issues));
  assert.equal(fixed.spec.nodes2D.find((n) => n.id === 'fx')!.emitter!.preset, 'sparkle');
  assert.equal(fixed.spec.nodes2D.find((n) => n.id === 'spr')!.spriteSheet, undefined);
  assert.deepEqual(fixed.spec.captions!.map((c) => [c.text, c.end]), [['Backwards', 3], ['Fine', 1]]);
});

test('exported platformer physics are the studio physics (shared stage2d) and match the verifier envelope', () => {
  const stage = readFileSync(new URL('../src/runtime/stage2d.ts', import.meta.url), 'utf8');
  assert.ok(stage.includes(`b.vy = -${PLATFORMER_PHYSICS.jumpVelocity}`), 'jump velocity');
  const store = createPlayerStore([{ ...createBlankSceneSpec('2d'), mode: 'game' }]);
  assert.equal(store.getState().settings.physicsGravity * 90, PLATFORMER_PHYSICS.gravity, 'gravity');
  assert.ok(stage.includes('DESIGN_HEIGHT + 100'), 'pit falls respawn instead of an invisible floor');
});
