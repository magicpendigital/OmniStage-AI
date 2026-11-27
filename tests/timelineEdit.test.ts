import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { deriveTimeline } from '../src/runtime/timelineLanes';
import { applyClipEdit, clipSourceId, dragWindow, MIN_CLIP_SECONDS, nudgeWindow, snapTargets, snapTime } from '../src/runtime/timelineEdit';
import { verifySceneSpec } from '../src/verification/sceneVerifier';
import { useStudioStore } from '../src/state/useStudioStore';
import type { SceneSpec } from '../src/types/scene.schema';

function film(): SceneSpec {
  const s = createBlankSceneSpec('3d');
  s.mode = 'media';
  s.durationSeconds = 10;
  const hero = s.actors[0] ?? ({ id: 'hero', name: 'Hero', primaryColor: '#ff8800' } as never);
  if (!s.actors.length) s.actors.push(hero);
  hero.performance = [
    { time: 0, clip: 'Idle', label: 'waits' },
    { time: 2, moveTo: [2, 0, 0], duration: 3 },
    { time: 6, animation: 'wave' as never },
  ];
  s.camera.shots = [
    { start: 4, type: 'close-up' },
    { start: 0, type: 'wide', end: 3 },
  ];
  s.captions = [{ start: 1, end: 3, text: 'hello' }];
  s.actors.push({ ...hero, id: 'friend', name: 'Friend', performance: undefined } as never);
  s.dialogue = [{ id: 'l1', time: 5, speaker: hero.id, text: 'Hi there' }];
  s.soundtrack = { music: { mood: 'calm' }, cues: [{ time: 2.5, sfx: 'chime' }] };
  s.vfx = [{ id: 'fx1', name: 'Sparkles', type: 'sparkles' as never, position: [0, 0, 0], color: '#ffee88', intensity: 1, startTime: 3, endTime: 5 }];
  s.grade = { preset: 'warm' };
  return s;
}

const clipOf = (spec: SceneSpec, laneId: string, index = 0) => deriveTimeline(spec).find((l) => l.id === laneId)!.clips[index];

test('every editable clip names its source and what it allows; music, ambience and look stay fixed', () => {
  const lanes = deriveTimeline(film());
  for (const lane of lanes) {
    for (const c of lane.clips) {
      if (['music', 'ambience', 'look'].includes(lane.kind)) assert.ok(!c.source && !c.edit, `${lane.id} is not editable`);
      else assert.ok(c.source && c.edit?.move, `${lane.id}/${c.id} can at least move`);
    }
  }
  const hero = film().actors[0].id;
  const perf = lanes.find((l) => l.id === `actor-${hero}`)!.clips;
  assert.deepEqual(perf.map((c) => c.edit?.end), [false, true, false], 'only the walking step has an adjustable length');
  const caps = lanes.find((l) => l.id === 'captions')!.clips;
  assert.equal(caps.find((c) => c.source?.kind === 'caption')!.edit!.end, true, 'an authored caption resizes');
  assert.equal(caps.find((c) => c.source?.kind === 'dialogue')!.edit!.end, false, 'a dialogue caption only moves with its line');
  const shots = lanes.find((l) => l.id === 'shots')!.clips;
  assert.deepEqual(shots.map((c) => (c.source as { index: number }).index), [1, 0], 'sources point at the original array, not the sorted order');
  assert.equal(new Set(lanes.flatMap((l) => l.clips.map((c) => c.source && clipSourceId(c.source)))).size > 5, true);
});

test('dragWindow: a move keeps the length, stays inside the scene and snaps to the closest edge; edges keep a minimum length', () => {
  const orig = { start: 2, end: 4 };
  assert.deepEqual(dragWindow(orig, 'move', 1.04, 10), { start: 3.04, end: 5.04 });
  assert.deepEqual(dragWindow(orig, 'move', -9, 10), { start: 0, end: 2 }, 'cannot leave the scene on the left');
  assert.deepEqual(dragWindow(orig, 'move', 99, 10), { start: 8, end: 10 }, 'nor on the right, and the length survives');
  const snap = { targets: [0, 6, 10], threshold: 0.2 };
  assert.deepEqual(dragWindow(orig, 'move', 1.9, 10, snap), { start: 4, end: 6 }, 'the END edge snaps onto 6');
  assert.deepEqual(dragWindow({ start: 2, end: 4 }, 'move', 3.9, 10, snap), { start: 6, end: 8 }, 'the START edge snaps onto 6');
  assert.equal(dragWindow(orig, 'start', 5, 10).start, 4 - MIN_CLIP_SECONDS, 'the start edge stops before the end');
  assert.equal(dragWindow(orig, 'end', -5, 10).end, 2 + MIN_CLIP_SECONDS, 'the end edge stops after the start');
  assert.equal(dragWindow(orig, 'end', 50, 10).end, 10);
  assert.deepEqual(dragWindow(orig, 'move', 0.5, 10), dragWindow(orig, 'move', 0.5, 10), 'idempotent from the same origin');
  assert.deepEqual(nudgeWindow({ start: 1, end: 2 }, 0.1, 10), { start: 1.1, end: 2.1 });
});

test('snapTime prefers a target within the threshold, else the grid; snapTargets leaves out the dragged clip and fixed lanes', () => {
  assert.equal(snapTime(4.93, [5], 0.15), 5);
  assert.equal(snapTime(4.8, [5], 0.15, 0.1), 4.8);
  assert.equal(snapTime(4.83, [], 0.15, 0.1), 4.8);
  assert.equal(snapTime(4.83, [], 0.15, 0), 4.83);
  const spec = film();
  const lanes = deriveTimeline(spec);
  const own = lanes.find((l) => l.id === 'shots')!.clips[0];
  const t = snapTargets(lanes, own.id, 7.25, 10);
  assert.ok(t.includes(0) && t.includes(10) && t.includes(7.25), 'scene edges and playhead');
  assert.ok(t.includes(5), 'the VFX end is a target');
  assert.ok(!t.includes(own.end) || lanes.some((l) => l.clips.some((c) => c.id !== own.id && (c.start === own.end || c.end === own.end))), 'own edges are not targets');
});

test('applyClipEdit writes each source back to the field it is derived from', () => {
  const spec = film();
  const hero = spec.actors[0];
  // shot: the lane clip at sorted position 0 is shots[1]
  const wide = clipOf(spec, 'shots', 0);
  assert.ok(applyClipEdit(spec, wide.source!, { start: 0.5, end: 3.5 }));
  assert.deepEqual([spec.camera.shots![1].start, spec.camera.shots![1].end], [0.5, 3.5]);
  // step: a walk changes its time and its duration, a hold only its time
  const walk = clipOf(spec, `actor-${hero.id}`, 1);
  assert.ok(applyClipEdit(spec, walk.source!, { start: 2.5, end: 5 }, 'end'));
  assert.deepEqual([hero.performance![1].time, hero.performance![1].duration], [2.5, 2.5]);
  const wave = clipOf(spec, `actor-${hero.id}`, 2);
  assert.ok(applyClipEdit(spec, wave.source!, { start: 7, end: 9 }));
  assert.equal(hero.performance![2].time, 7);
  assert.equal(hero.performance![2].duration, undefined, 'a step without a walk never gets a duration');
  // authored caption: both ends
  const cap = deriveTimeline(spec).find((l) => l.id === 'captions')!.clips.find((c) => c.source?.kind === 'caption')!;
  assert.ok(applyClipEdit(spec, cap.source!, { start: 1.5, end: 4 }));
  assert.deepEqual([spec.captions![0].start, spec.captions![0].end], [1.5, 4]);
  // dialogue caption: moves its line
  const dlg = deriveTimeline(spec).find((l) => l.id === 'captions')!.clips.find((c) => c.source?.kind === 'dialogue')!;
  assert.ok(applyClipEdit(spec, dlg.source!, { start: 6, end: 8 }));
  assert.equal(spec.dialogue![0].time, 6);
  // sound cue and VFX
  assert.ok(applyClipEdit(spec, clipOf(spec, 'sfx').source!, { start: 3.2, end: 3.6 }));
  assert.equal(spec.soundtrack!.cues![0].time, 3.2);
  assert.ok(applyClipEdit(spec, clipOf(spec, 'vfx-fx1').source!, { start: 4, end: 9 }));
  assert.deepEqual([spec.vfx[0].startTime, spec.vfx[0].endTime], [4, 9]);
  // stale or foreign sources and no-ops are refused
  assert.equal(applyClipEdit(spec, { kind: 'shot', index: 99 }, { start: 0, end: 1 }), false);
  assert.equal(applyClipEdit(spec, { kind: 'vfx', id: 'nope' }, { start: 0, end: 1 }), false);
  assert.equal(applyClipEdit(spec, clipOf(spec, 'vfx-fx1').source!, { start: 4, end: 9 }), false, 'writing the same window changes nothing');
  // out-of-range input is clamped into the scene
  assert.ok(applyClipEdit(spec, clipOf(spec, 'vfx-fx1').source!, { start: -5, end: 99 }));
  assert.deepEqual([spec.vfx[0].startTime, spec.vfx[0].endTime], [0, 10]);
});

test('an edited timeline still verifies: a dragged scene keeps its shots, captions and cues in range', () => {
  const spec = film();
  const hero = spec.actors[0].id;
  for (const lane of deriveTimeline(spec)) {
    for (const c of lane.clips) if (c.source && c.edit) applyClipEdit(spec, c.source, { start: c.start + 0.3, end: c.end + 0.3 });
  }
  const errors = verifySceneSpec(spec).issues.filter((i) => i.severity === 'error' && /shot|caption|cue|performance|vfx/i.test(`${i.code} ${i.message}`));
  assert.deepEqual(errors, [], `no timing errors after nudging every clip (${hero})`);
});

test('editTimelineClip: the store writes the clip back, one drag is one undo step, an impossible edit is a no-op (Phase 6B)', () => {
  const store = useStudioStore.getState();
  store.createNewBlankScene('3d', 'Timeline edit');
  const spec = film();
  useStudioStore.getState().setSceneSpec(spec);
  const source = clipOf(spec, 'vfx-fx1').source!;
  const before = useStudioStore.getState().pastSpecs.length;
  useStudioStore.getState().editTimelineClip(source, { start: 3.5, end: 5.5 });
  useStudioStore.getState().editTimelineClip(source, { start: 4, end: 6 });
  useStudioStore.getState().editTimelineClip(source, { start: 4.5, end: 6.5 });
  const now = useStudioStore.getState();
  assert.deepEqual([now.sceneSpec.vfx[0].startTime, now.sceneSpec.vfx[0].endTime], [4.5, 6.5]);
  assert.equal(now.pastSpecs.length - before, 1, 'a burst of drag updates is a single undo entry');
  const len = now.pastSpecs.length;
  useStudioStore.getState().editTimelineClip({ kind: 'vfx', id: 'missing' }, { start: 1, end: 2 });
  assert.equal(useStudioStore.getState().pastSpecs.length, len, 'a stale source pushes no history');
  useStudioStore.getState().undo();
  assert.deepEqual([useStudioStore.getState().sceneSpec.vfx[0].startTime, useStudioStore.getState().sceneSpec.vfx[0].endTime], [3, 5], 'undo restores the whole drag');
});

test('review fixes: a move never freezes a walk length, a start pull keeps an implicit shot end, NaN and out-of-scene windows are refused', () => {
  const spec = film();
  const hero = spec.actors[0];
  const perf: any[] = [
    { time: 0, animation: 'idle' },
    { time: 2, moveTo: [1, 0, 1], duration: 1 },
    { time: 6, animation: 'wave' },
  ];
  hero.performance = perf;
  // the walk is drawn as long as its duration, not until the next step
  const walk = deriveTimeline(spec).find((l) => l.id === `actor-${hero.id}`)!.clips[1];
  assert.deepEqual([walk.start, walk.end], [2, 3]);
  assert.ok(applyClipEdit(spec, walk.source!, { start: 2.1, end: 3.1 }, 'move'));
  assert.deepEqual([perf[1].time, perf[1].duration], [2.1, 1], 'a move writes only the time');
  perf[1].duration = undefined;
  assert.ok(applyClipEdit(spec, walk.source!, { start: 2.5, end: 6 }, 'move'));
  assert.equal(perf[1].duration, undefined, 'an implicit walk length stays implicit when the clip is only moved');
  assert.ok(applyClipEdit(spec, walk.source!, { start: 2.5, end: 4 }, 'end'));
  assert.equal(perf[1].duration, 1.5, 'pulling the end sets it');

  // an implicit shot end survives pulling the START edge, and is written when the end itself moves
  const s2 = film();
  s2.camera.shots = [{ start: 0, type: 'wide' }, { start: 5, type: 'close-up' }];
  const a = deriveTimeline(s2).find((l) => l.id === 'shots')!.clips[0];
  assert.ok(applyClipEdit(s2, a.source!, { start: 1, end: a.end }, 'start'));
  assert.deepEqual([s2.camera.shots[0].start, s2.camera.shots[0].end], [1, undefined]);
  assert.ok(applyClipEdit(s2, a.source!, { start: 1, end: 3 }, 'end'));
  assert.equal(s2.camera.shots[0].end, 3);

  // garbage in, nothing written
  const before = JSON.stringify(spec);
  assert.equal(applyClipEdit(spec, { kind: 'shot', index: 0 }, { start: Number.NaN, end: Number.NaN }), false);
  assert.equal(applyClipEdit(spec, { kind: 'vfx', id: 'fx1' }, { start: 1, end: Number.POSITIVE_INFINITY }), false);
  assert.equal(JSON.stringify(spec), before);
  assert.deepEqual(dragWindow({ start: 1, end: 2 }, 'move', Number.NaN, 10), { start: 1, end: 2 });
  assert.deepEqual(dragWindow({ start: 1, end: 2 }, 'move', 1, Number.NaN).end > 0, true);

  // a scene shorter than the 2 s the lanes show: nothing is written past its real end
  const short = film();
  short.durationSeconds = 1.5;
  assert.ok(applyClipEdit(short, { kind: 'vfx', id: 'fx1' }, { start: 1.8, end: 2 }));
  assert.ok(short.vfx[0].startTime! < 1.5 && short.vfx[0].endTime! <= 1.5);
});
