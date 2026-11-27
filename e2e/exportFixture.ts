/**
 * Phase 7C — builds a real exported Player HTML (same generator as Publish → HTML5) into a temp file and opens it
 * with the Player's rAF loop stopped, so tests advance time only through `__omniPlayer.step()` (deterministic).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { cloneSceneSpec, SCENE_TEMPLATES } from '../src/registry/assetRegistry';
import { generatePlayerHTML, PlayerHtmlOptions } from '../src/exporter/playerHtml';
import { PLAYER_RUNTIME } from '../src/exporter/generated/playerRuntime';
import type { SceneSpec } from '../src/types/scene.schema';

export function template(id: string): SceneSpec {
  const spec = SCENE_TEMPLATES[id];
  if (!spec) throw new Error(`unknown template ${id}`);
  return cloneSceneSpec(spec);
}

export async function openExport(page: Page, spec: SceneSpec, opts: Partial<PlayerHtmlOptions> = {}, scenes: SceneSpec[] = [spec]) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|GPU stall|WebGL warning/i.test(m.text())) errors.push(m.text());
  });
  const html = generatePlayerHTML(spec, 'universal', scenes, {
    playerRuntimeSource: PLAYER_RUNTIME,
    touchControls: false,
    sound: false,
    quality: 'high',
    ...opts,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-e2e-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  await page.goto('file://' + file.replace(/\\/g, '/'));
  await page.waitForFunction(() => !!(window as any).__omniPlayer);
  await page.evaluate(() => (window as any).__omniPlayer.manual(true));
  // Phase 7: a WebGPU Player initialises its device first
  await page.waitForFunction(() => (window as any).__omniPlayer.backend?.() !== 'pending', undefined, { timeout: 20000 });

  return {
    errors,
    /** Advance n frames of dt seconds inside the page. */
    step: (frames: number, dt = 1 / 60) =>
      page.evaluate(([n, d]) => {
        for (let i = 0; i < n; i++) (window as any).__omniPlayer.step(d);
      }, [frames, dt] as const),
    key: (key: string, down: boolean) => page.evaluate(([k, d]) => (window as any).__omniPlayer.setKey(k, d), [key, down] as const),
    /** Evaluates an expression over the Player store state `s`. */
    state: <T>(expr: string) =>
      page.evaluate((src) => new Function('s', `return (${src})`)((window as any).__omniPlayer.store.getState()), expr) as Promise<T>,
    /** Live 2D physics body of a node (the store keeps authored positions). */
    body2D: (nodeId: string) => page.evaluate((id) => (window as any).__omniPlayer.inspect().bodies2D[id], nodeId) as Promise<{ x: number; y: number; collected: boolean; onGround: boolean; reached: boolean }>,
    /** Phase 2: the live 2D camera. */
    camera2D: () => page.evaluate(() => (window as any).__omniPlayer.inspect().camera2D) as Promise<{ x: number; y: number; zoom: number }>,
    /** Live 3D actor poses and camera from the Player view. */
    backend: () => page.evaluate(() => (window as any).__omniPlayer.backend()) as Promise<'webgl' | 'webgpu' | 'pending'>,
    /** Steps once (so the view requests its models) and waits until every asset load has finished. */
    waitAssets: async () => {
      await page.evaluate(() => (window as any).__omniPlayer.step(0));
      await page.waitForFunction(() => (window as any).__omniPlayer.pendingLoads() === 0, undefined, { timeout: 20000 });
    },
    view3d: () => page.evaluate(() => (window as any).__omniPlayer.inspect().view3d) as Promise<{
      actors: Record<string, { position: number[]; yaw: number; clip?: string; talk: number; fx: number }>;
      camera: { position: number[]; fov: number };
      world: string[];
      backend: 'webgl' | 'webgpu';
    }>,
    /** Renders one frame and measures the canvas (mean luminance + spread) in the same task, before the buffer swap. */
    pixelStats: () =>
      page.evaluate(() => {
        (window as any).__omniPlayer.step(1 / 60);
        const src = document.querySelector('canvas.omni-stage') as HTMLCanvasElement;
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 36;
        const g = c.getContext('2d')!;
        g.drawImage(src, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let sum = 0;
        let sq = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          sum += l;
          sq += l * l;
        }
        const mean = sum / n;
        return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), width: src.width, height: src.height };
      }),
    /** Phase 6: mean colour of the 64 x 36 frame, how far apart the channels are, and the luminance of the centre vs the four corners. */
    colorStats: () =>
      page.evaluate(() => {
        (window as any).__omniPlayer.step(1 / 60);
        const src = document.querySelector('canvas.omni-stage') as HTMLCanvasElement;
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 36;
        const g = c.getContext('2d')!;
        g.drawImage(src, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        const lum = (x0: number, y0: number, w: number, h: number) => {
          let sum = 0;
          let n = 0;
          for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
            const i = (y * 64 + x) * 4;
            sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            n++;
          }
          return sum / n;
        };
        let r = 0, gr = 0, b = 0, spreadSum = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i]; gr += d[i + 1]; b += d[i + 2];
          spreadSum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        }
        const corners = [lum(0, 0, 4, 4), lum(60, 0, 4, 4), lum(0, 32, 4, 4), lum(60, 32, 4, 4)];
        return { r: r / n, g: gr / n, b: b / n, spread: spreadSum / n, center: lum(30, 16, 4, 4), corner: corners.reduce((a, v) => a + v, 0) / 4 };
      }),
    /** Like pixelStats, but returns the 64 x 36 luminance grid (to compare two frames pixel by pixel). */
    pixelGrid: () =>
      page.evaluate(() => {
        (window as any).__omniPlayer.step(1 / 60);
        const src = document.querySelector('canvas.omni-stage') as HTMLCanvasElement;
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 36;
        const g = c.getContext('2d')!;
        g.drawImage(src, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        const out: number[] = [];
        for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        return out;
      }),
  };
}

/** Phase 6 Batch 3 — every shader effect preset on a rigged GLTF robot and procedural composites, one scene. */
export function shaderFxScene(): SceneSpec {
  const spec = template('blank-3d-authoring');
  spec.mode = 'media';
  spec.durationSeconds = 6;
  const base = spec.actors[0];
  const prop = (id: string, assetId: string, x: number, shaderEffect: SceneSpec['actors'][number]['shaderEffect']) => ({
    ...base, id, name: id, assetId, modelUrl: undefined, customGlbUrl: undefined, availableClips: undefined, activeClip: undefined,
    position: [x, 0, 1.5] as [number, number, number], scale: [1, 1, 1] as [number, number, number], performance: undefined,
    activeAnimation: 'idle' as const, primaryColor: '#8b5cf6', secondaryColor: '#f59e0b', shaderEffect,
  });
  spec.actors = [
    { ...base, id: 'robot', position: [0, 0, -1], performance: undefined, shaderEffect: { preset: 'hologram' } },
    prop('gem', 'plasma-gem', -3, { preset: 'forcefield', intensity: 1.5 }),
    prop('box', 'mystery-gift-box', -1.5, { preset: 'toon' }),
    prop('car', 'gt-sports-car', 0, { preset: 'lava', speed: 2 }),
    prop('bottle', 'luxury-perfume-bottle', 1.5, { preset: 'rainbow', intensity: 2 }),
    prop('mine', 'hazard-laser-mine', 3, { preset: 'dissolve', progressTween: { from: 0, to: 1, start: 0, duration: 4 } }),
  ];
  spec.camera.shots = [{ start: 0, type: 'wide', subject: 'car', angle: 'front' }];
  return spec;
}
