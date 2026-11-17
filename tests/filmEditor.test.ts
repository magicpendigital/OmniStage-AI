import test from 'node:test';
import assert from 'node:assert/strict';
import { carryFromPrevious, editFilm, lintCut, lintCuts, sameLocation } from '../src/agent/filmEditor';
import { evaluateFilm } from '../src/agent/filmEval';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent } from '../src/agent/storyboardAgent';
import { resolvePerformance } from '../src/runtime/cinematics';
import type { ActorNode, SceneSpec } from '../src/types/scene.schema';

const PROMPT = 'Làm phim hoạt hình 3 cảnh về rô-bốt';

function film(): SceneSpec[] {
  const intent = detectStoryboardIntent(PROMPT)!;
  const plan = buildLocalStoryboardPlan(PROMPT, intent);
  const scenes = plan.beats.map((_, i) => buildLocalSceneForBeat(PROMPT, plan, i));
  // One place, one hero: the seam checks only apply inside a location.
  scenes.forEach((s, i) => {
    s.world = JSON.parse(JSON.stringify(scenes[0].world));
    s.sequence = { storyboardId: 'sb', storyboardTitle: 't', kind: 'film', index: i, total: scenes.length, ...(i > 0 ? { transition: 'cut' as const } : {}) };
  });
  return scenes;
}

const hero = (s: SceneSpec): ActorNode => s.actors[0];
const endPos = (s: SceneSpec, a: ActorNode) => resolvePerformance(a, s.durationSeconds || 8, s.actors, s.world).position;

function strand(scenes: SceneSpec[]) {
  // Walk the hero of scene 1 far away, then start scene 2 back at the origin: the classic seam.
  const h = hero(scenes[0]);
  h.performance = [{ time: 0.5, moveTo: [9, h.position[1], 9], duration: 3 }];
  const next = scenes[1].actors.find((a) => a.id === h.id)!;
  next.position = [-6, next.position[1], -6];
}

test('a character that starts the next scene far from where it ended is a position jump', () => {
  const scenes = film();
  strand(scenes);
  const f = lintCut(scenes[0], scenes[1], 1);
  assert.ok(f.some((x) => x.code === 'cut.position-jump' && x.fixable), JSON.stringify(f));
});

test('carry puts the character where it ended (and leaves the input alone)', () => {
  const scenes = film();
  strand(scenes);
  const h = hero(scenes[0]);
  const before = JSON.stringify(scenes[1]);
  const { scene, notes } = carryFromPrevious(scenes[0], scenes[1]);
  assert.equal(JSON.stringify(scenes[1]), before, 'input untouched');
  assert.equal(notes.length >= 1, true);
  const n = scene.actors.find((a) => a.id === h.id)!;
  const end = endPos(scenes[0], h);
  assert.ok(Math.hypot(n.position[0] - end[0], n.position[2] - end[2]) < 0.01);
  assert.equal(lintCut(scenes[0], scene, 1).some((x) => x.code === 'cut.position-jump'), false);
});

test('scenes in different places are not carried: the character is somewhere else on purpose', () => {
  const scenes = film();
  strand(scenes);
  scenes[1].world = { ...scenes[1].world, skybox: 'night-stars', biome: scenes[0].world?.biome === 'desert' ? 'snow' : 'desert' } as any;
  assert.equal(sameLocation(scenes[0], scenes[1]), false);
  const { scene, notes } = carryFromPrevious(scenes[0], scenes[1]);
  // The sound may still be cut J/L (a new place brings its own ambience early); no CHARACTER is carried.
  assert.deepEqual(notes.filter((n) => !/^[JL]-cut/.test(n)), []);
  assert.deepEqual(scene.actors[0].position, scenes[1].actors[0].position);
  assert.equal(lintCut(scenes[0], scenes[1], 1).some((x) => x.code === 'cut.position-jump'), false);
});

test('a straight cut that changes the lighting in the same place is reported, not guessed', () => {
  const scenes = film();
  scenes[0].environment = { ...scenes[0].environment, presetId: 'clean-apple-studio' };
  scenes[1].environment = { ...scenes[1].environment, presetId: 'cyberpunk-neon' };
  const f = lintCut(scenes[0], scenes[1], 1);
  assert.ok(f.some((x) => x.code === 'cut.light-jump' && !x.fixable));
  scenes[1].sequence = { ...scenes[1].sequence!, transition: 'fade' };
  assert.equal(lintCut(scenes[0], scenes[1], 1).some((x) => x.code === 'cut.light-jump'), false, 'a dissolve may change the light');
});

test('two shots of the same size from the same spot are a jump cut', () => {
  const scenes = film();
  for (const s of [scenes[0], scenes[1]]) s.camera = { ...s.camera, shots: [{ start: 0, type: 'medium', subject: s.actors[0].id }] };
  // same actor pose and same framing at the seam
  scenes[1].actors[0].position = [...endPos(scenes[0], scenes[0].actors[0])] as any;
  scenes[1].actors[0].performance = [];
  scenes[0].actors[0].performance = [];
  scenes[1].actors[0].position = [...scenes[0].actors[0].position] as any;
  scenes[1].actors[0].rotation = [...scenes[0].actors[0].rotation] as any;
  const f = lintCut(scenes[0], scenes[1], 1);
  assert.ok(f.some((x) => x.code === 'cut.jump-cut'), JSON.stringify(f));
});

test('crossing the line between two characters on a cut is flagged; a left/right opening angle is mirrored only when that fixes it', () => {
  const scenes = film();
  const [a, b] = scenes;
  // p stands at z=-1 facing q at z=+1: the line runs along z, so the camera sides are -x and +x.
  const mk = (id: string, z: number): ActorNode => ({ ...a.actors[0], id, name: id, position: [0, 0, z], rotation: [0, 0, 0], performance: [] });
  a.actors = [mk('p', -1), mk('q', 1)];
  b.actors = [mk('p', -1), mk('q', 1)];
  const opening = (scene: SceneSpec, angle: any) => { scene.camera = { ...scene.camera, shots: [{ start: 0, type: 'medium', subject: 'p', angle }] }; };
  const flagged = (x: SceneSpec) => lintCut(a, x, 1).some((f) => f.code === 'cut.axis-flip' && f.fixable);

  opening(a, 'three-quarter-left');
  opening(b, 'three-quarter-left');
  assert.equal(flagged(b), false, 'same side: no flip');

  opening(b, 'three-quarter-right');
  assert.equal(flagged(b), true, 'opposite sides: flip');
  const fixed = carryFromPrevious(a, b);
  assert.ok(fixed.notes.some((n) => /mirrored/.test(n)), JSON.stringify(fixed.notes));
  assert.equal(fixed.scene.camera.shots![0].angle, 'three-quarter-left');
  assert.equal(flagged(fixed.scene), false);
  assert.equal(b.camera.shots![0].angle, 'three-quarter-right', 'input untouched');

  // front/back angles cannot be mirrored: left as is (reported by lintCut, not guessed).
  opening(a, 'back');
  opening(b, 'front');
  assert.equal(carryFromPrevious(a, b).scene.camera.shots![0].angle, 'front');
});

test('editFilm repairs seams in order, skips non-film scenes, and reports what is left', () => {
  const scenes = film();
  strand(scenes);
  const game = { ...scenes[0], id: 'g', mode: 'game' } as SceneSpec;
  const withGame = [scenes[0], game, scenes[1], scenes[2]];
  const r = editFilm(withGame);
  assert.equal(r.scenes.length, 4);
  assert.equal(r.scenes[1], game, 'a game scene passes through');
  assert.ok(r.fixes.some((x) => /resumes/.test(x)));
  assert.equal(lintCuts(r.scenes).some((x) => x.code === 'cut.position-jump'), false);
});

test('the continuity score rewards a carried film', () => {
  const scenes = film();
  strand(scenes);
  const cont = (s: SceneSpec[]) => evaluateFilm({ scenes: s }).dimensions.find((d) => d.id === 'continuity')!.score;
  const before = cont(scenes);
  const after = cont(editFilm(scenes).scenes);
  assert.ok(after > before, `${after} should beat ${before}`);
});
