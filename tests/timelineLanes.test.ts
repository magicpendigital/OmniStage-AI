import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { deriveTimeline, overlappingClips, timelineDuration } from '../src/runtime/timelineLanes';
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
    { start: 0, type: 'wide' },
    { start: 4, type: 'close-up', move: 'push-in' },
  ];
  s.captions = [{ start: 1, end: 3, text: 'A very long caption that will be shortened for the clip label' }];
  s.soundtrack = { music: { mood: 'calm', tempo: 80 }, ambience: { type: 'forest' }, cues: [{ time: 2.5, sfx: 'chime' }] };
  s.vfx = [{ id: 'fx1', name: 'Sparkles', type: 'sparkles' as never, position: [0, 0, 0], color: '#ffee88', intensity: 1, startTime: 3, endTime: 5 }];
  s.grade = { preset: 'teal-orange' };
  return s;
}

test('every timed thing of a film scene becomes a lane with clips inside the scene', () => {
  const spec = film();
  const lanes = deriveTimeline(spec);
  const byId = new Map(lanes.map((l) => [l.id, l]));
  for (const id of ['shots', `actor-${spec.actors[0].id}`, 'captions', 'music', 'ambience', 'sfx', 'vfx-fx1', 'look']) assert.ok(byId.has(id), `lane ${id}`);
  const duration = timelineDuration(spec);
  for (const lane of lanes) {
    assert.ok(lane.clips.length > 0, lane.id);
    for (const c of lane.clips) assert.ok(c.start >= 0 && c.end <= duration + 1e-9 && c.end > c.start, `${lane.id}/${c.id} inside 0..${duration}`);
  }
  const shots = byId.get('shots')!.clips;
  assert.deepEqual(shots.map((c) => [c.start, c.end]), [[0, 4], [4, 10]], 'a shot lasts until the next one');
  assert.equal(shots[1].label, 'close-up · push-in');
  const perf = byId.get(`actor-${spec.actors[0].id}`)!.clips;
  assert.deepEqual(perf.map((c) => c.label), ['waits', 'walk', 'wave']);
  assert.deepEqual(perf.map((c) => [c.start, c.end]), [[0, 2], [2, 5], [6, 10]], 'a walk lasts its duration; holds last until the next step');
  assert.ok(byId.get('captions')!.clips[0].label.length <= 28 && byId.get('captions')!.clips[0].label.endsWith('…'));
  assert.equal(byId.get('music')!.clips[0].label, 'calm · 80 BPM');
  assert.equal(byId.get('look')!.clips[0].label, 'teal-orange');
  assert.deepEqual(byId.get('vfx-fx1')!.clips.map((c) => [c.start, c.end]), [[3, 5]]);
});

test('lanes follow the data: empty scene has none, no grade means no look lane, 2D has only sound and captions', () => {
  const blank = createBlankSceneSpec('3d');
  assert.deepEqual(deriveTimeline(blank).filter((l) => ['shots', 'captions', 'music', 'look'].includes(l.id)), []);
  const spec = film();
  delete spec.grade;
  assert.ok(!deriveTimeline(spec).some((l) => l.kind === 'look'));
  const flat = createBlankSceneSpec('2d');
  flat.captions = [{ start: 0, end: 1, text: 'hi' }];
  flat.soundtrack = { music: { mood: 'happy' } };
  flat.grade = { preset: 'noir' };
  const kinds = deriveTimeline(flat).map((l) => l.kind);
  assert.deepEqual(kinds, ['captions', 'music']);
});

test('dialogue lines show up as caption clips, and bad times never leave the scene or crash', () => {
  const spec = film();
  spec.dialogue = [{ id: 'l1', time: 5, speaker: spec.actors[0].id, text: 'Hello there' }];
  const captions = deriveTimeline(spec).find((l) => l.id === 'captions')!;
  assert.ok(captions.clips.some((c) => c.label.startsWith('Hello')), 'authored + dialogue captions');
  spec.actors[0].performance!.push({ time: Number.NaN } as never, { time: 99, clip: 'Wave' });
  spec.captions!.push({ start: 8, end: 40, text: 'late' });
  const lanes = deriveTimeline(spec);
  for (const lane of lanes) for (const c of lane.clips) assert.ok(c.end <= 10 + 1e-9 && c.start >= 0 && c.end > c.start, `${lane.id} clamped`);
});

test('overlapping clips are found on shot / caption / performance lanes only', () => {
  const spec = film();
  spec.captions = [{ start: 1, end: 4, text: 'a' }, { start: 3, end: 5, text: 'b' }];
  const lanes = deriveTimeline(spec);
  assert.equal(overlappingClips(lanes.find((l) => l.id === 'captions')!).length, 1);
  assert.equal(overlappingClips(lanes.find((l) => l.id === 'shots')!).length, 0);
  assert.equal(overlappingClips(lanes.find((l) => l.id === 'music')!).length, 0);
});
