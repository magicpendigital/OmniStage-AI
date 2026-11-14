/**
 * Phase 8 — Store art rendered in the browser: app icons (192 / 512 / maskable / 1024), the 2732² splash and store
 * screenshots. Art comes from the stage canvas when one is given, else the app initials on the theme colour.
 */
import type { AppIconSet, AppIdentity } from './mobileExport';

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function pngBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || 'O') + (words[1]?.[0] || '')).toUpperCase();
}

/** Draws `art` scaled to cover the square (x, y, size); falls back to initials. */
function drawArt(ctx: CanvasRenderingContext2D, id: AppIdentity, art: CanvasImageSource | null, artW: number, artH: number, x: number, y: number, size: number) {
  if (art && artW > 0 && artH > 0) {
    const scale = Math.max(size / artW, size / artH);
    const w = artW * scale;
    const h = artH * scale;
    ctx.drawImage(art, x + (size - w) / 2, y + (size - h) / 2, w, h);
    return;
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(size * 0.42)}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(id.appName), x + size / 2, y + size / 2 + size * 0.02);
}

function background(ctx: CanvasRenderingContext2D, id: AppIdentity, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, id.themeColor);
  g.addColorStop(1, id.backgroundColor);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function source(art?: HTMLCanvasElement | null): { img: CanvasImageSource | null; w: number; h: number } {
  if (!art || !art.width || !art.height) return { img: null, w: 0, h: 0 };
  // A WebGL canvas without preserveDrawingBuffer reads back blank: fall back to initials instead of a flat icon.
  try {
    const probe = canvasOf(16, 16);
    const p = probe.getContext('2d', { willReadFrequently: true })!;
    p.drawImage(art, 0, 0, 16, 16);
    const d = p.getImageData(0, 0, 16, 16).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && d[i] + d[i + 1] + d[i + 2] > 24) lit++;
    if (lit < 4) return { img: null, w: 0, h: 0 };
  } catch {
    return { img: null, w: 0, h: 0 };
  }
  return { img: art, w: art.width, h: art.height };
}

/** Icon set for the PWA and the Capacitor project. `art` is usually the stage canvas (snapshot of the game). */
export async function renderAppIcons(id: AppIdentity, art?: HTMLCanvasElement | null): Promise<AppIconSet> {
  const s = source(art);
  const icon = async (size: number, inset: number) => {
    const c = canvasOf(size, size);
    const ctx = c.getContext('2d')!;
    background(ctx, id, size, size);
    const pad = size * inset;
    drawArt(ctx, id, s.img, s.w, s.h, pad, pad, size - pad * 2);
    return pngBytes(c);
  };
  const splash = async () => {
    const size = 2732;
    const c = canvasOf(size, size);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = id.backgroundColor;
    ctx.fillRect(0, 0, size, size);
    const box = 640;
    const x = (size - box) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect?.(x, x, box, box, 120);
    ctx.clip();
    background(ctx, id, size, size);
    drawArt(ctx, id, s.img, s.w, s.h, x, x, box);
    ctx.restore();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 96px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(id.appName, size / 2, x + box + 170);
    return pngBytes(c);
  };
  return {
    icon192: await icon(192, 0),
    icon512: await icon(512, 0),
    // Maskable / adaptive: launchers crop to a circle or squircle, so keep the art inside the central 80 %.
    maskable512: await icon(512, 0.1),
    icon1024: await icon(1024, 0),
    splash2732: await splash(),
  };
}

/** Store screenshot (portrait 1290×2796 = 6.9" iPhone, landscape swapped) letterboxed from the stage canvas. */
export async function renderStoreScreenshot(id: AppIdentity, stage: HTMLCanvasElement, orientation: 'portrait' | 'landscape'): Promise<Uint8Array> {
  const [w, h] = orientation === 'portrait' ? [1290, 2796] : [2796, 1290];
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = id.backgroundColor;
  ctx.fillRect(0, 0, w, h);
  const scale = Math.min(w / stage.width, h / stage.height);
  const dw = stage.width * scale;
  const dh = stage.height * scale;
  ctx.drawImage(stage, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return pngBytes(c);
}
