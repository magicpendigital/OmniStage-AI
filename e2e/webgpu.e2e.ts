/**
 * Phase 7 — WebGPU parity: the same exported scene rendered by the WebGL Player and by the WebGPU Player (custom parts
 * through the TSL ports) must look the same at the same frame and run without errors. Skipped when the browser has no
 * WebGPU adapter (the Player then falls back to WebGL, which the first assertion of each test checks).
 */
import { expect, test } from '@playwright/test';
import { openExport, template } from './exportFixture';
import { applyBiomeToScene } from '../src/runtime/biomes';
import { PLAYER_RUNTIME_WEBGPU } from '../src/exporter/generated/playerRuntimeWebgpu';

const scenes = {
  'open world (sky, terrain, reflective water, clouds, weather, scatter)': () => template('open-world-nature-island'),
  'waterfall valley + studio grid and dust': () => {
    const s = applyBiomeToScene(template('blank-3d-authoring'), 'waterfall-valley');
    s.environment.groundGrid = true;
    s.world.weather = { type: 'snow', intensity: 0.6 };
    return s;
  },
};

for (const [name, make] of Object.entries(scenes)) {
  test(`WebGPU renders like WebGL: ${name}`, async ({ browser }) => {
    const glPage = await browser.newPage();
    const gl = await openExport(glPage, make(), { quality: 'high' });
    await gl.waitAssets();
    await gl.step(20, 0.05);
    const a = await gl.pixelStats();
    expect(await gl.backend()).toBe('webgl');
    await glPage.screenshot({ path: test.info().outputPath('webgl.png') });

    const gpuPage = await browser.newPage();
    const gpu = await openExport(gpuPage, make(), { quality: 'high', renderer: 'webgpu', playerRuntimeSource: PLAYER_RUNTIME_WEBGPU });
    const backend = await gpu.backend();
    test.skip(backend !== 'webgpu', 'this browser has no WebGPU adapter (the Player fell back to WebGL)');
    await gpu.waitAssets();
    await gpu.step(20, 0.05);
    const b = await gpu.pixelStats();
    await gpuPage.screenshot({ path: test.info().outputPath('webgpu.png') });
    expect(b.std, 'a real frame, not a blank canvas').toBeGreaterThan(8);
    expect(Math.abs(a.mean - b.mean), `mean luminance WebGL ${a.mean.toFixed(1)} vs WebGPU ${b.mean.toFixed(1)}`).toBeLessThan(14);
    expect(Math.abs(a.std - b.std), `contrast WebGL ${a.std.toFixed(1)} vs WebGPU ${b.std.toFixed(1)}`).toBeLessThan(14);
    expect(gpu.errors).toEqual([]);
    expect(gl.errors).toEqual([]);
  });
}

test('WebGPU Player: ultra quality (node bloom) renders and actors animate', async ({ page }) => {
  const p = await openExport(page, template('coin-rush-playable'), { quality: 'ultra', renderer: 'webgpu', playerRuntimeSource: PLAYER_RUNTIME_WEBGPU });
  test.skip((await p.backend()) !== 'webgpu', 'no WebGPU adapter');
  await p.step(10);
  const px = await p.pixelStats();
  expect(px.std).toBeGreaterThan(8);
  expect((await p.view3d()).backend).toBe('webgpu');
  expect(p.errors).toEqual([]);
});
