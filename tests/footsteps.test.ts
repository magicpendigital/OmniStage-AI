import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { footstepCues } from '../src/audio/footsteps';
import { resolveSoundtrack, renderSceneSoundtrack, windowRms } from '../src/audio/soundtrack';
import { actorHeight } from '../src/runtime/cinematics';
import type { SceneSpec } from '../src/types/scene.schema';

function walkFilm(moveTo: [number, number, number] = [0, 0, 6], duration = 3): SceneSpec {
  const spec = createBlankSceneSpec('3d', 'Walk');
  spec.mode = 'media';
  spec.durationSeconds = 8;
  const a = { ...spec.actors[0], id: 'hero', position: [0, 0, 0] as [number, number, number], performance: [{ time: 1, moveTo, duration }] };
  spec.actors = [a];
  spec.soundtrack = { music: { mood: 'none' }, ambience: { type: 'none' } };
  return spec;
}

test('footsteps: one step per half stride, only while walking', () => {
  const spec = walkFilm();
  const steps = footstepCues(spec);
  const stride = actorHeight(spec.actors[0]) * 0.4;
  assert.ok(steps.length > 0);
  assert.ok(steps.every((s) => s.time >= 1 - 1e-6 && s.time <= 4.05), JSON.stringify(steps.map((s) => s.time)));
  // 6 m of walking + the first contact + the settling step.
  const expected = Math.floor(6 / stride) + 2;
  assert.ok(Math.abs(steps.length - expected) <= 1, `${steps.length} vs ${expected}`);
  assert.ok(steps[0].time < 1.05, 'first contact as the walk starts');
  // Eased walk: steps are further apart at the start than in the middle.
  const gaps = steps.slice(1).map((s, i) => s.time - steps[i].time);
  const mid = gaps[Math.floor(gaps.length / 2)];
  assert.ok(gaps[1] > mid, `start gap ${gaps[1]} > middle gap ${mid}`);
  assert.deepEqual(footstepCues(spec), steps, 'deterministic');
});

test('footsteps: a run steps faster than a walk; games, props and stills stay silent', () => {
  const walk = footstepCues(walkFilm([0, 0, 4], 3));
  const run = footstepCues(walkFilm([0, 0, 12], 3));
  const rate = (s: typeof walk) => s.length / 3;
  assert.ok(rate(run) > rate(walk));
  assert.ok(run[3].volume > walk[3].volume, 'runs are louder');
  assert.equal(footstepCues({ ...walkFilm(), mode: 'game' }).length, 0);
  const prop = walkFilm();
  prop.actors = [{ ...prop.actors[0], assetId: 'sports-sneaker-pro' }];
  // A product never walks.
  assert.equal(footstepCues(prop).length, 0);
  const still = walkFilm();
  still.actors = [{ ...still.actors[0], performance: [{ time: 1, lookAt: [0, 0, 5] }] }];
  assert.equal(footstepCues(still).length, 0);
});

test('soundtrack: footsteps are mixed in, can be switched off, and replace authored footsteps on the same beat', () => {
  const spec = walkFilm();
  const auto = resolveSoundtrack(spec)!;
  const n = footstepCues(spec).length;
  assert.equal(auto.cues.length, n);
  const off = resolveSoundtrack({ ...spec, soundtrack: { ...spec.soundtrack!, footsteps: false } })!;
  assert.equal(off.cues.length, 0);
  const first = footstepCues(spec)[0].time;
  const authored = resolveSoundtrack({ ...spec, soundtrack: { ...spec.soundtrack!, cues: [{ time: first + 0.05, sfx: 'footstep' }, { time: 6, sfx: 'chime' }] } })!;
  assert.equal(authored.cues.length, n + 1, 'doubled footstep dropped, chime kept');
  const pcm = renderSceneSoundtrack(spec)!;
  assert.ok(windowRms(pcm, 1.5, 3.5) > 0.001, 'walking is audible');
  assert.ok(windowRms(pcm, 5, 7.9) < 1e-6, 'standing still is silent');
});
