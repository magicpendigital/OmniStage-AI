/**
 * Phase 7C — end-to-end checks of exported games in a real browser, driven frame by frame through the Player's
 * deterministic `step()` hook (no timing flakiness). Run: npm run test:e2e
 */
import { expect, test } from '@playwright/test';
import { openExport, template } from './exportFixture';

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
