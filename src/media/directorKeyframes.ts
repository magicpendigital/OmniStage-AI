/**
 * Phase 10D — renders the keyframes a director reviews (see src/agent/directorQA.ts) on the real exported OmniStage
 * Player, frame-stepped like the MP4 export, and tiles them into one labelled JPEG contact sheet so every vision
 * provider (one image per request) can judge the whole shot. Browser-only, studio-only.
 */
import type { SceneSpec } from '../types/scene.schema';
import { contactSheetLayout, DirectorKeyframe } from '../agent/directorQA';
import { voiceClipAssets } from '../audio/voices';
import { generatePlayerHTML } from '../exporter/playerHtml';
import { loadPlayerRuntime } from '../exporter/mediaExporter';
import { mountPlayer, waitForAssets } from '../exporter/filmExport';

export interface ContactSheet {
  dataUrl: string;
  keyframes: DirectorKeyframe[];
  width: number;
  height: number;
}

const STEP = 1 / 15;

export async function captureDirectorContactSheet(
  scene: SceneSpec,
  keyframes: DirectorKeyframe[],
  opts: { tileWidth?: number; tileHeight?: number; signal?: AbortSignal } = {}
): Promise<ContactSheet | null> {
  if (typeof document === 'undefined' || !keyframes.length) return null;
  const tileW = opts.tileWidth ?? 640;
  const tileH = opts.tileHeight ?? 360;
  const runtime = await loadPlayerRuntime('webgl');
  const html = generatePlayerHTML(scene, 'universal', [scene], { playerRuntimeSource: runtime, touchControls: false, sound: false, quality: 'high', assets: voiceClipAssets([scene]) });
  const { cols, rows } = contactSheetLayout(keyframes.length);
  const sheet = document.createElement('canvas');
  sheet.width = tileW * cols;
  sheet.height = tileH * rows;
  const ctx = sheet.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  let mounted: Awaited<ReturnType<typeof mountPlayer>> | null = null;
  try {
    mounted = await mountPlayer(html, tileW, tileH, 'high');
    const { player } = mounted;
    player.store.getState().switchScene?.(scene.id);
    player.store.setState({ isPlaying: true, currentTime: 0 });
    await waitForAssets(player, opts.signal);
    player.store.setState({ isPlaying: true, currentTime: 0 });
    player.step(0);
    // Step forward in time order (acting and shots are integrated by the clock), then place tiles in their own order.
    const order = keyframes.map((k, i) => ({ k, i })).sort((a, b) => a.k.time - b.k.time);
    let t = 0;
    for (const { k, i } of order) {
      if (opts.signal?.aborted) return null;
      while (t < k.time - 1e-6) {
        const dt = Math.min(STEP, k.time - t);
        player.step(dt);
        t += dt;
      }
      player.step(0);
      const src = player.canvas();
      const x = (i % cols) * tileW;
      const y = Math.floor(i / cols) * tileH;
      ctx.fillStyle = scene.environment?.backgroundColor || '#000';
      ctx.fillRect(x, y, tileW, tileH);
      if (src && src.width > 0 && src.height > 0) {
        const s = Math.min(tileW / src.width, tileH / src.height);
        const dw = src.width * s;
        const dh = src.height * s;
        ctx.drawImage(src, x + (tileW - dw) / 2, y + (tileH - dh) / 2, dw, dh);
      }
      // Tile label: number · time · shot.
      const label = `${i + 1} · ${k.time.toFixed(1)}s · ${k.label}`.slice(0, 60);
      ctx.font = '600 15px system-ui, sans-serif';
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x + 6, y + 6, w, 24);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 13, y + 23);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.strokeRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);
    }
    return { dataUrl: sheet.toDataURL('image/jpeg', 0.85), keyframes, width: sheet.width, height: sheet.height };
  } catch {
    return null;
  } finally {
    try {
      mounted?.player.destroy();
    } catch {
      /* iframe teardown */
    }
    mounted?.frame.remove();
  }
}

/**
 * Phase 11E: the two frames of a cut side by side (LEFT = last frame of A, RIGHT = first frame of B), labelled, as one JPEG.
 * Each scene is rendered on its own exported Player, frame-stepped. null when either capture fails.
 */
export async function captureCutPairSheet(
  a: SceneSpec,
  b: SceneSpec,
  opts: { tileWidth?: number; tileHeight?: number; signal?: AbortSignal } = {}
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;
  const { cutFrameTimes } = await import('../agent/cutQA');
  const { outTime, inTime } = cutFrameTimes(a, b);
  const tileWidth = opts.tileWidth ?? 640;
  const tileHeight = opts.tileHeight ?? 360;
  const left = await captureDirectorContactSheet(a, [{ time: outTime, label: 'A last frame' }], { tileWidth, tileHeight, signal: opts.signal });
  if (!left || opts.signal?.aborted) return null;
  const right = await captureDirectorContactSheet(b, [{ time: inTime, label: 'B first frame' }], { tileWidth, tileHeight, signal: opts.signal });
  if (!right || opts.signal?.aborted) return null;
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('frame decode failed'));
      img.src = src;
    });
  try {
    const [la, rb] = await Promise.all([load(left.dataUrl), load(right.dataUrl)]);
    const gap = 8;
    const sheet = document.createElement('canvas');
    sheet.width = tileWidth * 2 + gap;
    sheet.height = tileHeight;
    const ctx = sheet.getContext('2d', { alpha: false })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.drawImage(la, 0, 0, tileWidth, tileHeight);
    ctx.drawImage(rb, tileWidth + gap, 0, tileWidth, tileHeight);
    return { dataUrl: sheet.toDataURL('image/jpeg', 0.85), width: sheet.width, height: sheet.height };
  } catch {
    return null;
  }
}
