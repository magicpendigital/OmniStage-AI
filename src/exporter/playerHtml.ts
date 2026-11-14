/**
 * Phase 7 — Standalone HTML built on the OmniStage Player (the same runtime as Play Test and phone preview).
 * Replaces the old hand-written export script: one runtime for editor parity, GLB actors with skeletal clips,
 * world, VFX, touch / gamepad input, captions, audio and level progression.
 */
import type { SceneSpec } from '../types/scene.schema';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { formatBytes, PLAYABLE_SIZE_LIMITS } from './playableBundle';
import type { StandaloneAdNetwork } from './mediaExporter';

export interface PlayerHtmlOptions {
  playerRuntimeSource: string;
  /** Asset URL → data URI, embedded so the build works offline. */
  assets?: Record<string, string>;
  touchControls?: boolean | 'auto';
  sound?: boolean;
  showFps?: boolean;
  quality?: 'auto' | 'low' | 'high' | 'ultra';
  /** Phase 7: 'webgpu' / 'auto' need the WebGPU build of the runtime (PLAYER_RUNTIME_WEBGPU); WebGL is the fallback. */
  renderer?: 'webgl' | 'webgpu' | 'auto';
}

/** JSON safe inside an inline <script> (no `</script>` / `<!--` breakouts). */
export function inlineJSON(value: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const BS = String.fromCharCode(92); // backslash: emit escape sequences without writing them in source
  return JSON.stringify(value).split('<').join(BS + 'u003c').split(LS).join(BS + 'u2028').split(PS).join(BS + 'u2029');
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const FPS_METER = `<div id="omniFps" style="position:fixed;left:8px;bottom:8px;z-index:40;font:600 11px ui-monospace,monospace;color:#A7F3D0;background:rgba(2,6,23,.75);padding:3px 6px;border-radius:6px;pointer-events:none">-- fps</div>
<script>(function(){var el=document.getElementById('omniFps'),f=0,last=performance.now(),worst=0,prev=last;function t(n){f++;worst=Math.max(worst,n-prev);prev=n;if(n-last>=500){var fps=Math.round(f*1000/(n-last));el.textContent=fps+' fps · worst '+Math.round(worst)+' ms';el.style.color=fps>=55?'#A7F3D0':fps>=30?'#FDE68A':'#FCA5A5';f=0;worst=0;last=n}requestAnimationFrame(t)}requestAnimationFrame(t)})();</script>`;

export function generatePlayerHTML(
  activeScene: SceneSpec,
  network: StandaloneAdNetwork,
  scenes: SceneSpec[],
  opts: PlayerHtmlOptions
): string {
  const synced = scenes.length ? scenes.map((s) => (s.id === activeScene.id ? activeScene : s)) : [activeScene];
  const data = { scenes: synced, activeSceneId: activeScene.id };
  const playerOptions = {
    network,
    assets: opts.assets || {},
    touchControls: opts.touchControls ?? 'auto',
    sound: opts.sound !== false,
    quality: opts.quality || 'auto',
    renderer: opts.renderer || 'webgl',
  };
  const title = `${activeScene.title} — OmniStage`;
  const networkScripts =
    network === 'telegram' ? '<script src="https://telegram.org/js/telegram-web-app.js"></script>' : network === 'tiktok' ? '<script src="mraid.js"></script>' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#05070d" />
<meta name="generator" content="OmniStage Player" />
<title>${escapeHtml(title)}</title>
${networkScripts}
<style>html,body{margin:0;height:100%;background:#05070d;overscroll-behavior:none}</style>
</head>
<body>
<div id="omni-root"></div>
${opts.showFps ? FPS_METER : ''}
<script>${opts.playerRuntimeSource.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function () {
  var data = ${inlineJSON(data)};
  var options = ${inlineJSON(playerOptions)};
  try { OmniPlayer.createOmniPlayer(document.getElementById('omni-root'), data, options); }
  catch (e) { document.body.textContent = 'This game could not start: ' + (e && e.message || e); }
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Asset embedding (GLB models, sprites / images) within the network size budget
// ---------------------------------------------------------------------------

export function collectAssetUrls(scenes: SceneSpec[]): string[] {
  const urls = new Set<string>();
  for (const s of scenes) {
    for (const a of s.actors || []) {
      // Same resolution as the studio ActorRenderer / Player: explicit model, else the registry asset model.
      const url = a.customGlbUrl || a.modelUrl || ASSET_REGISTRY[a.assetId]?.modelUrl;
      if (url && !url.startsWith('data:')) urls.add(url);
    }
    const hdri = s.world?.hdri?.url;
    if (hdri && !hdri.startsWith('data:')) urls.add(hdri);
    for (const n of s.nodes2D || []) if (n.imageUrl && !n.imageUrl.startsWith('data:')) urls.add(n.imageUrl);
  }
  return [...urls];
}

const EXT_MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  hdr: 'image/vnd.radiance',
};

function mimeFor(url: string, contentType?: string | null) {
  if (contentType && !contentType.startsWith('application/octet-stream') && !contentType.startsWith('text/plain')) return contentType.split(';')[0];
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase() || '';
  return EXT_MIME[ext] || 'application/octet-stream';
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export interface EmbedResult {
  assets: Record<string, string>;
  embedded: Array<{ url: string; bytes: number }>;
  skipped: Array<{ url: string; reason: string }>;
}

/**
 * Downloads assets and returns data URIs, smallest first, while the HTML stays under `budgetBytes`
 * (base64 adds ~33 %). Assets that don't fit or fail to download keep their URL (online-only).
 */
export async function embedAssets(
  urls: string[],
  budgetBytes: number,
  fetcher: (url: string) => Promise<{ bytes: Uint8Array; contentType?: string | null }>
): Promise<EmbedResult> {
  const downloaded: Array<{ url: string; bytes: Uint8Array; contentType?: string | null }> = [];
  const skipped: EmbedResult['skipped'] = [];
  for (const url of urls) {
    try {
      downloaded.push({ url, ...(await fetcher(url)) });
    } catch (e: any) {
      skipped.push({ url, reason: `download failed (${e?.message || e})` });
    }
  }
  downloaded.sort((a, b) => a.bytes.length - b.bytes.length);
  const assets: Record<string, string> = {};
  const embedded: EmbedResult['embedded'] = [];
  let used = 0;
  for (const d of downloaded) {
    const cost = Math.ceil(d.bytes.length / 3) * 4 + 64;
    if (used + cost > budgetBytes) {
      skipped.push({ url: d.url, reason: `${formatBytes(d.bytes.length)} does not fit the size budget` });
      continue;
    }
    assets[d.url] = `data:${mimeFor(d.url, d.contentType)};base64,${toBase64(d.bytes)}`;
    embedded.push({ url: d.url, bytes: d.bytes.length });
    used += cost;
  }
  return { assets, embedded, skipped };
}

/** Bytes left for embedded assets on a network after the HTML shell + player runtime. */
export function assetBudgetFor(network: StandaloneAdNetwork, shellBytes: number): number {
  const limit = PLAYABLE_SIZE_LIMITS[network].bytes;
  return Math.max(0, limit - shellBytes - 16 * 1024);
}

export async function defaultFetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
}
