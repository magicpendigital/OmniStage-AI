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

export async function openExport(page: Page, spec: SceneSpec, opts: Partial<PlayerHtmlOptions> = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|GPU stall|WebGL warning/i.test(m.text())) errors.push(m.text());
  });
  const html = generatePlayerHTML(spec, 'universal', [spec], {
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
    body2D: (nodeId: string) => page.evaluate((id) => (window as any).__omniPlayer.inspect().bodies2D[id], nodeId) as Promise<{ x: number; y: number; collected: boolean }>,
    /** Live 3D actor poses and camera from the Player view. */
    view3d: () => page.evaluate(() => (window as any).__omniPlayer.inspect().view3d) as Promise<{
      actors: Record<string, { position: number[]; yaw: number; clip?: string; talk: number }>;
      camera: { position: number[]; fov: number };
      world: string[];
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
  };
}
