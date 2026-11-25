import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import {
  autoFixSceneSpec,
  canReachSurface,
  MAX_GAP,
  MAX_STEP_UP,
  mobileRigBudget,
  verifySceneSpec,
} from '../src/verification/sceneVerifier';
import type { Node2D, SceneSpec } from '../src/types/scene.schema';

function game2D(): SceneSpec {
  const spec = createBlankSceneSpec('2d', 'Verifier fixture');
  spec.mode = 'game';
  spec.gameRules = { winCondition: 'score-threshold', targetScore: 25, timeLimitSeconds: 30, instructions: '' };
  return spec;
}

function platform(id: string, x: number, y: number, width = 200): Node2D {
  return {
    id, name: id, type: 'tile-platform', x, y, width, height: 30, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#333', stroke: '#666', physics2D: 'static-platform',
  };
}

function star(id: string, x: number, y: number): Node2D {
  return {
    id, name: id, type: 'vector-shape', x, y, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#FBBF24', stroke: '#fff', shapeKind: 'star', physics2D: 'collectible', scoreValue: 25,
  };
}

test('physics envelope matches StageCanvas2D jump (≈153px apex, 82% margin)', () => {
  assert.ok(MAX_STEP_UP >= 115 && MAX_STEP_UP <= 130, `step-up ${MAX_STEP_UP}`);
  assert.ok(MAX_GAP >= 280 && MAX_GAP <= 330, `gap ${MAX_GAP}`);
  const base = { id: 'a', left: 0, right: 200, top: 500 };
  assert.equal(canReachSurface(base, { id: 'b', left: 250, right: 400, top: 420 }), true);
  assert.equal(canReachSurface(base, { id: 'c', left: 250, right: 400, top: 300 }), false, '200px step-up is too high');
  assert.equal(canReachSurface(base, { id: 'd', left: 600, right: 800, top: 500 }), false, '400px gap is too wide');
  assert.equal(canReachSurface(base, { id: 'e', left: 560, right: 800, top: 580 }), true, 'falling extends reach');
});

test('blank 2D game scene passes verification', () => {
  const report = verifySceneSpec(game2D());
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test('unreachable collectible is flagged and auto-fixed onto a reachable platform', () => {
  const spec = game2D();
  spec.nodes2D.push(platform('sky-ledge', 900, 150, 120), star('sky-star', 900, 100));
  spec.gameRules.targetScore = 50;
  const report = verifySceneSpec(spec);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === '2d.collectible-unreachable' && i.targetId === 'sky-star'));

  const fixed = autoFixSceneSpec(spec);
  assert.equal(fixed.report.ok, true, JSON.stringify(fixed.report.issues));
  assert.ok(fixed.fixes.some((f) => f.includes('sky-star')));
  assert.equal(spec.nodes2D.find((n) => n.id === 'sky-star')!.y, 100, 'input must not be mutated');
});

test('staircase level within the envelope is fully reachable', () => {
  const spec = game2D();
  spec.nodes2D.push(
    platform('step1', 780, 400, 160),
    platform('step2', 900, 290, 160),
    star('top-star', 900, 230)
  );
  spec.gameRules.targetScore = 50;
  assert.equal(verifySceneSpec(spec).ok, true, JSON.stringify(verifySceneSpec(spec).issues));
});

test('player without ground and missing player are repaired', () => {
  const spec = game2D();
  spec.nodes2D = spec.nodes2D.filter((n) => n.physics2D !== 'static-platform');
  assert.ok(verifySceneSpec(spec).issues.some((i) => i.code === '2d.player-no-ground'));
  const fixed = autoFixSceneSpec(spec);
  assert.equal(fixed.report.ok, true, JSON.stringify(fixed.report.issues));

  const noPlayer = game2D();
  noPlayer.nodes2D = noPlayer.nodes2D.filter((n) => n.physics2D !== 'player-platformer');
  const fixed2 = autoFixSceneSpec(noPlayer);
  assert.ok(fixed2.spec.nodes2D.some((n) => n.physics2D === 'player-platformer'));
  assert.equal(fixed2.report.ok, true, JSON.stringify(fixed2.report.issues));
});

test('target score above available points is lowered', () => {
  const spec = game2D();
  spec.gameRules.targetScore = 500;
  const fixed = autoFixSceneSpec(spec);
  assert.equal(fixed.spec.gameRules.targetScore, 25);
  assert.equal(fixed.report.ok, true);
});

test('3D game: out-of-arena collectible, dangling camera follow and duplicate ids', () => {
  const spec = createBlankSceneSpec('3d', '3D fixture');
  spec.mode = 'game';
  spec.gameRules = { winCondition: 'score-threshold', targetScore: 25, timeLimitSeconds: 30, instructions: '' };
  const base = spec.actors[0];
  spec.actors = [
    { ...base, id: 'hero', name: 'Hero', physicsRole: 'player', onClickAction: 'none', position: [0, 0, 0] },
    { ...base, id: 'gem', name: 'Gem', physicsRole: 'collectible', onClickAction: 'none', position: [12, 0, 0], scoreValue: 25 },
    { ...base, id: 'gem', name: 'Gem copy', physicsRole: 'static', onClickAction: 'none', position: [2, 0, 2] },
  ];
  spec.camera.followActorId = 'ghost';
  const codes = verifySceneSpec(spec).issues.map((i) => i.code);
  assert.ok(codes.includes('3d.collectible-out-of-arena'));
  assert.ok(codes.includes('camera.follow-missing'));
  assert.ok(codes.includes('ids.duplicate'));

  const fixed = autoFixSceneSpec(spec);
  assert.equal(fixed.report.ok, true, JSON.stringify(fixed.report.issues));
  assert.equal(fixed.spec.camera.followActorId, 'hero');
  assert.equal(new Set(fixed.spec.actors.map((a) => a.id)).size, 3);
});

test('collect-all with no collectibles is reported as non-fixable', () => {
  const spec = game2D();
  spec.nodes2D = spec.nodes2D.filter((n) => n.physics2D !== 'collectible');
  spec.gameRules.winCondition = 'collect-all';
  const fixed = autoFixSceneSpec(spec);
  assert.equal(fixed.report.ok, false);
  assert.ok(fixed.report.issues.some((i) => i.code === 'rules.no-collectibles' && !i.fixable));
});

test('unknown easing and audio cues are cleaned up', () => {
  const spec = game2D();
  spec.nodes2D[2].keyframeTrack = [
    { time: 0, x: 640, y: 380, ease: 'wobble' as any },
    { time: 1, x: 700, y: 380 },
  ];
  spec.audio = { enabled: true, masterVolume: 0.5, cues: { collect: 'kazoo' as any, win: 'win' } };
  const fixed = autoFixSceneSpec(spec);
  assert.equal(fixed.report.warnings, 0, JSON.stringify(fixed.report.issues));
  assert.equal(fixed.spec.nodes2D[2].keyframeTrack![0].ease, undefined);
  assert.equal(fixed.spec.audio!.cues.collect, undefined);
  assert.equal(fixed.spec.audio!.cues.win, 'win');
});

test('custom particle / SFX recipes: valid ones pass, bad ones are clamped, renamed built-ins and junk are removed', () => {
  const ok = { rate: 40, life: 1.2, speed: [20, 60], angle: [250, 290], gravity: -30, size: [6, 14], shape: 'circle', colors: ['#7CFC00', '#2E8B57'], fade: true, grow: true, alpha: 0.8 };
  const clean = game2D();
  clean.particleLibrary = { 'poison-puff': ok } as any;
  clean.sfxLibrary = { 'arp-up': { wave: 'square', dur: 0.4, vol: 0.5, notes: [523, 659, 784, 1047], step: 0.08 } } as any;
  assert.equal(verifySceneSpec(clean).issues.filter((i) => i.code === 'recipe.invalid').length, 0);

  const spec = game2D();
  spec.particleLibrary = { 'hot-sparks': { ...ok, rate: 9999 }, fire: ok, 'Bad Id': ok } as any;
  spec.sfxLibrary = { 'no-wave': { dur: 0.3, vol: 0.5 }, 'loud-zap': { wave: 'sawtooth', dur: 0.2, vol: 7, f0: 800, f1: 200 } } as any;
  const found = verifySceneSpec(spec).issues.filter((i) => i.code === 'recipe.invalid');
  assert.deepEqual(found.map((i) => i.targetId).sort(), ['particleLibrary:Bad Id', 'particleLibrary:fire', 'particleLibrary:hot-sparks', 'sfxLibrary:loud-zap', 'sfxLibrary:no-wave']);
  assert.ok(found.every((i) => i.severity === 'warning' && i.fixable));

  const { spec: fixed } = autoFixSceneSpec(spec);
  assert.deepEqual(Object.keys(fixed.particleLibrary!), ['hot-sparks']);
  assert.ok((fixed.particleLibrary!['hot-sparks'] as any).rate <= 400);
  assert.deepEqual(Object.keys(fixed.sfxLibrary!), ['loud-zap']);
  assert.ok((fixed.sfxLibrary!['loud-zap'] as any).vol <= 1);
  assert.equal(verifySceneSpec(fixed).issues.filter((i) => i.code === 'recipe.invalid').length, 0);

  const many = game2D();
  many.particleLibrary = Object.fromEntries(Array.from({ length: 30 }, (_, n) => [`fx-${n}`, ok])) as any;
  const trimmed = autoFixSceneSpec(many).spec;
  assert.equal(Object.keys(trimmed.particleLibrary!).length, 24);

  const junk = game2D();
  (junk as any).sfxLibrary = ['not', 'a', 'map'];
  assert.equal(autoFixSceneSpec(junk).spec.sfxLibrary, undefined);
});

test('mobile target: rules are opt-in and auto-fix raises small text', () => {
  const spec = game2D();
  spec.aspectRatio = '9:16';
  spec.nodes2D.push({ id: 'hud', name: 'HUD', type: 'text-kinetic', text: 'Score', x: 500, y: 300, width: 200, height: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', fontSize: 14 } as Node2D);
  assert.ok(!verifySceneSpec(spec).issues.some((i) => i.code.startsWith('mobile.')));
  assert.ok(verifySceneSpec(spec, { target: 'mobile' }).issues.some((i) => i.code === 'mobile.text-small' && i.targetId === 'hud'));
  const fixed = autoFixSceneSpec(spec, { target: 'mobile' });
  assert.ok(!fixed.report.issues.some((i) => i.code === 'mobile.text-small'));
});

test('mobile target: rig cost budget (vertices, bones, textures, rigged actor count)', () => {
  const spec = createBlankSceneSpec('3d', 'Rig budget');
  const base = spec.actors[0];
  const light = { ...base, id: 'light', name: 'Light', rigCost: { bones: 65, vertices: 20_000, textureSize: 1024 } };
  spec.actors = [light];
  assert.equal(mobileRigBudget(spec).issues.length, 0);
  assert.ok(!verifySceneSpec(spec, { target: 'mobile' }).issues.some((i) => i.code === 'mobile.rig-cost'));

  const heavy = { ...base, id: 'heavy', name: 'Heavy', rigCost: { bones: 160, vertices: 140_000, textureSize: 4096 } };
  spec.actors = [light, heavy];
  const budget = mobileRigBudget(spec);
  assert.equal(budget.vertices, 160_000);
  assert.equal(budget.heaviest?.id, 'heavy');
  assert.deepEqual(budget.issues.map((i) => i.id).sort(), ['bones', 'texture', 'vertices']);
  const rig = verifySceneSpec(spec, { target: 'mobile' }).issues.filter((i) => i.code === 'mobile.rig-cost');
  assert.equal(rig.length, 3);
  assert.ok(rig.every((i) => i.severity === 'warning'));
  assert.ok(rig.some((i) => i.targetId === 'heavy'));
  // Opt-in: no mobile rules without the mobile target.
  assert.ok(!verifySceneSpec(spec).issues.some((i) => i.code === 'mobile.rig-cost'));

  spec.actors = Array.from({ length: 13 }, (_, n) => ({ ...light, id: `r${n}`, rigCost: { bones: 30, vertices: 2_000 } }));
  assert.deepEqual(mobileRigBudget(spec).issues.map((i) => i.id), ['actors']);
  spec.actors = spec.actors.map((a, n) => (n ? a : { ...a, visible: false }));
  assert.equal(mobileRigBudget(spec).issues.length, 0, 'hidden actors do not count');
});

test('fixSceneIssue repairs one issue and leaves the input untouched', async () => {
  const { fixSceneIssue } = await import('../src/verification/sceneVerifier');
  const spec = game2D();
  spec.nodes2D = []; // a 2D game with no player node
  const issue = verifySceneSpec(spec).issues.find((i) => i.code === '2d.no-player');
  assert.ok(issue, 'the missing player is reported');
  assert.equal(issue.fixable, true);
  const { spec: next, fix } = fixSceneIssue(spec, issue);
  assert.ok(fix, 'a fix description is returned');
  assert.equal(spec.nodes2D?.length, 0, 'the original spec is not mutated');
  assert.ok((next.nodes2D || []).length > 0, 'a player node was added');
  assert.equal(verifySceneSpec(next).issues.some((i) => i.code === '2d.no-player'), false);
  // An issue that is not fixable is a no-op.
  const same = fixSceneIssue(spec, { ...issue, fixable: false });
  assert.equal(same.fix, null);
  assert.equal(same.spec, spec);
});

// ---- Phase 2: engine E1 (solid / hazard / checkpoint roles, controller, mover, collider, world2D, camera2D) ----
function codes(spec: SceneSpec) {
  return verifySceneSpec(spec).issues.map((i) => i.code);
}

function level(...extra: Node2D[]): SceneSpec {
  const spec = game2D();
  spec.nodes2D = [platform('ground', 500, 560, 1000), ...extra];
  return spec;
}

function hero(over: Partial<Node2D> = {}): Node2D {
  return {
    id: 'hero', name: 'hero', type: 'sprite-actor', x: 100, y: 500, width: 40, height: 60, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#0ea5e9', stroke: '#fff', physics2D: 'player-platformer', ...over,
  };
}

test('a bigger world2D moves the stage bounds and the auto-fix ground spans it', () => {
  const spec = level(hero(), { ...platform('far', 2500, 560, 400) });
  assert.ok(codes(spec).includes('2d.out-of-bounds'), 'x=2500 is outside the default one-screen world');
  spec.world2D = { width: 3000, height: 600 };
  assert.equal(codes(spec).includes('2d.out-of-bounds'), false, 'inside a 3000px world');
  const noGround = level(hero({ y: 300 }));
  noGround.nodes2D = noGround.nodes2D.filter((n) => n.id !== 'ground');
  noGround.world2D = { width: 3000, height: 600 };
  const fixed = autoFixSceneSpec(noGround).spec;
  const ground = fixed.nodes2D.find((n) => n.name === 'Ground (auto-fix)');
  assert.equal(ground?.width, 3000);
  assert.equal(codes(fixed).includes('2d.player-no-ground'), false);
});

test('solid blocks are landable surfaces and a player starting inside one is moved on top of it', () => {
  const spec = level(hero({ x: 500, y: 540 }));
  spec.nodes2D.push({ ...platform('block', 500, 540, 120), physics2D: 'solid', height: 60 });
  assert.ok(codes(spec).includes('2d.player-stuck'));
  const fixed = autoFixSceneSpec(spec).spec;
  assert.equal(codes(fixed).includes('2d.player-stuck'), false);
  const h = fixed.nodes2D.find((n) => n.id === 'hero')!;
  assert.ok(h.y + 30 <= 510 + 1, `hero stands on the block (y=${h.y})`);
});

test('a hazard on the player start is an error the fixer cannot guess', () => {
  const spec = level(hero(), { ...platform('spikes', 100, 500, 60), physics2D: 'hazard' });
  const issue = verifySceneSpec(spec).issues.find((i) => i.code === '2d.hazard-at-start');
  assert.ok(issue);
  assert.equal(issue.severity, 'error');
  assert.equal(issue.fixable, false);
  const apart = level(hero(), { ...platform('spikes', 600, 540, 60), physics2D: 'hazard' });
  assert.equal(codes(apart).includes('2d.hazard-at-start'), false);
});

test("the player's own controller widens what the verifier accepts (double jump)", () => {
  // 200 px above the ground: out of reach of a single jump (≈125 px), fine for a double jump.
  const single = level(hero(), platform('ledge', 300, 360, 200), star('gem', 300, 310));
  assert.ok(codes(single).includes('2d.collectible-unreachable'), 'single jump cannot reach it');
  const double = level(hero({ controller: { maxJumps: 2 } }), platform('ledge', 300, 360, 200), star('gem', 300, 310));
  assert.equal(codes(double).includes('2d.collectible-unreachable'), false, 'double jump can');
});

test('moving platforms count as surfaces over the whole range they sweep', () => {
  // The far ledge is 1400 px past the start: far too wide to jump. A lift that travels 1000 px bridges it.
  const far = platform('far', 1800, 560, 200);
  const build = (...mid: Node2D[]) => {
    const spec = level(hero(), ...mid, far, star('gem', 1800, 500));
    spec.world2D = { width: 2400, height: 600 };
    spec.nodes2D = spec.nodes2D.filter((n) => n.id !== 'ground');
    spec.nodes2D.push(platform('start', 100, 560, 400)); // right edge at x = 300
    return spec;
  };
  assert.ok(codes(build()).includes('2d.collectible-unreachable'), 'unreachable without the lift');
  const lift = { ...platform('lift', 500, 560, 200), mover: { axis: 'x', distance: 1000, speed: 120 } } as Node2D;
  assert.equal(codes(build(lift)).includes('2d.collectible-unreachable'), false, 'the lift bridges the gap');
  // A vertical lift connects a low floor with a high ledge the player cannot jump to.
  const high = platform('high', 400, 200, 200);
  const noLift = level(hero(), high, star('gem', 400, 150));
  assert.ok(codes(noLift).includes('2d.collectible-unreachable'));
  const elevator = { ...platform('elevator', 400, 560, 160), mover: { axis: 'y', distance: -340, speed: 60 } } as Node2D;
  const withLift = level(hero(), elevator, high, star('gem', 400, 150));
  assert.equal(codes(withLift).includes('2d.collectible-unreachable'), false, 'the elevator reaches the high ledge');
});

test('invalid controller, collider, mover, world and camera values are flagged and clamped / removed by the fixer', () => {
  const spec = level(
    hero({ controller: { jumpVelocity: 99999, maxJumps: 7, runSpeed: NaN } as never, collider: { width: -4 } }),
    { ...platform('lift', 400, 560, 120), mover: { axis: 'z', distance: 50, speed: 10 } as never },
    { ...star('gem', 400, 500), controller: { runSpeed: 100 } }
  );
  spec.world2D = { width: 50, height: NaN } as never;
  spec.camera2D = { mode: 'orbit', zoom: 10 } as never;
  const found = codes(spec);
  for (const c of ['2d.controller-invalid', '2d.collider-invalid', '2d.mover-invalid', '2d.world-invalid', '2d.camera-invalid']) {
    assert.ok(found.includes(c), `${c} reported`);
  }
  const fixed = autoFixSceneSpec(spec).spec;
  const left = codes(fixed).filter((c) => c.endsWith('-invalid') && c.startsWith('2d.'));
  assert.deepEqual(left, [], 'everything flagged was repaired');
  const h = fixed.nodes2D.find((n) => n.id === 'hero')!;
  assert.equal(h.controller?.jumpVelocity, 1100);
  assert.equal(h.controller?.maxJumps, 3);
  assert.equal('runSpeed' in (h.controller || {}), false);
  assert.equal(h.collider, undefined);
  assert.equal(fixed.nodes2D.find((n) => n.id === 'lift')?.mover, undefined);
  assert.equal(fixed.nodes2D.find((n) => n.id === 'gem')?.controller, undefined, 'a controller on a non-player does nothing and is removed');
  assert.equal(fixed.camera2D?.zoom, 3);
  assert.equal(fixed.camera2D?.mode, undefined);
});

test('valid Phase 2 data passes without a single new issue', () => {
  const spec = level(
    hero({ controller: { maxJumps: 2, runSpeed: 380, coyoteTime: 0.15, variableJump: true }, collider: { width: 30, height: 56, offsetY: 2 } }),
    { ...platform('lift', 500, 560, 160), mover: { axis: 'x', distance: 200, speed: 80 } },
    { ...platform('wall', 700, 500, 40), physics2D: 'solid', height: 120 },
    { ...platform('flag', 300, 520, 20), physics2D: 'checkpoint' },
    { ...platform('spikes', 800, 540, 60), physics2D: 'hazard' },
    star('gem', 300, 500)
  );
  spec.world2D = { width: 2000, height: 600 };
  spec.camera2D = { mode: 'follow', zoom: 1.2, smoothing: 0.2, deadzoneX: 80, lookAhead: 100 };
  assert.deepEqual(codes(spec).filter((c) => c.startsWith('2d.')), []);
});

// --- Phase 3: variables, health, HUD, spawners, projectiles ---------------------------------------------------------

test('Phase 3: valid variables, health, HUD, spawner and projectile data raise no issue', () => {
  const spec = level(
    hero({ health: { max: 3, invulnerableSeconds: 0.8 } }),
    star('gem', 300, 500),
    { ...platform('bullet', 0, 0, 20), id: 'bullet', prefab: true, physics2D: 'hazard', projectile: { vx: 300, vy: 0, damage: 1, target: 'player' } },
    { ...platform('turret', 700, 500, 40), physics2D: 'solid', spawner: { prefabId: 'bullet', everySeconds: 2, max: 3, offsetX: -40 } }
  );
  spec.variables = [{ id: 'keys', initial: 0, max: 3 }];
  spec.hud = [
    { id: 'hp', kind: 'bar', source: 'health', anchor: 'top-left' },
    { id: 'keys', kind: 'counter', source: 'variable', variableId: 'keys', anchor: 'top-right' },
  ];
  spec.logicGraph = {
    nodes: [
      { id: 'c', type: 'condition', title: 'Has keys', params: { conditionType: 'variable-compare', variableId: 'keys', op: '>=', value: 3 } },
      { id: 'a', type: 'action', title: 'Win', params: { actionType: 'win' } },
    ],
    edges: [{ id: 'e', from: 'c', to: 'a' }],
  } as never;
  const found = codes(spec).filter((c) => /^(state|spawn|projectile)\./.test(c));
  assert.deepEqual(found, []);
});

test('Phase 3: undeclared variables are reported and the fixer declares them', () => {
  const spec = level(hero(), star('gem', 300, 500));
  spec.hud = [{ id: 'k', kind: 'counter', source: 'variable', variableId: 'coins', anchor: 'top-left' }];
  assert.ok(codes(spec).includes('state.variable-undeclared'));
  const fixed = autoFixSceneSpec(spec).spec;
  assert.equal(codes(fixed).includes('state.variable-undeclared'), false);
  assert.deepEqual(fixed.variables?.map((v) => v.id), ['coins']);
});

test('Phase 3: variable-threshold needs a declared winVariable', () => {
  const spec = level(hero(), star('gem', 300, 500));
  spec.gameRules.winCondition = 'variable-threshold';
  assert.ok(codes(spec).includes('state.win-variable'));
  spec.variables = [{ id: 'keys', initial: 0, max: 3 }];
  spec.gameRules.winVariable = { id: 'keys', atLeast: 3 };
  assert.equal(codes(spec).includes('state.win-variable'), false);
});

test('Phase 3: invalid health, HUD, spawner and projectile data are repaired', () => {
  const spec = level(
    hero({ health: { max: -2 } }),
    { ...platform('bullet', 0, 0, 20), prefab: true, physics2D: 'hazard' },
    { ...platform('gun', 700, 500, 40), physics2D: 'solid', spawner: { prefabId: 'missing', everySeconds: 1 } },
    { ...platform('self', 800, 500, 40), physics2D: 'solid', spawner: { prefabId: 'self', everySeconds: 1 } },
    { ...platform('bad', 900, 500, 40), projectile: { vx: 0, vy: 0 } }
  );
  spec.hud = [{ id: 'x', kind: 'dial' as never, source: 'score', anchor: 'top-left' }, { id: 'ok', kind: 'counter', source: 'score', anchor: 'top-left' }];
  const found = codes(spec);
  for (const c of ['state.health-invalid', 'state.hud-invalid', 'spawn.prefab-missing', 'spawn.invalid', 'projectile.invalid']) {
    assert.ok(found.includes(c), `${c} reported`);
  }
  const fixed = autoFixSceneSpec(spec).spec;
  const left = codes(fixed).filter((c) => /^(state|spawn|projectile)\./.test(c));
  assert.deepEqual(left, [], 'everything flagged was repaired');
  assert.deepEqual(fixed.hud?.map((h) => h.id), ['ok']);
  assert.equal(fixed.nodes2D.find((n) => n.id === 'bad')?.projectile, undefined);
});

test('Phase 3: damage with a health-less player is flagged and fixed; prefabs are not live entities', () => {
  const spec = level(hero(), { ...platform('spikes', 600, 540, 60), physics2D: 'hazard', contactDamage: 2 });
  assert.ok(codes(spec).includes('state.no-player-health'));
  const fixed = autoFixSceneSpec(spec).spec;
  assert.equal(fixed.nodes2D.find((n) => n.id === 'hero')?.health?.max, 3);
  // A collectible prefab is not counted as collectible on the stage.
  const rules = level(hero(), { ...star('gem', 300, 500), prefab: true });
  assert.equal(codes(rules).includes('2d.collectible-unreachable'), false);
});

test('Phase 3: a projectile spawned inside its own solid turret is flagged and the fixer moves the spawn point out', () => {
  const spec = level(
    hero({ health: { max: 3 } }),
    { ...platform('bullet', 0, 0, 20), prefab: true, projectile: { vx: -300, vy: 0 } },
    { ...platform('turret', 700, 500, 40), physics2D: 'solid', spawner: { prefabId: 'bullet', everySeconds: 2 } }
  );
  const issue = verifySceneSpec(spec).issues.find((i) => i.code === 'spawn.inside-solid');
  assert.ok(issue, 'reported');
  assert.equal(issue.fixable, true);
  const fixed = autoFixSceneSpec(spec).spec;
  assert.equal(codes(fixed).includes('spawn.inside-solid'), false);
  assert.ok((fixed.nodes2D.find((n) => n.id === 'turret')!.spawner!.offsetX ?? 0) < 0, 'moved in the direction of flight');
});
