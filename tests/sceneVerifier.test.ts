import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import {
  autoFixSceneSpec,
  canReachSurface,
  MAX_GAP,
  MAX_STEP_UP,
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
