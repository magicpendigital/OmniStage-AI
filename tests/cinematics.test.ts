import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchClipName,
  performedActor,
  resolvePerformance,
  resolveShot,
  transitionInto,
  transitionOverlay,
} from '../src/runtime/cinematics';
import { createBlankSceneSpec, ASSET_REGISTRY } from '../src/registry/assetRegistry';
import { autoFixSceneSpec, mediaQualityPenalty, MEDIA_CRAFT_CODES, verifySceneSpec } from '../src/verification/sceneVerifier';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent, normalizeGeneratedSceneSpec, TERRAIN_COLORS } from '../src/agent/storyboardAgent';
import { sceneFogColor, SKY_PALETTES } from '../src/runtime/world';
import { buildAgentSystemPrompt, buildStoryboardPlannerSystemPrompt } from '../src/agent/systemPrompts';
import { runPatchLoop } from '../src/agent/patchLoop';
import type { ActorNode, SceneSpec } from '../src/types/scene.schema';

function robot(id: string, extra: Partial<ActorNode> = {}): ActorNode {
  const e = ASSET_REGISTRY['gltf-robot-expressive'];
  return {
    id, name: id, assetId: e.assetId, modelUrl: e.modelUrl, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    primaryColor: '#fff', activeAnimation: 'idle', activeClip: 'Idle', availableClips: [...(e.embeddedClips || [])],
    physicsRole: 'static', onClickAction: 'none', ...extra,
  };
}

function film(actors: ActorNode[], extra: Partial<SceneSpec> = {}): SceneSpec {
  const spec = createBlankSceneSpec('3d', 'Film test');
  return { ...spec, mode: 'media', durationSeconds: 10, actors, ...extra };
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('performance: sit → stand → walk (faces travel, auto Walk) → arrive Idle → look at partner + Wave', () => {
  const fox = robot('fox', { position: [4, 0, 4] });
  const hero = robot('hero', {
    performance: [
      { time: 0, clip: 'Sitting' },
      { time: 2, clip: 'Standing' },
      { time: 3, moveTo: [3, 0, 0], duration: 2 },
      { time: 6, lookAt: 'fox', clip: 'Wave' },
    ],
  });
  const at = (t: number) => resolvePerformance(hero, t, [hero, fox]);
  assert.equal(at(1).clip, 'Sitting');
  assert.equal(at(2.5).clip, 'Standing');
  const walking = at(4);
  assert.equal(walking.clip, 'Walk');
  assert.ok(walking.moving);
  assert.ok(walking.position[0] > 0 && walking.position[0] < 3);
  assert.ok(near(at(4.5).yaw, Math.PI / 2, 1e-3), 'faces +x while walking to x=3');
  const arrived = at(5.5);
  assert.deepEqual(arrived.position, [3, 0, 0]);
  assert.equal(arrived.clip, 'Idle');
  assert.equal(at(7).clip, 'Wave');
  assert.ok(near(at(7).yaw, Math.atan2(1, 4), 1e-3), 'turned to the fox at (4,4)');
  // Turning is eased, not snapped.
  const mid = at(6.1).yaw;
  assert.ok(mid < Math.PI / 2 && mid > Math.atan2(1, 4));
  // Fast moves pick Run; game mode ignores performance.
  const runner = robot('r', { performance: [{ time: 0, moveTo: [10, 0, 0], duration: 2 }] });
  assert.equal(resolvePerformance(runner, 1).clip, 'Run');
  assert.equal(performedActor(hero, { mode: 'game', actors: [hero], world: film([]).world }, 4), hero);
  assert.deepEqual(performedActor(hero, { mode: 'media', actors: [hero], world: film([]).world }, 5.5).position, [3, 0, 0]);
});

test('performance follows hilly terrain and clip names resolve like the renderers', () => {
  const spec = film([robot('h', { performance: [{ time: 0, moveTo: [9, 0, 0], duration: 1 }] })]);
  spec.world = { ...spec.world, terrain: { ...spec.world.terrain, type: 'grassy-hills', elevationScale: 2 } };
  const p = resolvePerformance(spec.actors[0], 2, spec.actors, spec.world);
  assert.notEqual(p.position[1], 0, 'standing on the hill, not at y=0');

  const robotClips = ASSET_REGISTRY['gltf-robot-expressive'].embeddedClips!;
  assert.equal(matchClipName('Walk', robotClips), 'Walking');
  assert.equal(matchClipName('sit', robotClips), 'Sitting');
  assert.equal(matchClipName('Run', robotClips), 'Running');
  assert.equal(matchClipName('Teleport', robotClips), 'Idle');
  const fox = ['Survey', 'Walk', 'Run'];
  assert.equal(matchClipName('Idle', fox), 'Survey');
  assert.equal(matchClipName('Walking', fox), 'Walk');
});

test('shots: hard cuts, framing sizes, tracking a walking subject, over-shoulder', () => {
  const hero = robot('hero', { performance: [{ time: 0, moveTo: [4, 0, 0], duration: 10, ease: 'linear' }] });
  const fox = robot('fox', { position: [0, 0, 4] });
  const spec = film([hero, fox], {});
  assert.equal(resolveShot(spec, 1), null, 'no shot list → camera.mode presets');
  spec.camera = {
    ...spec.camera,
    shots: [
      { start: 0, type: 'wide', subject: 'hero', angle: 'front' },
      { start: 3, type: 'close-up', subject: 'hero', angle: 'front' },
      { start: 6, type: 'tracking', subject: 'hero' },
      { start: 8, type: 'over-shoulder', subject: 'hero', partner: 'fox' },
    ],
  };
  const dist = (f: NonNullable<ReturnType<typeof resolveShot>>) => Math.hypot(f.position[0] - f.target[0], f.position[2] - f.target[2]);
  const wide = resolveShot(spec, 1)!;
  const close = resolveShot(spec, 4)!;
  assert.equal(wide.shotIndex, 0);
  assert.equal(close.shotIndex, 1);
  assert.ok(dist(close) < dist(wide) / 2, 'close-up is much closer than wide');
  assert.ok(close.fov < wide.fov);
  const t1 = resolveShot(spec, 6.2)!;
  const t2 = resolveShot(spec, 7.8)!;
  assert.ok(t2.target[0] > t1.target[0], 'tracking follows the walking subject');
  const os = resolveShot(spec, 9)!;
  assert.ok(Math.hypot(os.position[0] - 0, os.position[2] - 4) < 2, 'camera stands at the partner\'s shoulder');
  assert.ok(near(os.target[0], resolvePerformance(hero, 9).position[0], 1e-6), 'looking at the subject');
});

test('shot fov is a lens: a narrow close-up keeps close-up framing; seated performers are framed lower', () => {
  const hero = robot('hero', { performance: [{ time: 0, clip: 'Sitting' }, { time: 5, clip: 'Standing' }] });
  const spec = film([hero], { camera: { ...createBlankSceneSpec('3d', 'x').camera, shots: [{ start: 0, type: 'close-up', subject: 'hero', angle: 'front' }] } });
  const halfHeight = (f: NonNullable<ReturnType<typeof resolveShot>>) =>
    Math.hypot(f.position[0] - f.target[0], f.position[2] - f.target[2]) * Math.tan((f.fov * Math.PI) / 360);
  const base = resolveShot(spec, 6)!;
  spec.camera.shots![0].fov = 30;
  const narrow = resolveShot(spec, 6)!;
  assert.equal(narrow.fov, 30);
  assert.ok(Math.abs(halfHeight(narrow) - halfHeight(base)) < 0.01, 'same visible height of the subject at any lens');
  const seated = resolveShot(spec, 2)!;
  assert.ok(seated.target[1] < narrow.target[1] - 0.3, 'aims at the seated face, not where the standing head would be');
  spec.camera.shots![0].fov = 5;
  assert.equal(resolveShot(spec, 6)!.fov, 20, 'lens clamps to a sane range');
  assert.match(buildAgentSystemPrompt(), /over the robot's shoulder at the fox" = \{ subject: fox, partner: robot \}/);
});

test('over-shoulder clears a big foreground actor even when the subject is small', () => {
  const fox = ASSET_REGISTRY['gltf-fox'];
  const robo = robot('robo', { position: [0, 0, 0] });
  const small: ActorNode = { ...robot('fox', { position: [0, 0, 4] }), assetId: fox.assetId, modelUrl: fox.modelUrl };
  const spec = film([robo, small], { camera: { ...createBlankSceneSpec('3d', 'x').camera, shots: [{ start: 0, type: 'over-shoulder', subject: 'fox', partner: 'robo' }] } });
  const f = resolveShot(spec, 1)!;
  const box = ASSET_REGISTRY['gltf-robot-expressive'].boundingBox!;
  const flat = Math.hypot(f.position[0], f.position[2]);
  assert.ok(flat > box.depth / 2 + 0.5, `camera stands outside the robot (${flat.toFixed(2)} m from its centre)`);
  assert.ok(f.position[2] < 0, 'behind the robot, looking at the fox');
  // The sight line to the fox passes beside the robot's head, not through it.
  const t = -f.position[2] / (f.target[2] - f.position[2]);
  const xAtRobot = f.position[0] + (f.target[0] - f.position[0]) * t;
  assert.ok(Math.abs(xAtRobot) > box.width / 2, 'the subject is not hidden behind the partner');
});

test('AI worlds look outdoors: fog follows the sky horizon, named terrain gets a natural colour', () => {
  const studioEnv = { fogColor: '#0B101B', backgroundColor: '#0B101B' };
  assert.equal(sceneFogColor(studioEnv, { skybox: 'sunset-atmosphere' }), SKY_PALETTES['sunset-atmosphere'][1]);
  assert.equal(sceneFogColor(studioEnv, { skybox: 'studio-hdri' }), '#0B101B', 'studio scenes keep their fog');
  assert.equal(sceneFogColor(studioEnv), '#0B101B');
  const spec = normalizeGeneratedSceneSpec({ engineType: '3d', mode: 'media', world: { skybox: 'daylight-sky', terrain: { type: 'grassy-hills' } } }, '3d');
  assert.equal(spec.world.terrain.color, TERRAIN_COLORS['grassy-hills']);
  const own = normalizeGeneratedSceneSpec({ engineType: '3d', world: { terrain: { type: 'grassy-hills', color: '#6aa84f' } } }, '3d');
  assert.equal(own.world.terrain.color, '#6aa84f', 'an authored colour wins');
});

test('transitions: default fade, cut has no overlay, fade-white is white', () => {
  assert.equal(transitionInto({ sequence: undefined }), 'fade');
  assert.equal(transitionOverlay('cut'), null);
  assert.equal(transitionOverlay('fade-white')!.color, '#ffffff');
});

test('verifier: craft hints for a static, single-shot, bare film; fixes broken steps and shots', () => {
  const spec = film([robot('hero')]);
  spec.world = { ...spec.world, terrain: { ...spec.world.terrain, type: 'flat-grid' }, scatterObjects: [] };
  const codes = verifySceneSpec(spec).issues.map((i) => i.code);
  for (const c of MEDIA_CRAFT_CODES) assert.ok(codes.includes(c), c);
  assert.equal(mediaQualityPenalty(verifySceneSpec(spec)), 4);
  // The same rules are silent in game mode.
  assert.equal(mediaQualityPenalty(verifySceneSpec({ ...spec, mode: 'game' })), 0);

  spec.actors[0].performance = [
    { time: 99, clip: 'Wave' },
    { time: 1, clip: 'Teleport' },
    { time: 2, lookAt: 'ghost', moveTo: [40, 0, 0] },
  ];
  spec.camera = { ...spec.camera, shots: [{ start: 0, type: 'wide', subject: 'ghost' }, { start: 4, type: 'fisheye' as any }] };
  const fixed = autoFixSceneSpec(spec);
  const perf = fixed.spec.actors[0].performance!;
  assert.ok(perf.every((st) => st.time <= 10));
  assert.ok(!perf.some((st) => st.clip === 'Teleport'));
  assert.ok(!perf.some((st) => st.lookAt === 'ghost'));
  assert.ok(perf.every((st) => !st.moveTo || Math.abs(st.moveTo[0]) <= 12));
  assert.deepEqual(fixed.spec.camera.shots!.map((s) => [s.type, s.subject]), [['wide', undefined]]);
  assert.ok(!fixed.report.issues.some((i) => ['media.performance-invalid', 'media.performance-clip', 'media.lookat-missing', 'media.shot-invalid'].includes(i.code)));
});

test('offline film shots now act, cut and have a place (no craft hints)', () => {
  const prompt = 'Làm một bộ phim 3D gồm 3 cảnh về chú robot phiêu lưu trong rừng cùng bạn cáo';
  const intent = detectStoryboardIntent(prompt)!;
  const plan = buildLocalStoryboardPlan(prompt, intent);
  for (let i = 0; i < plan.beats.length; i++) {
    const spec = autoFixSceneSpec(buildLocalSceneForBeat(prompt, plan, i)).spec;
    const report = verifySceneSpec(spec);
    assert.equal(mediaQualityPenalty(report), 0, `scene ${i}: ${report.issues.map((x) => x.code).join(',')}`);
    assert.ok((spec.camera.shots || []).length >= 3);
    assert.equal(spec.environment.groundGrid, false);
  }
});

test('AI scenes keep actor ids and performances; prompts teach acting, shots and the screenwriter step', () => {
  const spec = normalizeGeneratedSceneSpec({
    engineType: '3d', mode: 'media',
    actors: [{ id: 'robot-hero', assetId: 'gltf-robot-expressive', position: [0, 0, 0], performance: [{ time: '1', clip: 'Wave' }, { nope: true }] }],
    camera: { shots: [{ start: 0, type: 'close-up', subject: 'robot-hero' }] },
  }, '3d');
  assert.equal(spec.actors[0].id, 'robot-hero');
  assert.deepEqual(spec.actors[0].performance, [{ time: 1, clip: 'Wave' }]);
  assert.equal(spec.camera.shots![0].subject, 'robot-hero');
  assert.match(buildAgentSystemPrompt(), /ACTING & SHOTS/);
  assert.match(buildStoryboardPlannerSystemPrompt(), /SCREENWRITER/);
});

test('patch loop keeps going while craft issues remain, and never accepts a less crafted round', async () => {
  const base = film([robot('hero')]);
  const steps = [
    { op: 'add', path: '/actors/@hero/performance', value: [{ time: 0, clip: 'Sitting' }, { time: 3, clip: 'Wave' }] },
  ];
  const replies = [
    { ops: steps },
    { ops: [{ op: 'remove', path: '/actors/@hero/performance' }] }, // worse: discarded
    { mergePatch: { camera: { shots: [{ start: 0, type: 'wide' }, { start: 5, type: 'close-up' }] }, world: { scatterObjects: [{ id: 'p', type: 'pine-trees', count: 20, spreadRadius: 20, scaleRange: [1, 1] }] }, soundtrack: { music: { mood: 'calm' } } } },
  ];
  const seen: string[][] = [];
  const result = await runPatchLoop({
    prompt: 'polish', spec: base, maxRounds: 3,
    check: (s) => autoFixSceneSpec(s),
    qualityPenalty: mediaQualityPenalty,
    qualityCodes: MEDIA_CRAFT_CODES,
    propose: async (t) => { seen.push(t.toolResults); return replies[t.round] as any; },
  });
  assert.ok(result);
  assert.equal(result.rounds.length, 3);
  assert.match(seen[1][0], /Craft issues/);
  assert.match(seen[2][1], /WORSE/);
  assert.equal(result.spec.actors[0].performance!.length, 2);
  assert.equal(mediaQualityPenalty(result.report), 0);
});

test('offline films are composed: nobody blocks the subject, over-shoulder sees the hero\'s face', () => {
  const prompt = 'Phim 3D 3 cảnh: chú robot phiêu lưu trong rừng cùng bạn cáo';
  const intent = detectStoryboardIntent(prompt)!;
  const plan = buildLocalStoryboardPlan(prompt, intent);
  for (let i = 0; i < plan.beats.length; i++) {
    const spec = autoFixSceneSpec(buildLocalSceneForBeat(prompt, plan, i)).spec;
    const shots = [...(spec.camera.shots || [])].sort((a, b) => a.start - b.start);
    shots.forEach((shot, k) => {
      const end = shots[k + 1]?.start ?? spec.durationSeconds;
      const t = (shot.start + end) / 2;
      const frame = resolveShot(spec, t)!;
      const subject = spec.actors.find((a) => a.id === shot.subject)!;
      const sp = resolvePerformance(subject, t, spec.actors, spec.world);
      const [cx, , cz] = frame.position;
      for (const other of spec.actors) {
        if (other.id === subject.id || other.id === shot.partner) continue;
        const op = resolvePerformance(other, t, spec.actors, spec.world).position;
        const vx = sp.position[0] - cx;
        const vz = sp.position[2] - cz;
        const len2 = vx * vx + vz * vz;
        const u = Math.max(0, Math.min(1, ((op[0] - cx) * vx + (op[2] - cz) * vz) / len2));
        const d = Math.hypot(op[0] - (cx + vx * u), op[2] - (cz + vz * u));
        assert.ok(d > 0.5 || u > 0.95, `scene ${i} shot ${shot.type}: ${other.name} blocks the camera (${d.toFixed(2)} m)`);
      }
      if (shot.type === 'over-shoulder' || shot.type === 'close-up') {
        const facing = Math.sin(sp.yaw) * (cx - sp.position[0]) + Math.cos(sp.yaw) * (cz - sp.position[2]);
        const camDist = Math.hypot(cx - sp.position[0], cz - sp.position[2]);
        assert.ok(facing / camDist > 0.5, `scene ${i}: hero is not facing the camera in the ${shot.type} shot (${(facing / camDist).toFixed(2)})`);
      }
    });
  }
});
