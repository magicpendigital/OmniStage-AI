import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import {
  applyEase,
  EASE_IDS,
  EASING_RUNTIME_SOURCE,
  easedSplineProgress,
  sampleKeyframes,
} from '../src/animation/easing';
import { createOmniSfxPlayer } from '../src/audio/sfxRuntime';
import { cueFor, detectAudioEvents, resolveAudioSpec, SFX_PRESET_IDS } from '../src/audio/audioBus';

test('every ease starts at 0 and ends at 1', () => {
  for (const id of EASE_IDS) {
    assert.ok(Math.abs(applyEase(id, 0)) < 1e-9, `${id}(0)`);
    assert.ok(Math.abs(applyEase(id, 1) - 1) < 1e-9, `${id}(1)`);
  }
  assert.equal(applyEase('nope', 0.3), 0.3, 'unknown ease falls back to linear');
});

test('exported easing runtime matches the studio implementation', () => {
  // Test-only evaluation of the exporter's inline source (the app itself never evals strings).
  const omniEase = new Function(`${EASING_RUNTIME_SOURCE}; return OMNI_EASE;`)() as (n: string, t: number) => number;
  for (const id of EASE_IDS) {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      assert.ok(Math.abs(omniEase(id, t) - applyEase(id, t)) < 1e-12, `${id} @ ${t}`);
    }
  }
});

test('keyframe sampling honours time and the outgoing ease', () => {
  const keys = [
    { time: 2, x: 100, ease: 'power3.out' as const },
    { time: 0, x: 0 },
    { time: 4, x: 200 },
  ];
  const mid = sampleKeyframes(keys, 1)!;
  assert.equal(mid.from.x, 0);
  assert.equal(mid.progress, 0.5, 'linear segment');
  const eased = sampleKeyframes(keys, 3)!;
  assert.equal(eased.from.x, 100);
  assert.ok(eased.progress > 0.9, 'power3.out front-loads motion');
  assert.equal(sampleKeyframes(keys, 99)!.progress, 1);
  assert.equal(easedSplineProgress(keys, 2), 0.5);
  assert.equal(easedSplineProgress(keys, 1), 0.25);
});

test('sfx player is self-contained, lists every preset and no-ops without WebAudio', () => {
  const player = createOmniSfxPlayer();
  assert.deepEqual([...player.presets].sort(), [...SFX_PRESET_IDS].sort());
  assert.doesNotThrow(() => player.play('coin'));
  // The exporter inlines the function via toString(); it must not reference outer module bindings.
  const rebuilt = new Function(`var __name = function (f) { return f; }; return (${createOmniSfxPlayer.toString()})();`)();
  assert.deepEqual(rebuilt.presets, player.presets);
});

test('audio defaults: on for game, off for media; explicit cues override', () => {
  const spec = createBlankSceneSpec('2d');
  assert.equal(cueFor({ ...spec, mode: 'media' }, 'collect'), null);
  assert.equal(cueFor({ ...spec, mode: 'game' }, 'collect'), 'coin');
  const custom = { ...spec, mode: 'game' as const, audio: { enabled: true, masterVolume: 2, cues: { collect: 'powerup' as const, jump: 'none' as const } } };
  assert.equal(cueFor(custom, 'collect'), 'powerup');
  assert.equal(cueFor(custom, 'jump'), null);
  assert.equal(resolveAudioSpec(custom).masterVolume, 1);
});

test('store transitions map to audio events', () => {
  const spec = { ...createBlankSceneSpec('2d'), mode: 'game' as const };
  const base = { sceneSpec: spec, gameScore: 0, gameWon: false, gameEnded: false, gameTimeRemaining: 30, isPlaying: true, currentTime: 1 };
  assert.deepEqual(detectAudioEvents(base, { ...base, gameScore: 25 }), ['collect']);
  assert.deepEqual(detectAudioEvents({ ...base, gameScore: 25 }, { ...base, gameScore: 50, gameWon: true, gameEnded: true }), ['collect', 'win']);
  assert.deepEqual(detectAudioEvents({ ...base, gameScore: 30 }, { ...base, gameScore: 20 }), ['hit']);
  assert.deepEqual(detectAudioEvents(base, { ...base, gameEnded: true, gameTimeRemaining: 0 }), ['lose']);
  // Reset (score back to 0, timer refilled) is silent.
  assert.deepEqual(detectAudioEvents({ ...base, gameScore: 50, gameTimeRemaining: 3 }, { ...base, gameScore: 0, gameTimeRemaining: 30 }), []);
  assert.deepEqual(detectAudioEvents({ ...base, isPlaying: false, currentTime: 0 }, { ...base, currentTime: 0 }), ['scene-start']);
});

test('standalone playable export embeds SFX + easing runtimes and compiles', async () => {
  const { generateStandaloneHTMLContent } = await import('../src/exporter/mediaExporter');
  const spec = { ...createBlankSceneSpec('2d'), mode: 'game' as const };
  spec.nodes2D[2].keyframeTrack = [{ time: 0, x: 600, y: 380, ease: 'back.out' }, { time: 2, x: 700, y: 380 }];
  spec.audio = { enabled: true, masterVolume: 0.5, cues: { collect: 'powerup' } };
  const html = generateStandaloneHTMLContent(spec, 'universal', [spec]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const source of scripts) assert.doesNotThrow(() => new Function(source), 'inline script must parse');
  assert.ok(html.includes('OMNI_SFX') && html.includes('OMNI_EASE') && html.includes('keyframedPosition2D'));
});
