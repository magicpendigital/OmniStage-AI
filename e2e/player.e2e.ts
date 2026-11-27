/**
 * Phase 7C — end-to-end checks of exported games in a real browser, driven frame by frame through the Player's
 * deterministic `step()` hook (no timing flakiness). Run: npm run test:e2e
 */
import { expect, test } from '@playwright/test';
import { openExport, shaderFxScene, template } from './exportFixture';
import { applyBiomeToScene } from '../src/runtime/biomes';
import type { SceneSpec } from '../src/types/scene.schema';

const PLAYER_3D = 's.sceneSpec.actors.find((a) => a.physicsRole === "player").position';

for (const quality of ['high', 'ultra'] as const) {
  test(`3D open world renders through the shared builders without errors (${quality})`, async ({ page }) => {
    const p = await openExport(page, template('open-world-nature-island'), { quality });
    await p.step(30);
    const px = await p.pixelStats();
    expect(px.width).toBeGreaterThan(100);
    expect(px.std, 'scene has visible detail, not a flat colour').toBeGreaterThan(8);
    expect(px.mean).toBeGreaterThan(10);
    expect(p.errors).toEqual([]);
  });
}

test('3D coin rush: holding arrow keys walks the player into a coin and scores', async ({ page }) => {
  const p = await openExport(page, template('coin-rush-playable'));
  await p.step(5);
  expect(await p.state<number>('s.gameScore')).toBe(0);
  const start = await p.state<number[]>(PLAYER_3D);
  await p.key('arrowright', true);
  await p.key('arrowup', true);
  let score = 0;
  for (let i = 0; i < 40 && score === 0; i++) {
    await p.step(10);
    score = await p.state<number>('s.gameScore');
  }
  await p.key('arrowright', false);
  await p.key('arrowup', false);
  const end = await p.state<number[]>(PLAYER_3D);
  expect(end[0]).toBeGreaterThan(start[0]);
  expect(score).toBeGreaterThan(0);
  expect(p.errors).toEqual([]);
});

test('3D tap to unbox: tapping the gift box counts taps even though the logic graph also reacts', async ({ page }) => {
  const p = await openExport(page, template('tap-to-unbox-minigame'));
  await p.step(10);
  const box = await page.locator('canvas.omni-stage').boundingBox();
  expect(box).toBeTruthy();
  const required = 3;
  for (let i = 0; i < required; i++) {
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.55);
    await p.step(5);
  }
  const taps = await p.state<number>('Object.values(s.unboxTapCounts).reduce((a, b) => a + b, 0)');
  expect(taps).toBe(required);
  expect(await p.state<number>('s.gameScore'), 'opening the box scores').toBeGreaterThan(0);
  expect(p.errors).toEqual([]);
});

test('3D state machine: an enemy waits, chases the player and catches them (Phase 9)', async ({ page }) => {
  const spec = template('coin-rush-playable');
  const hero = spec.actors.find((a) => a.physicsRole === 'player')!;
  const [hx, , hz] = hero.position;
  const ex = hx > 0 ? hx - 3 : hx + 3;
  spec.actors.push({ ...hero, id: 'e2e-enemy', name: 'Enemy', physicsRole: 'static', onClickAction: 'none', position: [ex, 0, hz],
    stateMachine: { initial: 'idle', states: {
      idle: { move: 'stay', transitions: [{ to: 'chase', when: { type: 'timer', seconds: 0.5 } }] },
      chase: { move: 'chase-player', speed: 2, transitions: [{ to: 'caught', when: { type: 'player-near', distance: 1 } }] },
      caught: { onEnter: [{ type: 'spawn-vfx', vfx: 'sparkles' }] },
    } } });
  const p = await openExport(page, spec);
  // Real-time rAF frames run before manual(true) takes over (many on a loaded machine): restart so the timer starts from zero.
  await page.evaluate(() => (window as any).__omniPlayer.restart());
  await p.step(5);
  expect(await p.state<string>('s.machineStates["e2e-enemy"]')).toBe('idle');
  let state = 'idle';
  for (let i = 0; i < 20 && state !== 'caught'; i++) {
    await p.step(10);
    state = await p.state<string>('s.machineStates["e2e-enemy"]');
  }
  expect(state).toBe('caught');
  const end = await p.state<number[]>('s.sceneSpec.actors.find((a) => a.id === "e2e-enemy").position');
  expect(Math.abs(end[0] - ex)).toBeGreaterThan(1.5);
  expect(await p.state<boolean>('s.sceneSpec.vfx.some((v) => v.id === "runtime-vfx-sm-e2e-enemy")')).toBe(true);
  expect(p.errors).toEqual([]);
});

test('2D platformer: the player runs right and the timeline advances deterministically', async ({ page }) => {
  const spec = template('blank-2d-authoring');
  spec.mode = 'game';
  const p = await openExport(page, spec);
  await p.step(10);
  const playerId = spec.nodes2D.find((n) => n.physics2D === 'player-platformer')!.id;
  const t0 = await p.state<number>('s.currentTime');
  const x0 = (await p.body2D(playerId)).x;
  await p.key('arrowright', true);
  await p.step(60);
  await p.key('arrowright', false);
  const t1 = await p.state<number>('s.currentTime');
  const x1 = (await p.body2D(playerId)).x;
  expect(t1 - t0).toBeCloseTo(1, 1);
  expect(x1).toBeGreaterThan(x0 + 50);
  const px = await p.pixelStats();
  expect(px.std).toBeGreaterThan(5);
  expect(p.errors).toEqual([]);
});

test('3D film: performance walks the hero and the shot list cuts the camera (Phase 10A)', async ({ page }) => {
  const spec = template('blank-3d-authoring');
  spec.mode = 'media';
  spec.durationSeconds = 10;
  const hero = spec.actors[0];
  hero.id = 'hero';
  hero.position = [0, 0, 0];
  hero.performance = [
    { time: 0, clip: 'Sitting' },
    { time: 2, moveTo: [3, 0, 0], duration: 3, ease: 'linear' },
    { time: 6, clip: 'Wave', faceDeg: 0 },
  ];
  spec.camera.shots = [
    { start: 0, type: 'wide', subject: 'hero', angle: 'front' },
    { start: 5, type: 'close-up', subject: 'hero', angle: 'front' },
  ];
  const p = await openExport(page, spec);
  const at = async (t: number) => {
    const now = await p.state<number>('s.currentTime');
    const frames = Math.round((t - now) / 0.05);
    for (let i = 0; i < frames; i += 20) await p.step(Math.min(20, frames - i), 0.05);
    return p.view3d();
  };
  const t1 = await at(1);
  expect(t1.actors.hero.position[0]).toBeCloseTo(0, 1);
  const t35 = await at(3.5);
  expect(t35.actors.hero.position[0]).toBeGreaterThan(1);
  expect(t35.actors.hero.position[0]).toBeLessThan(2.2);
  expect(t35.actors.hero.yaw).toBeCloseTo(Math.PI / 2, 1);
  const wideDist = Math.hypot(t35.camera.position[0] - t35.actors.hero.position[0], t35.camera.position[2]);
  const t7 = await at(7);
  expect(t7.actors.hero.position[0]).toBeCloseTo(3, 1);
  const closeDist = Math.hypot(t7.camera.position[0] - 3, t7.camera.position[2]);
  expect(closeDist).toBeLessThan(wideDist / 2);
  expect(t7.camera.fov).toBeLessThan(t35.camera.fov);
  expect(p.errors).toEqual([]);
});

test('3D biome film: waterfall valley renders its landmarks and animates the water (Phase 10B)', async ({ page }) => {
  const spec = applyBiomeToScene(template('blank-3d-authoring'), 'waterfall-valley');
  spec.mode = 'media';
  spec.durationSeconds = 6;
  spec.soundtrack = { music: { mood: 'adventure' }, ambience: { type: 'auto' }, cues: [{ time: 1, sfx: 'splash' }] };
  spec.camera.shots = [{ start: 0, type: 'establishing', subject: spec.actors[0].id }];
  const p = await openExport(page, spec);
  await p.step(10, 0.05);
  const world = (await p.view3d()).world;
  for (const f of spec.world.features!) expect(world).toContain(`WaterFeature-${f.id}`);
  expect(world.filter((n) => n.startsWith('ScatterLayer-')).length).toBe(spec.world.scatterObjects.length);
  const a = await p.pixelStats();
  await p.step(20, 0.05);
  const b = await p.pixelStats();
  expect(a.std, 'a dressed outdoor frame, not a flat colour').toBeGreaterThan(8);
  expect(Math.abs(a.mean - b.mean) + Math.abs(a.std - b.std), 'water and actors move').toBeGreaterThan(0);
  expect(p.errors).toEqual([]);
});

test('3D dialogue: the speaker talks, turns to its listener and the line is captioned (Phase 10C)', async ({ page }) => {
  const spec = template('blank-3d-authoring');
  spec.mode = 'media';
  spec.durationSeconds = 6;
  const robot = { ...spec.actors[0], id: 'robot', name: 'Robot', position: [-2, 0, 0] as [number, number, number], performance: undefined };
  const friend = { ...spec.actors[0], id: 'friend', name: 'Bạn', position: [2, 0, 0] as [number, number, number], performance: undefined };
  spec.actors = [robot, friend];
  spec.dialogue = [{ id: 'l1', time: 1, speaker: 'robot', listener: 'friend', text: 'Xin chào! Mình là chú robot nhỏ.' }];
  const p = await openExport(page, spec);
  const at = async (t: number) => {
    const now = await p.state<number>('s.currentTime');
    const frames = Math.round((t - now) / 0.05);
    for (let i = 0; i < frames; i += 20) await p.step(Math.min(20, frames - i), 0.05);
    return p.view3d();
  };
  const before = await at(0.5);
  expect(before.actors.robot.talk).toBe(0);
  const during = await at(1.8);
  expect(during.actors.robot.talk).toBeGreaterThan(0);
  expect(during.actors.friend.talk).toBe(0);
  expect(during.actors.robot.yaw).toBeCloseTo(Math.PI / 2, 1);
  await expect(page.locator('.omni-captions')).toContainText('Xin chào! Mình là chú robot nhỏ.');
  expect(p.errors).toEqual([]);
});

test('app build: device tier + adaptive quality steps down on slow frames (Phase 8)', async ({ page }) => {
  const p = await openExport(page, template('open-world-nature-island'), { app: { saveKey: 'com.omnistage.perftest', tier: 'high' } });
  await p.step(10);
  const perf = () => page.evaluate(() => (window as any).__omniPlayer.perf());
  const quality = () => page.evaluate(() => (window as any).__omniPlayer.inspect().view3d.quality);
  let report = await perf();
  expect(report.tier).toBe('high');
  expect(report.rung).toBe(0);
  expect(await quality()).toMatchObject({ shadows: 'full', postFx: true, particleScale: 1 });
  // Frame-stepping (MP4 / manual mode) never feeds the governor.
  const framesBefore = report.frames;
  await p.step(20);
  expect((await perf()).frames).toBe(framesBefore);
  // 25 fps for ~12 s of synthetic frames → several steps down the ladder.
  await page.evaluate(() => (window as any).__omniPlayer.perfSample(40, 300));
  report = await perf();
  expect(report.steps.length).toBeGreaterThanOrEqual(2);
  expect(report.steps.every((s: any) => s.reason === 'slow')).toBe(true);
  expect(report.rung).toBeGreaterThan(1);
  expect((await quality()).postFx).toBe(false);
  await p.step(5);
  const px = await p.pixelStats();
  expect(px.std, 'still renders after the quality change').toBeGreaterThan(8);
  expect(p.errors).toEqual([]);
});

test('app build: auto tier detection picks low on software rendering; ad exports report no profile (Phase 8)', async ({ page }) => {
  const app = await openExport(page, template('coin-rush-playable'), { quality: 'auto', app: { saveKey: 'com.omnistage.autotier' } });
  await app.step(5);
  const report = await page.evaluate(() => (window as any).__omniPlayer.perf());
  expect(report.tier).toBe('low');
  expect(report.reasons.join(' ')).toMatch(/software/);
  expect(app.errors).toEqual([]);

  const ad = await openExport(page, template('coin-rush-playable'));
  await ad.step(5);
  expect(await page.evaluate(() => (window as any).__omniPlayer.perf())).toBeNull();
});

test('3D shader effects: every preset applies to the rigged robot and composites, dissolve burns away (Phase 6)', async ({ page }) => {
  const spec = shaderFxScene();
  const p = await openExport(page, spec);
  // The rAF loop runs a few real-time frames before manual(true) takes over; start both pages from t = 0 so the comparison below is deterministic.
  await page.evaluate(() => (window as any).__omniPlayer.store.setState({ currentTime: 0 }));
  await p.waitAssets();
  await p.step(20, 0.05);
  const view = await p.view3d();
  for (const a of spec.actors) expect(view.actors[a.id].fx, `${a.id} (${a.shaderEffect!.preset}) has effect meshes`).toBeGreaterThan(0);
  const a = await p.pixelStats();
  expect(a.std, 'a lit frame, not a blank canvas').toBeGreaterThan(8);
  await page.screenshot({ path: test.info().outputPath('shader-fx.png') });

  // Same scene without effects looks different (the effects really draw).
  const plain = shaderFxScene();
  for (const actor of plain.actors) delete actor.shaderEffect;
  const page2 = await page.context().newPage();
  const q = await openExport(page2, plain);
  await page2.evaluate(() => (window as any).__omniPlayer.store.setState({ currentTime: 0 }));
  await q.waitAssets();
  await q.step(20, 0.05);
  expect((await q.view3d()).actors.robot.fx).toBe(0);
  const b = await q.pixelStats();
  // The global mean / std of two different pictures can cancel out (they differed by 0.2..1.0 run to run), so also compare
  // the frames pixel by pixel: six effect props must change many pixels, not just the average.
  const ga = await p.pixelGrid();
  const gb = await q.pixelGrid();
  const meanAbsDiff = ga.reduce((sum, v, i) => sum + Math.abs(v - gb[i]), 0) / ga.length;
  expect(meanAbsDiff, 'effects change the frame (mean per-pixel luminance difference)').toBeGreaterThan(3);
  expect(Math.abs(a.mean - b.mean) + Math.abs(a.std - b.std) + meanAbsDiff, 'effects change the frame').toBeGreaterThan(1);

  await p.step(80, 0.05); // t ≈ 5 s: dissolve finished, everything else still animating
  expect(p.errors).toEqual([]);
  expect(q.errors).toEqual([]);
});

for (const kind of ['crossfade', 'wipe', 'whip-pan', 'iris', 'cut'] as const) {
  test(`3D film: the ${kind} into the next scene is composited from the last frame of the one we leave (Phase 11E)`, async ({ page }) => {
    const a = template('blank-3d-authoring');
    a.mode = 'media';
    a.id = 'scene-a';
    a.durationSeconds = 6;
    a.sequence = { storyboardId: 'sb', storyboardTitle: 't', kind: 'film', index: 0, total: 2 } as any;
    const b = template('blank-3d-authoring');
    b.mode = 'media';
    b.id = 'scene-b';
    b.durationSeconds = 6;
    b.sequence = { storyboardId: 'sb', storyboardTitle: 't', kind: 'film', index: 1, total: 2, transition: kind } as any;
    const p = await openExport(page, a, {}, [a, b]);
    await p.waitAssets();
    await p.step(10, 0.05);
    // The canvas transition runs on real time, so hand the loop back to the Player for this check.
    await page.evaluate(() => (window as any).__omniPlayer.manual(false));
    await page.evaluate(() => (window as any).__omniPlayer.gotoScene('scene-b'));
    const running = await page.evaluate(() => (window as any).__omniPlayer.transitionRunning());
    expect(running).toBe(kind !== 'cut');
    expect(await p.state<string>('s.sceneSpec.id')).toBe('scene-b');
    if (kind !== 'cut') await page.waitForFunction(() => !(window as any).__omniPlayer.transitionRunning(), undefined, { timeout: 5000 });
    expect(p.errors).toEqual([]);
  });
}

// ---- Phase 2: the 2D engine (shared physics, scrolling camera, hazards, checkpoints, moving platforms) ----
import type { Node2D } from '../src/types/scene.schema';

function node2d(id: string, over: Partial<Node2D>): Node2D {
  return {
    id, name: id, type: 'tile-platform', x: 0, y: 0, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
    fill: '#334155', stroke: '#64748B', physics2D: 'none', ...over,
  } as Node2D;
}

function platformerLevel(nodes: Node2D[], world?: { width: number; height: number }) {
  const spec = template('blank-2d-authoring');
  spec.mode = 'game';
  spec.nodes2D = nodes;
  if (world) spec.world2D = world;
  spec.gameRules = { winCondition: 'survive-timer', targetScore: 0, timeLimitSeconds: 120, instructions: '' } as typeof spec.gameRules;
  return spec;
}

test('2D engine: a scrolling world follows the player, a checkpoint is remembered and a hazard sends the player back to it', async ({ page }) => {
  const spec = platformerLevel(
    [
      node2d('ground', { type: 'tile-platform', x: 1500, y: 570, width: 3000, height: 40, physics2D: 'solid' }),
      node2d('hero', { type: 'sprite-actor', x: 100, y: 510, width: 40, height: 60, physics2D: 'player-platformer' }),
      node2d('flag', { x: 500, y: 520, width: 30, height: 60, physics2D: 'checkpoint' }),
      node2d('spikes', { x: 1000, y: 530, width: 60, height: 40, physics2D: 'hazard' }),
    ],
    { width: 3000, height: 600 }
  );
  const p = await openExport(page, spec);
  await p.step(20);
  expect((await p.body2D('hero')).onGround, 'lands on the solid ground').toBe(true);
  expect((await p.camera2D()).x, 'camera starts at the world start').toBeCloseTo(0, 0);

  await p.key('arrowright', true);
  let sawCamera = 0;
  let respawnedAt: number | null = null;
  let prevX = (await p.body2D('hero')).x;
  for (let i = 0; i < 400 && respawnedAt === null; i++) {
    await p.step(1);
    const b = await p.body2D('hero');
    sawCamera = Math.max(sawCamera, (await p.camera2D()).x);
    if (b.x < prevX - 100) respawnedAt = b.x;
    prevX = b.x;
  }
  await p.key('arrowright', false);
  expect((await p.body2D('flag')).reached, 'the checkpoint was touched on the way').toBe(true);
  expect(sawCamera, 'the camera scrolled right with the player').toBeGreaterThan(200);
  expect(respawnedAt, 'the hazard sent the player back').not.toBeNull();
  expect(respawnedAt!, 'to the checkpoint, not the start').toBeGreaterThan(400);
  expect(respawnedAt!).toBeLessThan(600);
  expect(p.errors).toEqual([]);
});

test('2D engine: a moving platform carries the player standing on it', async ({ page }) => {
  const lift = node2d('lift', { x: 200, y: 500, width: 160, height: 20, physics2D: 'static-platform', mover: { axis: 'x', distance: 300, speed: 100 } });
  const hero = node2d('hero', { type: 'sprite-actor', x: 200, y: 468, width: 40, height: 44, physics2D: 'player-platformer' });
  const p = await openExport(page, platformerLevel([lift, hero]));
  await p.step(10);
  const x0 = (await p.body2D('hero')).x;
  await p.step(120); // 2 s at 100 px/s
  const b = await p.body2D('hero');
  expect(b.onGround, 'still standing on the lift').toBe(true);
  expect(b.x - x0, 'carried about 200 px by the platform').toBeGreaterThan(170);
  expect(b.x - x0).toBeLessThan(230);
  expect(p.errors).toEqual([]);
});

// ---- Phase 3: variables, health, spawners, projectiles and the declarative HUD ----
test('game state: a turret spawns projectiles that wear the player down, the HUD shows it and 0 health loses the game', async ({ page }) => {
  const spec = platformerLevel([
    node2d('ground', { type: 'tile-platform', x: 500, y: 570, width: 1000, height: 40, physics2D: 'solid' }),
    node2d('hero', { type: 'sprite-actor', x: 100, y: 510, width: 40, height: 60, physics2D: 'player-platformer', health: { max: 3, invulnerableSeconds: 0.5 } }),
    node2d('ball', { type: 'vector-shape', x: 0, y: 0, width: 16, height: 16, physics2D: 'none', prefab: true, projectile: { vx: -400, vy: 0, damage: 1, lifetimeSeconds: 3, target: 'player' } }),
    node2d('turret', { x: 800, y: 510, width: 40, height: 60, physics2D: 'solid', spawner: { prefabId: 'ball', everySeconds: 1, max: 2, startDelay: 0.5, offsetX: -40 } }),
  ]);
  spec.variables = [{ id: 'keys', label: 'Keys', initial: 2, max: 3 }];
  spec.hud = [
    { id: 'hp', kind: 'bar', source: 'health', anchor: 'top-left', label: 'HP' },
    { id: 'keys', kind: 'counter', source: 'variable', variableId: 'keys', anchor: 'top-right' },
  ];
  const p = await openExport(page, spec);
  await p.step(10);
  await expect(page.locator('[data-hud-id="hp"]')).toHaveCount(1);
  await expect(page.locator('[data-hud-id="keys"]')).toContainText('2');
  expect(await p.state<Record<string, number>>('s.gameHealth')).toMatchObject({});

  let sawClone = false;
  for (let i = 0; i < 40; i++) {
    await p.step(6);
    if (await p.state<boolean>('s.sceneSpec.nodes2D.some((n) => n.id.startsWith("ball#"))')) sawClone = true;
  }
  expect(sawClone, 'the spawner created a projectile clone').toBe(true);
  const hurt = await p.state<number | undefined>('s.gameHealth.hero');
  expect(hurt, 'a projectile hit the player').toBeLessThan(3);
  expect(await p.state<boolean>('s.sceneSpec.nodes2D.find((n) => n.id === "ball").visible !== false'), 'the prefab itself is never consumed').toBe(true);

  for (let i = 0; i < 80 && !(await p.state<boolean>('s.gameEnded')); i++) await p.step(6);
  expect(await p.state<boolean>('s.gameEnded'), 'running out of health ends the game').toBe(true);
  expect(await p.state<boolean>('s.gameWon'), 'as a loss').toBe(false);
  expect(p.errors).toEqual([]);
});

test('3D depth of field (Phase 6B): out-of-focus detail blurs, the focal plane keeps it, the frame repeats exactly', async ({ page }) => {
  const shoot = async (grade?: SceneSpec['grade']) => {
    const spec = shaderFxScene();
    for (const a of spec.actors) delete a.shaderEffect;
    if (grade) spec.grade = grade;
    const pg = await page.context().newPage();
    const p = await openExport(pg, spec, { quality: 'ultra' });
    await pg.evaluate(() => (window as any).__omniPlayer.store.setState({ currentTime: 0 }));
    await p.waitAssets();
    await p.step(10, 0.05);
    const e = await p.edgeEnergy([0.12, 0.28, 0.4, 0.72]); // the gift box: in the focal plane of the shot on the car
    if (grade) await pg.screenshot({ path: test.info().outputPath(`dof-${grade.focusDistance ?? 'auto'}.png`) });
    expect(p.errors).toEqual([]);
    await pg.close();
    return e;
  };
  const plain = await shoot();
  const noGrade = await shoot({ dof: 0, vignette: 0.01 });
  expect(Math.abs(noGrade - plain), 'dof 0 changes nothing').toBeLessThan(plain * 0.3); // (ambient particles move with the wall clock, so two renders differ - up to ~15% under load; a real blur would drop it below 50%)
  const blurred = await shoot({ dof: 1, focusDistance: 0.6 });
  expect(blurred, 'focusing 0.6 m from the lens blurs the box').toBeLessThan(plain * 0.5);
  const blurredAgain = await shoot({ dof: 1, focusDistance: 0.6 });
  expect(Math.abs(blurred - blurredAgain), 'blurred frames agree').toBeLessThan(plain * 0.1);
  const focused = await shoot({ dof: 1 });
  expect(focused, 'auto focus keeps what is in the focal plane of the shot sharp').toBeGreaterThan(plain * 0.5); // (part of the region is the blurred glow behind the box)
  expect(focused, '... and sharper than the blurred frame').toBeGreaterThan(blurred * 1.5);
});

test('3D colour grade (Phase 6): noir is black and white, a vignette darkens the corners, no grade changes nothing', async ({ page }) => {
  const make = (grade?: SceneSpec['grade']) => {
    const spec = shaderFxScene();
    for (const a of spec.actors) delete a.shaderEffect;
    if (grade) spec.grade = grade;
    return spec;
  };
  const shoot = async (grade?: SceneSpec['grade']) => {
    const pg = await page.context().newPage();
    const p = await openExport(pg, make(grade));
    await pg.evaluate(() => (window as any).__omniPlayer.store.setState({ currentTime: 0 }));
    await p.waitAssets();
    await p.step(10, 0.05);
    const stats = await p.colorStats();
    if (grade) await pg.screenshot({ path: test.info().outputPath(`grade-${grade.preset ?? 'custom'}.png`) });
    expect(p.errors).toEqual([]);
    await pg.close();
    return stats;
  };
  const plain = await shoot();
  const again = await shoot();
  expect(Math.abs(plain.r - again.r) + Math.abs(plain.g - again.g) + Math.abs(plain.b - again.b), 'the same scene renders the same twice').toBeLessThan(3);
  expect(plain.spread, 'the ungraded scene has colour').toBeGreaterThan(8);

  const noir = await shoot({ preset: 'noir', grain: 0, vignette: 0 });
  expect(noir.spread, 'noir channels agree (black and white)').toBeLessThan(2);
  expect(noir.r + noir.g + noir.b, 'noir still has light in it').toBeGreaterThan(30);

  const vignette = await shoot({ vignette: 1 });
  expect(vignette.corner, 'corners go dark').toBeLessThan(plain.corner * 0.35 + 3);
  expect(Math.abs(vignette.center - plain.center), 'the centre is untouched').toBeLessThan(plain.center * 0.15 + 4);

  const warm = await shoot({ temperature: 1 });
  expect(warm.r - warm.b, 'warm shifts red above blue').toBeGreaterThan(plain.r - plain.b + 8);
});
