/**
 * Phase 10B — procedural soundtrack: deterministic PCM, audible layers, cue timing, film continuity, no clipping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENCE_IDS, autoAmbience, MUSIC_MOODS, renderFilmSoundtrack, renderSceneSoundtrack, renderSfxRecipe,
  renderSoundtrackLayers, resolveSoundtrack, soundtrackKey, windowRms,
} from '../src/audio/soundtrack';
import { BUILTIN_SFX_RECIPES } from '../src/audio/sfxRecipes';
import { createOmniSfxPlayer } from '../src/audio/sfxRuntime';
import { SFX_PRESET_IDS } from '../src/audio/audioBus';
import type { SoundtrackSpec, WorldSpec } from '../src/types/scene.schema';

const SR = 16000;
const scene = (soundtrack: SoundtrackSpec | undefined, durationSeconds = 6, world?: Partial<WorldSpec>) =>
  ({ id: 'scene-a', soundtrack, durationSeconds, world: world as WorldSpec });

function peakOf(pcm: { left: Float32Array; right: Float32Array }) {
  let p = 0;
  for (let i = 0; i < pcm.left.length; i++) p = Math.max(p, Math.abs(pcm.left[i]), Math.abs(pcm.right[i]));
  return p;
}

test('the live SFX player and the offline renderer share one recipe table', () => {
  assert.deepEqual(createOmniSfxPlayer().recipes, BUILTIN_SFX_RECIPES);
  assert.deepEqual(Object.keys(BUILTIN_SFX_RECIPES).sort(), [...SFX_PRESET_IDS].sort());
});

test('no soundtrack → null; same spec → identical samples', () => {
  assert.equal(renderSceneSoundtrack(scene(undefined), SR), null);
  const spec = scene({ music: { mood: 'adventure' }, ambience: { type: 'forest' }, cues: [{ time: 2, sfx: 'whoosh' }] });
  const a = renderSceneSoundtrack(spec, SR)!;
  const b = renderSceneSoundtrack(spec, SR)!;
  assert.equal(a.left.length, 6 * SR);
  assert.deepEqual(a.left, b.left);
  assert.deepEqual(a.right, b.right);
  assert.equal(soundtrackKey(spec), soundtrackKey(scene({ ...spec.soundtrack! })));
});

test('every mood and ambience renders audible, never clipping', () => {
  for (const mood of MUSIC_MOODS.filter((m) => m !== 'none')) {
    const pcm = renderSceneSoundtrack(scene({ music: { mood }, ambience: { type: 'none' } }, 8), SR)!;
    const level = windowRms(pcm, 1, 7);
    assert.ok(level > 0.02 && level < 0.4, `${mood} music level ${level}`);
    assert.ok(peakOf(pcm) <= 1, `${mood} peak`);
  }
  for (const type of AMBIENCE_IDS.filter((a) => a !== 'none' && a !== 'auto')) {
    const pcm = renderSceneSoundtrack(scene({ music: { mood: 'none' }, ambience: { type } }, 8), SR)!;
    const level = windowRms(pcm, 0.5, 7.5);
    assert.ok(level > 0.008 && level < 0.3, `${type} ambience level ${level}`);
    assert.ok(peakOf(pcm) <= 1, `${type} peak`);
  }
  const silent = renderSceneSoundtrack(scene({ music: { mood: 'none' }, ambience: { type: 'none' } }), SR)!;
  assert.equal(windowRms(silent, 0, 6), 0);
});

test('a cue lands at its time', () => {
  const layers = renderSoundtrackLayers(scene({ music: { mood: 'none' }, ambience: { type: 'none' }, cues: [{ time: 3, sfx: 'explosion' }] }), 6 * SR, SR)!;
  assert.ok(windowRms(layers.cues, 2.5, 2.99) === 0);
  assert.ok(windowRms(layers.cues, 3, 3.4) > 0.02);
  // unknown ids and out-of-range times are dropped
  assert.equal(resolveSoundtrack(scene({ cues: [{ time: 1, sfx: 'nope' }, { time: 9, sfx: 'pop' }, { time: 1, sfx: 'pop' }] }))!.cues.length, 1);
  assert.ok(renderSfxRecipe(BUILTIN_SFX_RECIPES.chime, SR).some((v) => Math.abs(v) > 0.05));
});

test('auto ambience follows the world', () => {
  assert.equal(autoAmbience({ features: [{ id: 'w', type: 'waterfall', position: [0, 0, -10] }] }), 'waterfall');
  assert.equal(autoAmbience({ biome: 'beach' }), 'beach');
  assert.equal(autoAmbience({ weather: { type: 'rain', intensity: 1 } }), 'rain');
  assert.equal(autoAmbience({ skybox: 'night-stars' } as Partial<WorldSpec>), 'night');
  assert.equal(autoAmbience({ terrain: { type: 'grassy-hills' } as WorldSpec['terrain'], scatterObjects: [{ id: 't', type: 'pine-trees', count: 10, spreadRadius: 20, scaleRange: [1, 1] }] }), 'forest');
  assert.equal(resolveSoundtrack(scene({ music: { mood: 'calm' } }, 6, { biome: 'meadow' }))!.ambience, 'meadow');
});

test('film: same-mood scenes continue the music sample-exactly across the cut', () => {
  const a = { id: 'a', durationSeconds: 3, soundtrack: { music: { mood: 'happy' as const }, ambience: { type: 'none' as const } }, sequence: { storyboardId: 'sb' } as any };
  const b = { ...a, id: 'b', durationSeconds: 4 };
  const film = renderFilmSoundtrack([a, b], SR);
  assert.equal(film.left.length, 7 * SR);
  const whole = renderSoundtrackLayers({ ...a, durationSeconds: 7 }, 7 * SR, SR, 0)!;
  // away from the global fades, the film equals one continuous render of the piece
  for (let i = Math.round(2.5 * SR); i < Math.round(3.5 * SR); i += 97) {
    const expected = whole.music.left[i] * 0.9;
    assert.ok(Math.abs(film.left[i] - expected) < 1e-3, `sample ${i}`);
  }
  // a mood change still sounds through the cut
  const c = { ...b, id: 'c', soundtrack: { music: { mood: 'tense' as const }, ambience: { type: 'none' as const } } };
  const changed = renderFilmSoundtrack([a, c], SR);
  assert.ok(windowRms(changed, 3.6, 6) > 0.02);
  assert.ok(peakOf(changed) <= 1);
});
