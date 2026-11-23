import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, hasLineOfSight, moveBody, overlaps, raycast, Solid, sweepBox } from '../src/runtime/physics/collide2d';
import { PLATFORMER_DEFAULTS, platformerLimits, resolveTuning } from '../src/runtime/physics/constants';
import { createPlatformerState, NO_INPUT, stepPlatformer, stepTopDown } from '../src/runtime/physics/platformer';
import { createCamera2D, fitWorldCamera, resolveCamera2D, resolveWorld, screenToWorld, stepCamera2D } from '../src/runtime/physics/camera2d';
import { moverOffset } from '../src/runtime/physics/mover';

const T = PLATFORMER_DEFAULTS;
const FLOOR: Solid = { id: 'floor', box: { x: 500, y: 560, w: 1000, h: 40 }, kind: 'solid' }; // top = 540
const dt = 1 / 60;

function settle(s = createPlatformerState(100, 500, 40, 60), solids: Solid[] = [FLOOR], frames = 30) {
  for (let i = 0; i < frames; i++) stepPlatformer(s, NO_INPUT, dt, solids, T);
  return s;
}

test('a body falls onto a solid floor and stays grounded', () => {
  const s = settle();
  assert.equal(s.grounded, true);
  assert.equal(s.groundId, 'floor');
  assert.ok(Math.abs(s.y + 30 - 540) < 0.5, `feet on the floor (y=${s.y})`);
  assert.equal(s.vy, 0);
});

test('the simulation is deterministic and independent of how the frame is cut up', () => {
  const run = (step: number) => {
    const s = settle();
    for (let i = 0; i < 90; i++) stepPlatformer(s, { ...NO_INPUT, right: true, jump: i < 20 }, step, [FLOOR], T);
    return s;
  };
  const a = run(dt);
  const b = run(dt);
  assert.deepEqual(a, b, 'same inputs, same result');
  // 90 frames of 1/60 vs 45 frames of 1/30 cover the same time and land in nearly the same place.
  const coarse = settle();
  for (let i = 0; i < 45; i++) stepPlatformer(coarse, { ...NO_INPUT, right: true, jump: i < 10 }, 1 / 30, [FLOOR], T);
  assert.ok(Math.abs(coarse.x - a.x) < 12, `x ${coarse.x} vs ${a.x}`);
});

test('a jump reaches the apex the verifier assumes', () => {
  const s = settle();
  let minY = s.y;
  for (let i = 0; i < 90; i++) {
    stepPlatformer(s, { ...NO_INPUT, jump: true }, dt, [FLOOR], T);
    minY = Math.min(minY, s.y);
  }
  const rise = 540 - 30 - minY;
  const expected = platformerLimits(T).jumpHeight;
  assert.ok(Math.abs(rise - expected) < 8, `rise ${rise.toFixed(1)} vs ${expected.toFixed(1)}`);
});

test('releasing jump early makes a short hop (variable jump height)', () => {
  const full = settle();
  const hop = settle();
  let fullTop = full.y;
  let hopTop = hop.y;
  for (let i = 0; i < 80; i++) {
    stepPlatformer(full, { ...NO_INPUT, jump: true }, dt, [FLOOR], T);
    stepPlatformer(hop, { ...NO_INPUT, jump: i < 3 }, dt, [FLOOR], T);
    fullTop = Math.min(fullTop, full.y);
    hopTop = Math.min(hopTop, hop.y);
  }
  assert.ok(hopTop > fullTop + 40, `hop apex ${hopTop} is lower than full ${fullTop}`);
});

test('coyote time: a jump just after leaving a ledge still works, a late one does not', () => {
  const ledge: Solid = { id: 'ledge', box: { x: 100, y: 560, w: 200, h: 40 }, kind: 'solid' }; // right edge at x = 200
  const make = () => {
    const s = createPlatformerState(180, 510, 40, 60);
    for (let i = 0; i < 20; i++) stepPlatformer(s, NO_INPUT, dt, [ledge], T);
    return s;
  };
  const early = make();
  // run off the ledge, then press jump 3 frames (0.05 s) after the feet left it
  let off = 0;
  while (early.grounded || off === 0) {
    stepPlatformer(early, { ...NO_INPUT, right: true }, dt, [ledge], T);
    off++;
    if (off > 60) break;
  }
  for (let i = 0; i < 3; i++) stepPlatformer(early, { ...NO_INPUT, right: true }, dt, [ledge], T);
  const ev = stepPlatformer(early, { ...NO_INPUT, right: true, jump: true }, dt, [ledge], T);
  assert.equal(ev.jumped, true, 'within coyote time');

  const late = make();
  off = 0;
  while (late.grounded || off === 0) {
    stepPlatformer(late, { ...NO_INPUT, right: true }, dt, [ledge], T);
    if (++off > 60) break;
  }
  for (let i = 0; i < 12; i++) stepPlatformer(late, { ...NO_INPUT, right: true }, dt, [ledge], T);
  const ev2 = stepPlatformer(late, { ...NO_INPUT, right: true, jump: true }, dt, [ledge], T);
  assert.equal(ev2.jumped, false, 'coyote time has run out');
});

test('jump buffer: pressing jump just before landing jumps on landing', () => {
  const s = createPlatformerState(500, 480, 40, 60); // feet 30 px above the floor
  let pressed = false;
  let jumped = false;
  for (let i = 0; i < 60; i++) {
    const nearFloor = 540 - (s.y + 30) < 8;
    if (nearFloor) pressed = true;
    // a single press 2-3 frames before touchdown, released right after
    const ev = stepPlatformer(s, { ...NO_INPUT, jump: nearFloor && i % 2 === 0 }, dt, [FLOOR], T);
    if (ev.jumped) jumped = true;
  }
  assert.equal(pressed, true, 'the test reached the pre-landing window');
  assert.equal(jumped, true, 'the early press is remembered and fires on landing');
});

test('double jump needs maxJumps 2 and is spent after two jumps', () => {
  const tuning = resolveTuning({ maxJumps: 2 });
  const s = settle();
  const press = (n: number) => {
    let jumps = 0;
    for (let i = 0; i < n; i++) {
      // tap: up one frame, down one frame
      const ev1 = stepPlatformer(s, { ...NO_INPUT, jump: i % 8 === 0 }, dt, [FLOOR], tuning);
      if (ev1.jumped) jumps++;
    }
    return jumps;
  };
  const jumps = press(24); // 3 taps while still in the air from the first
  assert.equal(jumps, 2, `two jumps, not ${jumps}`);
  const single = settle();
  let n = 0;
  for (let i = 0; i < 24; i++) if (stepPlatformer(single, { ...NO_INPUT, jump: i % 8 === 0 }, dt, [FLOOR], T).jumped) n++;
  assert.equal(n, 1, 'default is a single jump');
});

test('solid blocks stop a body from the side and from below; one-way platforms only catch from above', () => {
  const wall: Solid = { id: 'wall', box: { x: 300, y: 480, w: 40, h: 120 }, kind: 'solid' };
  const s = settle(createPlatformerState(100, 500, 40, 60), [FLOOR, wall]);
  for (let i = 0; i < 120; i++) stepPlatformer(s, { ...NO_INPUT, right: true }, dt, [FLOOR, wall], T);
  assert.ok(s.x + 20 <= 280.5, `stopped at the wall (x=${s.x})`);
  assert.equal(s.wall, 1);

  const oneWay: Solid = { id: 'ow', box: { x: 500, y: 450, w: 200, h: 16 }, kind: 'one-way' }; // top = 442
  const up = settle(createPlatformerState(500, 500, 40, 60), [FLOOR, oneWay], 40);
  // jump up through it
  const full = resolveTuning({ variableJump: false });
  for (let i = 0; i < 120; i++) stepPlatformer(up, { ...NO_INPUT, jump: i < 3 }, dt, [FLOOR, oneWay], full);
  assert.equal(up.groundId, 'ow', 'ends up standing on the one-way platform after jumping through it');

  const ceiling: Solid = { id: 'ceil', box: { x: 500, y: 400, w: 200, h: 20 }, kind: 'solid' }; // bottom = 410
  const head = settle(createPlatformerState(500, 500, 40, 60), [FLOOR, ceiling], 40);
  let minTop = Infinity;
  for (let i = 0; i < 40; i++) {
    stepPlatformer(head, { ...NO_INPUT, jump: true }, dt, [FLOOR, ceiling], T);
    minTop = Math.min(minTop, head.y - 30);
  }
  assert.ok(minTop >= 410 - 0.5, `head stops at the ceiling (top ${minTop})`);
});

test('a body standing on a moving platform is carried by it', () => {
  const platform = (x: number): Solid => ({ id: 'lift', box: { x, y: 540, w: 120, h: 16 }, kind: 'one-way', dx: x - 200 < 0 ? 0 : 0 });
  const s = createPlatformerState(200, 500, 40, 60);
  let x = 200;
  for (let i = 0; i < 20; i++) stepPlatformer(s, NO_INPUT, dt, [platform(x)], T);
  assert.equal(s.groundId, 'lift');
  const startX = s.x;
  for (let i = 0; i < 60; i++) {
    const prev = x;
    x += 2; // 120 px/s to the right
    stepPlatformer(s, NO_INPUT, dt, [{ ...platform(x), dx: x - prev, dy: 0 }], T);
  }
  assert.ok(Math.abs(s.x - startX - 120) < 1, `carried 120px, moved ${s.x - startX}`);
  assert.equal(s.grounded, true);
});

test('top-down movement is blocked by walls on every side and diagonals are not faster', () => {
  const wall: Solid = { id: 'w', box: { x: 300, y: 300, w: 40, h: 400 }, kind: 'solid' };
  const s = createPlatformerState(100, 300, 40, 40);
  for (let i = 0; i < 120; i++) stepTopDown(s, { ...NO_INPUT, right: true }, dt, [wall], T);
  assert.ok(s.x + 20 <= 280.5, `blocked (x=${s.x})`);
  const diag = createPlatformerState(100, 100, 20, 20);
  const straight = createPlatformerState(100, 100, 20, 20);
  for (let i = 0; i < 30; i++) {
    stepTopDown(diag, { ...NO_INPUT, right: true, down: true }, dt, [], T);
    stepTopDown(straight, { ...NO_INPUT, right: true }, dt, [], T);
  }
  const diagSpeed = Math.hypot(diag.x - 100, diag.y - 100);
  assert.ok(Math.abs(diagSpeed - (straight.x - 100)) < 1, `diagonal ${diagSpeed} vs straight ${straight.x - 100}`);
  assert.equal(diag.grounded, false, 'top-down has no ground state');
});

test('raycast, sweep and line of sight', () => {
  const targets = [
    { id: 'a', box: { x: 200, y: 100, w: 40, h: 40 } },
    { id: 'b', box: { x: 400, y: 100, w: 40, h: 40 } },
  ];
  const hit = raycast(0, 100, 1, 0, 1000, targets);
  assert.equal(hit?.id, 'a');
  assert.equal(hit?.distance, 180);
  assert.deepEqual([hit?.nx, hit?.ny], [-1, 0]);
  assert.equal(raycast(0, 100, 1, 0, 100, targets), null, 'out of range');
  assert.equal(raycast(0, 0, 1, 0, 1000, targets), null, 'passes above');
  assert.equal(raycast(0, 100, 0, 0, 100, targets), null, 'zero direction');
  const swept = sweepBox({ x: 0, y: 100, w: 20, h: 20 }, 500, 0, targets);
  assert.equal(swept?.id, 'a');
  assert.equal(swept?.distance, 170, 'the box face meets the target face');
  assert.equal(hasLineOfSight(0, 100, 300, 100, targets), false);
  assert.equal(hasLineOfSight(0, 100, 150, 100, targets), true);
  assert.equal(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false, 'touching is not overlapping');
});

test('moveBody never tunnels through a thin solid at terminal speed', () => {
  const thin: Solid = { id: 't', box: { x: 500, y: 300, w: 400, h: 6 }, kind: 'solid' };
  const b = createBody(500, 100, 20, 20);
  b.vy = 1100;
  for (let i = 0; i < 40; i++) moveBody(b, [thin], 1 / 120);
  assert.ok(b.y < 300, 'stays above the thin solid');
});

test('tuning: authored values are clamped, scene gravity and gravityScale apply, extra jumps raise the limits', () => {
  const t = resolveTuning({ runSpeed: 99999, jumpVelocity: -5, maxJumps: 9, gravityScale: 2, variableJump: false });
  assert.equal(t.runSpeed, 900);
  assert.equal(t.jumpVelocity, 150);
  assert.equal(t.maxJumps, 3);
  assert.ok(Math.abs(t.gravity - 882 * 2) < 1e-6);
  assert.equal(t.jumpCut, 1);
  const base = platformerLimits(T);
  assert.equal(base.maxStepUp, 125, 'the original ≈125 px step-up');
  assert.ok(Math.abs(base.maxGap - 309) <= 1, 'the original ≈309 px gap');
  assert.ok(platformerLimits(resolveTuning({ maxJumps: 2 })).maxStepUp > base.maxStepUp * 1.9);
});

test('camera: fixed on one screen, follows with a dead zone on a big world, clamps to the world', () => {
  const small = resolveWorld(undefined);
  assert.deepEqual(small, { width: 1000, height: 600 });
  assert.equal(resolveCamera2D(undefined, small).mode, 'fixed');
  const world = resolveWorld({ width: 4000, height: 1200 });
  const cfg = resolveCamera2D(undefined, world);
  assert.equal(cfg.mode, 'follow');
  const cam = createCamera2D();
  stepCamera2D(cam, { x: 100, y: 300, vx: 0 }, cfg, world, dt);
  assert.equal(cam.x, 0, 'clamped to the world start');
  // inside the dead zone: no movement
  const x0 = cam.x;
  stepCamera2D(cam, { x: 520, y: 300, vx: 0 }, { ...cfg, lookAhead: 0 }, world, dt);
  assert.equal(cam.x, x0);
  // run far right: the camera follows and stops at the world's right edge
  for (let i = 0; i < 600; i++) stepCamera2D(cam, { x: 3900, y: 300, vx: 320 }, cfg, world, dt);
  assert.equal(cam.x, 3000, 'right edge of a 4000-wide world with a 1000-wide view');
  assert.deepEqual(screenToWorld(cam, 500, 100), { x: 3500, y: 100 + cam.y });
  const fit = fitWorldCamera(world);
  assert.equal(fit.zoom, 0.25);
  // zoom in: the view covers less of the world
  const zoomed = createCamera2D();
  stepCamera2D(zoomed, { x: 2000, y: 600, vx: 0 }, { ...cfg, zoom: 2 }, world, dt);
  assert.equal(zoomed.zoom, 2);
  assert.equal(zoomed.x, 2000 - 250);
});

test('camera: invalid world and camera numbers fall back to safe values', () => {
  const w = resolveWorld({ width: NaN, height: -5 } as never);
  assert.deepEqual(w, { width: 1000, height: 320 });
  const c = resolveCamera2D({ zoom: 99, smoothing: -1, lookAhead: NaN } as never, w);
  assert.equal(c.zoom, 3);
  assert.equal(c.smoothing, 0);
  assert.equal(c.lookAhead, 80);
});

test('movers are a pure ping-pong function of time', () => {
  const m = { axis: 'x', distance: 200, speed: 100 } as const; // 2 s each way
  assert.deepEqual(moverOffset(m, 0), { x: 0, y: 0 });
  assert.deepEqual(moverOffset(m, 2), { x: 200, y: 0 });
  assert.deepEqual(moverOffset(m, 4), { x: 0, y: 0 });
  assert.equal(moverOffset(m, 1).x, 100);
  assert.equal(moverOffset(m, 1 + 4).x, 100, 'periodic');
  assert.equal(moverOffset({ axis: 'y', distance: -60, speed: 30, phase: 0.5 }, 0).y, -60, 'phase offsets the cycle');
  assert.deepEqual(moverOffset({ axis: 'x', distance: 0, speed: 10 }, 3), { x: 0, y: 0 }, 'a zero-distance mover stays put');
  assert.deepEqual(moverOffset(undefined, 3), { x: 0, y: 0 });
});
